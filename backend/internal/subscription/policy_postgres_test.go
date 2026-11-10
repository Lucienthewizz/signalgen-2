package subscription_test

import (
	"context"
	"errors"
	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/subscription"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Uses an explicitly named disposable database; never reads .env.
func TestMVPTiersPostgresOwnershipQuotaAndMigration(t *testing.T) {
	dsn := os.Getenv("MVP_TIER_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("disposable database not provided")
	}
	guard, err := pgxpool.ParseConfig(dsn)
	if err != nil || (guard.ConnConfig.Host != "127.0.0.1" && guard.ConnConfig.Host != "localhost") || guard.ConnConfig.Database != "signalgen_tiers_test" || len(guard.ConnConfig.Fallbacks) != 0 {
		t.Fatal("requires disposable signalgen_tiers_test on loopback")
	}
	ctx := context.Background()
	admin, e := pgxpool.New(ctx, dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer admin.Close()
	var name string
	if e = admin.QueryRow(ctx, "select current_database()").Scan(&name); e != nil || name != "signalgen_tiers_test" {
		t.Fatal("requires disposable signalgen_tiers_test")
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, e := admin.Exec(ctx, q, args...); e != nil {
			t.Fatal(e)
		}
	}
	var owner, other string
	for _, id := range []*string{&owner, &other} {
		if e := admin.QueryRow(ctx, "insert into auth.users default values returning id::text").Scan(id); e != nil {
			t.Fatal(e)
		}
		exec("insert into signalgen.account_profiles(user_id,email) values($1::uuid,'tier@example.test')", *id)
	}
	config, e := pgxpool.ParseConfig(dsn)
	if e != nil {
		t.Fatal(e)
	}
	config.AfterConnect = func(ctx context.Context, c *pgx.Conn) error { _, e := c.Exec(ctx, "set role signalgen_api"); return e }
	pool, e := pgxpool.NewWithConfig(ctx, config)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	read := func() subscription.EffectiveAccess {
		t.Helper()
		a, e := subscription.ReadAccess(ctx, pool, owner)
		if e != nil {
			t.Fatal(e)
		}
		return a
	}
	if a := read(); a.PlanCode != "free" || a.Screening.MaxSymbols != 3 {
		t.Fatalf("new account: %+v", a)
	}
	u := universe.NewPostgresRepository(pool)
	r := rules.NewPostgresRepository(pool)
	definition := core.RuleSnapshot{Name: "Owned rule", Logic: "AND", SignalType: "BUY", Conditions: []core.Condition{{Left: "PRICE", Op: ">", Right: 1.0}}}
	if _, e := r.Create(ctx, owner, definition); !errors.Is(e, subscription.ErrFeatureNotIncluded) {
		t.Fatalf("Free rule: %v", e)
	}
	symbols := []string{"BBCA.JK", "BBRI.JK", "TLKM.JK"}
	if _, e := u.Create(ctx, owner, "Too large", append(symbols, "ASII.JK")); !errors.Is(e, subscription.ErrPlanLimit) {
		t.Fatalf("4 symbols: %v", e)
	}
	var passed atomic.Int32
	var wg sync.WaitGroup
	failures := make(chan error, 8)
	for n := 0; n < 8; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, e := u.Create(ctx, owner, "Concurrent", symbols)
			if e == nil {
				passed.Add(1)
			} else if !errors.Is(e, subscription.ErrPlanLimit) {
				failures <- e
			}
		}()
	}
	wg.Wait()
	close(failures)
	for e := range failures {
		t.Fatal(e)
	}
	if passed.Load() != 1 {
		t.Fatalf("concurrent Free quota: %d", passed.Load())
	}
	groups, e := u.List(ctx, owner)
	if e != nil || len(groups) != 1 {
		t.Fatalf("list: %v", e)
	}
	g := groups[0]
	if _, e := u.Get(ctx, other, g.ID); !errors.Is(e, universe.ErrNotFound) {
		t.Fatal("other owner read universe")
	}
	exec("insert into signalgen.subscriptions(user_id,plan_code,status,current_period_start,current_period_end) values($1::uuid,'analyst','active',now()-interval '1 day',now()+interval '20 days')", owner)
	ownedRule, e := r.Create(ctx, owner, definition)
	if e != nil {
		t.Fatal(e)
	}
	for n := 1; n < 10; n++ {
		if _, e := r.Create(ctx, owner, definition); e != nil {
			t.Fatal(e)
		}
	}
	if _, e := r.Create(ctx, owner, definition); !errors.Is(e, subscription.ErrPlanLimit) {
		t.Fatalf("Analyst 11th: %v", e)
	}

	// A stale update must complete even with only one runtime pool connection.
	singleConfig, e := pgxpool.ParseConfig(dsn)
	if e != nil {
		t.Fatal(e)
	}
	singleConfig.MaxConns = 1
	singleConfig.AfterConnect = config.AfterConnect
	single, e := pgxpool.NewWithConfig(ctx, singleConfig)
	if e != nil {
		t.Fatal(e)
	}
	defer single.Close()
	limited, done := context.WithTimeout(ctx, 3*time.Second)
	defer done()
	if _, e := rules.NewPostgresRepository(single).Update(limited, owner, ownedRule.ID, ownedRule.Version+1, definition); !errors.Is(e, rules.ErrVersionConflict) {
		t.Fatalf("one-connection stale rule update: %v", e)
	}
	if _, e := universe.NewPostgresRepository(single).Update(limited, owner, g.ID, "stale", symbols, g.Version+1); !errors.Is(e, universe.ErrVersionConflict) {
		t.Fatalf("one-connection stale universe update: %v", e)
	}
	// Analyst grandfathering is idempotent and never extends the paid period.
	exec("insert into signalgen.feature_grants(user_id,feature,valid_until,revoked_at,reason) values($1::uuid,'backtest',now()+interval '2 years',now(),'revoked fixture')", owner)
	sql, e := os.ReadFile("../../../supabase/migrations/20261110042833_mvp_tier_access.sql")
	if e != nil {
		t.Fatal(e)
	}
	exec(string(sql))
	exec(string(sql))
	var sameEnd bool
	if e := admin.QueryRow(ctx, "select g.valid_until=s.current_period_end from signalgen.feature_grants g join signalgen.subscriptions s using(user_id) where g.user_id=$1::uuid and g.feature='backtest'", owner).Scan(&sameEnd); e != nil || !sameEnd {
		t.Fatal("migration revived revoked grant beyond paid period")
	}
	var count int
	if e := admin.QueryRow(ctx, "select count(*) from signalgen.audit_events where target_user_id=$1::uuid and request_id='migration:20261110035906'", owner).Scan(&count); e != nil || count != 1 {
		t.Fatalf("migration audit count=%d err=%v", count, e)
	}
	if a := read(); a.PlanCode != "analyst" || a.RequireFeature("backtest") != nil {
		t.Fatal("Analyst period not grandfathered")
	}
	exec("update signalgen.feature_grants set valid_until=now()-interval '1 second' where user_id=$1::uuid", owner)
	exec("update signalgen.subscriptions set current_period_start=now()-interval '2 days',current_period_end=now()-interval '1 day' where user_id=$1::uuid", owner)
	if a := read(); a.PlanCode != "free" || a.RequireFeature("backtest") == nil {
		t.Fatal("expired subscription/grant retained premium")
	}
	if got, e := r.List(ctx, owner); e != nil || len(got) != 10 {
		t.Fatalf("downgrade deleted rules: %v", e)
	}
	if _, e := r.Update(ctx, owner, ownedRule.ID, ownedRule.Version, definition); !errors.Is(e, subscription.ErrFeatureNotIncluded) {
		t.Fatalf("Free edited old rule: %v", e)
	}
	if _, e := r.Get(ctx, other, ownedRule.ID); !errors.Is(e, rules.ErrNotFound) {
		t.Fatal("other owner read rule")
	}
	if e := r.Delete(ctx, owner, ownedRule.ID, ownedRule.Version); e != nil {
		t.Fatal("downgrade prevents cleanup", e)
	}
	if e := u.Delete(ctx, owner, g.ID, g.Version); e != nil {
		t.Fatal("downgrade universe cleanup", e)
	}
	exec("insert into signalgen.feature_grants(user_id,feature,valid_until,reason) values($1::uuid,'screener',now()+interval '1 hour','test')", owner)
	if a := read(); a.PlanCode != "free" || a.Screening.MaxSymbols != 10 || a.Source != "manual_grant" {
		t.Fatal("manual compatibility lost")
	}
	exec("update signalgen.feature_grants set revoked_at=now() where user_id=$1::uuid", owner)
	if a := read(); a.Screening.MaxSymbols != 3 {
		t.Fatal("revoked grant retained capacity")
	}
	exec("update signalgen.account_profiles set status='suspended' where user_id=$1::uuid", owner)
	if _, e := subscription.ReadAccess(ctx, pool, owner); !errors.Is(e, access.ErrAccountSuspended) {
		t.Fatalf("suspended accepted: %v", e)
	}
}
