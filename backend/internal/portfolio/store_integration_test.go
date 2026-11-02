package portfolio

import (
	"context"
	"errors"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresLedgerOwnershipCASRecalculationAndConcurrency(t *testing.T) {
	dsn := os.Getenv("PORTFOLIO_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("disposable Postgres URL not provided")
	}
	parsed, err := url.Parse(dsn)
	if err != nil || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") || parsed.Path != "/signalgen_test" {
		t.Fatal("ledger tests require local signalgen_test database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	adminConfig, err := pgxpool.ParseConfig(dsn)
	if err != nil || (adminConfig.ConnConfig.Host != "127.0.0.1" && adminConfig.ConnConfig.Host != "localhost") || adminConfig.ConnConfig.Database != "signalgen_test" || len(adminConfig.ConnConfig.Fallbacks) != 0 {
		t.Fatal("effective ledger test connection must remain local signalgen_test")
	}
	admin, err := pgxpool.NewWithConfig(ctx, adminConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	if _, err = admin.Exec(ctx, `insert into auth.users(id,email) values($1::uuid,'ledger-a@example.test'),($2::uuid,'ledger-b@example.test') on conflict(id) do nothing`, a, b); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(context.Background(), `delete from auth.users where id=any($1::uuid[])`, []string{a, b})
	if _, err = admin.Exec(ctx, `alter role signalgen_api login password 'fixture-only'`); err != nil {
		t.Fatal(err)
	}
	parsed.User = url.UserPassword("signalgen_api", "fixture-only")
	config, err := pgxpool.ParseConfig(parsed.String())
	if err != nil {
		t.Fatal("runtime config invalid")
	}
	config.ConnConfig.User, config.ConnConfig.Password = "signalgen_api", "fixture-only"
	config.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	store := &PostgresStore{DB: pool}
	if err = store.Ready(ctx); err != nil {
		t.Fatal(err)
	}
	const buyID = "11111111-1111-4111-8111-111111111111"
	const sellID = "22222222-2222-4222-8222-222222222222"
	buy := testTransaction(buyID, "BUY", "100", "4000", "0", 0).Data
	sell := testTransaction(sellID, "SELL", "100", "5000", "0", 1).Data
	if _, err = store.Put(ctx, a, buyID, 0, buy); err != nil {
		t.Fatal(err)
	}
	if item, e := store.Put(ctx, a, buyID, 0, buy); e != nil || item.Version != 1 {
		t.Fatal("idempotent create failed", e)
	}
	if _, err = store.Get(ctx, b, buyID); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign transaction was visible")
	}
	if _, err = store.Put(ctx, b, buyID, 1, buy); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign update accepted")
	}
	if err = store.Delete(ctx, b, buyID, 1); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign delete accepted")
	}
	// A query that deliberately targets A must still see nothing with RLS owner B.
	for _, owner := range []string{a, b, a} {
		batch := store.read(ctx, owner, `select count(*) from signalgen.portfolio_transactions where user_id=$1::uuid`, a)
		if _, err = batch.Exec(); err != nil {
			t.Fatal(err)
		}
		var n int
		err = batch.QueryRow().Scan(&n)
		closeErr := batch.Close()
		want := 0
		if owner == a {
			want = 1
		}
		if err != nil || closeErr != nil || n != want {
			t.Fatal("RLS owner leaked across pooled reads")
		}
	}
	if _, err = store.Put(ctx, a, sellID, 0, sell); err != nil {
		t.Fatal(err)
	}
	if err = store.Delete(ctx, a, buyID, 1); !errors.Is(err, ErrInsufficient) {
		t.Fatal("delete invalidated a later sale")
	}
	backdated := buy
	backdated.ExecutedAt = sell.ExecutedAt.Add(time.Minute)
	if _, err = store.Put(ctx, a, buyID, 1, backdated); !errors.Is(err, ErrInsufficient) {
		t.Fatal("backdated edit left an oversell")
	}
	if current, e := store.Get(ctx, a, buyID); e != nil || current.Version != 1 || !current.Data.ExecutedAt.Equal(buy.ExecutedAt) {
		t.Fatal("failed write was not rolled back")
	}
	if err = store.Delete(ctx, a, sellID, 1); err != nil {
		t.Fatal(err)
	}
	buy.Price = "4500"
	if item, e := store.Put(ctx, a, buyID, 1, buy); e != nil || item.Version != 2 {
		t.Fatal("valid edit failed", e)
	}
	if _, err = store.Put(ctx, a, buyID, 1, buy); !errors.Is(err, ErrConflict) {
		t.Fatal("stale edit accepted")
	}
	// Separate pooled connections exercise the database lock, not just one queue.
	otherPool, err := pgxpool.NewWithConfig(ctx, config.Copy())
	if err != nil {
		t.Fatal(err)
	}
	defer otherPool.Close()
	other := &PostgresStore{DB: otherPool}
	var workers sync.WaitGroup
	results := make(chan error, 8)
	for i := 0; i < 8; i++ {
		workers.Add(1)
		go func(i int) {
			defer workers.Done()
			id := []string{"33333333-3333-4333-8333-333333333331", "33333333-3333-4333-8333-333333333332", "33333333-3333-4333-8333-333333333333", "33333333-3333-4333-8333-333333333334", "33333333-3333-4333-8333-333333333335", "33333333-3333-4333-8333-333333333336", "33333333-3333-4333-8333-333333333337", "33333333-3333-4333-8333-333333333338"}[i]
			s := store
			if i%2 == 0 {
				s = other
			}
			_, e := s.Put(ctx, a, id, 0, sell)
			results <- e
		}(i)
	}
	workers.Wait()
	close(results)
	success, denied := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, ErrInsufficient) {
			denied++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || denied != 7 {
		t.Fatalf("concurrent sells: accepted=%d denied=%d", success, denied)
	}
	items, err := store.List(ctx, a)
	if err != nil {
		t.Fatal(err)
	}
	summary, err := Recalculate(items)
	if err != nil || summary.Positions[0].Quantity != "0.000000" || summary.Positions[0].RealizedPnL != "50000.000000" {
		t.Fatal("concurrent ledger lost consistency")
	}
	var ownerContext string
	if err = pool.QueryRow(ctx, `select coalesce(current_setting('signalgen.owner_id',true),'')`).Scan(&ownerContext); err != nil || ownerContext != "" {
		t.Fatal("RLS context escaped transaction")
	}
	if rows, e := store.List(ctx, b); e != nil || len(rows) != 0 {
		t.Fatal("owner B inherited A ledger")
	}
	// Deliberately bypass the repository owner predicate: WITH CHECK must still
	// reject a foreign insert, and a missing owner context must reveal no rows.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `select set_config('signalgen.owner_id',$1,true)`, b)
	if err == nil {
		_, err = tx.Exec(ctx, `insert into signalgen.portfolio_transactions(user_id,id,book,symbol,market,currency,side,quantity,price,fee,executed_at) values($1::uuid,'99999999-9999-4999-8999-999999999999','Main','BBCA.JK','IDX','IDR','BUY',100,1,0,'2026-01-01Z')`, a)
	}
	var pgError *pgconn.PgError
	if !errors.As(err, &pgError) || pgError.Code != "42501" {
		t.Fatal("foreign insert was not rejected by RLS", err)
	}
	_ = tx.Rollback(ctx)
	var visible int
	if err = pool.QueryRow(ctx, `select count(*) from signalgen.portfolio_transactions`).Scan(&visible); err != nil || visible != 0 {
		t.Fatal("missing owner context exposed rows")
	}
	// The quota is per owner. Creates stop at 1000, but identical retries,
	// updates and deletes remain usable so a full ledger can be corrected.
	if _, err = admin.Exec(ctx, `insert into signalgen.portfolio_transactions(user_id,id,book,symbol,market,currency,side,quantity,price,fee,executed_at)
select $1::uuid,md5('quota-'||n)::uuid,'Main','BBCA.JK','IDX','IDR','BUY',100,1,0,'2026-01-01Z'::timestamptz+n*interval '1 minute' from generate_series(1,1000) n`, b); err != nil {
		t.Fatal(err)
	}
	quota, err := store.List(ctx, b)
	if err != nil || len(quota) != MaxTransactions {
		t.Fatal("quota list mismatch", err)
	}
	if _, err = store.Put(ctx, b, quota[0].ID, 0, quota[0].Data); err != nil {
		t.Fatal("full ledger blocked idempotent create", err)
	}
	if _, err = store.Put(ctx, b, buyID, 0, buy); !errors.Is(err, ErrLimit) {
		t.Fatal("quota create accepted", err)
	}
	if _, err = store.Put(ctx, b, quota[0].ID, 1, quota[0].Data); err != nil {
		t.Fatal("full ledger blocked edit", err)
	}
	if err = store.Delete(ctx, b, quota[0].ID, 2); err != nil {
		t.Fatal("full ledger blocked delete", err)
	}
	if _, err = admin.Exec(ctx, `alter table signalgen.portfolio_transactions no force row level security`); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(context.Background(), `alter table signalgen.portfolio_transactions force row level security`)
	if err = store.Ready(ctx); err == nil {
		t.Fatal("readiness accepted missing FORCE RLS")
	}
	if _, err = admin.Exec(ctx, `alter table signalgen.portfolio_transactions force row level security`); err != nil {
		t.Fatal(err)
	}
	if err = store.Ready(ctx); err != nil {
		t.Fatal(err)
	}
	t.Log("PASS: owner/RLS, idempotency, CAS, edit/delete rollback, and one winner among eight concurrent sells")
}
