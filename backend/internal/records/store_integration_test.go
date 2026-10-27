package records

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"strings"
	"testing"
)

// Runs only against an explicitly supplied disposable database, never .env.
func TestPostgresOwnerCASAndRLS(t *testing.T) {
	url := os.Getenv("RECORDS_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("disposable Postgres URL not provided")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	s := &PostgresStore{DB: pool}
	a := "11111111-1111-4111-8111-111111111111"
	b := "22222222-2222-4222-8222-222222222222"
	id := "33333333-3333-4333-8333-333333333333"
	raw, err := NormalizeTrade([]byte(tradeJSON))
	if err != nil {
		t.Fatal(err)
	}
	if _, e := s.Put(ctx, a, "journal", id, 0, raw); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Get(ctx, b, "journal", id); !errors.Is(e, ErrNotFound) {
		t.Fatalf("other owner got %v", e)
	}
	if e := s.Delete(ctx, b, "journal", id, 1); !errors.Is(e, ErrConflict) {
		t.Fatalf("other owner deleted: %v", e)
	}
	if item, e := s.Put(ctx, a, "journal", id, 0, raw); e != nil || item.Version != 1 {
		t.Fatalf("idempotent retry: %v", e)
	}
	if _, e := s.Put(ctx, a, "journal", id, 0, []byte(`{"different":true}`)); !errors.Is(e, ErrConflict) {
		t.Fatalf("conflicting create: %v", e)
	}
	if _, e := s.Put(ctx, a, "journal", id, 1, raw); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Put(ctx, a, "journal", id, 1, raw); !errors.Is(e, ErrConflict) {
		t.Fatalf("stale write: %v", e)
	}
	var count int
	if e := pool.QueryRow(ctx, `select count(*) from signalgen.user_records`).Scan(&count); e != nil || count != 0 {
		t.Fatalf("owner leaked outside transaction: count=%d err=%v", count, e)
	}
	rows, e := s.List(ctx, a, "journal")
	if e != nil || len(rows) != 1 || rows[0].Version != 2 {
		t.Fatalf("list: %+v %v", rows, e)
	}
	if e := s.Delete(ctx, a, "journal", id, 1); !errors.Is(e, ErrConflict) {
		t.Fatal(e)
	}
	if e := s.Delete(ctx, a, "journal", id, 2); e != nil {
		t.Fatal(e)
	}
	_ = s.Delete(ctx, a, "backtest", "", 0)
	for i := 0; i < 12; i++ {
		testID := fmt.Sprintf("44444444-4444-4444-8444-4444444444%02x", i)
		if _, e := s.Put(ctx, a, "backtest", testID, 0, raw); e != nil {
			t.Fatal(e)
		}
	}
	rows, e = s.List(ctx, a, "backtest")
	if e != nil || len(rows) != 10 {
		t.Fatalf("archive bound: %d %v", len(rows), e)
	}
	if e := s.Delete(ctx, b, "backtest", "", 0); e != nil {
		t.Fatal(e)
	}
	rows, _ = s.List(ctx, a, "backtest")
	if len(rows) != 10 {
		t.Fatal("cross-owner bulk delete")
	}
	if e := s.Delete(ctx, a, "backtest", "", 0); e != nil {
		t.Fatal(e)
	}
	large, _ := json.Marshal(map[string]string{"padding": strings.Repeat("x", 8*1024*1024-100)})
	for i := 0; i < 7; i++ {
		testID := fmt.Sprintf("55555555-5555-4555-8555-5555555555%02x", i)
		if _, e := s.Put(ctx, a, "backtest", testID, 0, large); e != nil {
			t.Fatal(e)
		}
	}
	rows, e = s.List(ctx, a, "backtest")
	var total int64
	for _, row := range rows {
		total += row.Bytes
	}
	if e != nil || total > 50*1024*1024 || len(rows) != 6 {
		t.Fatalf("byte quota count=%d bytes=%d err=%v", len(rows), total, e)
	}
	_ = s.Delete(ctx, a, "backtest", "", 0)
	// Direct SQL with an owner context cannot insert a foreign owner's record.
	tx, e := pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	_, _ = tx.Exec(ctx, `select set_config('signalgen.owner_id',$1,true)`, a)
	_, e = tx.Exec(ctx, `insert into signalgen.user_records(user_id,kind,id,data) values($1::uuid,'journal',$2::uuid,$3::jsonb)`, b, id, raw)
	_ = tx.Rollback(ctx)
	if e == nil {
		t.Fatal("RLS accepted a foreign owner")
	}
	// Concurrent edits at the same expected version must have a single winner.
	_, e = s.Put(ctx, a, "journal", id, 0, raw)
	if e != nil {
		t.Fatal(e)
	}
	ch := make(chan error, 8)
	for i := 0; i < 8; i++ {
		go func() { _, e := s.Put(ctx, a, "journal", id, 1, raw); ch <- e }()
	}
	winners := 0
	for i := 0; i < 8; i++ {
		e := <-ch
		if e == nil {
			winners++
		} else if !errors.Is(e, ErrConflict) {
			t.Fatal(e)
		}
	}
	if winners != 1 {
		t.Fatalf("concurrent edit winners=%d", winners)
	}
	_ = s.Delete(ctx, a, "journal", id, 2)
	// An identical create retry must still work when the journal is at quota.
	tx, e = pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	_, _ = tx.Exec(ctx, `select set_config('signalgen.owner_id',$1,true)`, a)
	_, e = tx.Exec(ctx, `insert into signalgen.user_records(user_id,kind,id,data) select $1::uuid,'journal',md5('record-quota-'||i::text)::uuid,$2::jsonb from generate_series(1,1000) i`, a, raw)
	if e != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(e)
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	rows, e = s.List(ctx, a, "journal")
	if e != nil || len(rows) != 1000 {
		t.Fatal("quota setup", e)
	}
	if _, e = s.Put(ctx, a, "journal", rows[0].ID, 0, raw); e != nil {
		t.Fatal("identical retry failed at quota", e)
	}
	if _, e = s.Put(ctx, a, "journal", id, 0, raw); !errors.Is(e, ErrQuota) {
		t.Fatal("journal quota not enforced", e)
	}
	tx, e = pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	_, _ = tx.Exec(ctx, `select set_config('signalgen.owner_id',$1,true)`, a)
	_, e = tx.Exec(ctx, `delete from signalgen.user_records where user_id=$1::uuid and kind='journal'`, a)
	if e != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(e)
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
}
