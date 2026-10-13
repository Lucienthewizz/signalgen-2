package subscription

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"testing"
	"time"
)

// Optional SQL compatibility check only: no fixtures, writes, schema changes or
// account mutations. The row lock and transaction are released by rollback.
func TestLockedLimitsReadOnlyDatabase(t *testing.T) {
	url := os.Getenv("SIGNALGEN_READONLY_QUOTA_DB_URL")
	if url == "" {
		t.Skip("set SIGNALGEN_READONLY_QUOTA_DB_URL for read-only SQL verification")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal("invalid database configuration")
	}
	defer pool.Close()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal("database connection unavailable")
	}
	defer tx.Rollback(ctx)
	var owner string
	if err := tx.QueryRow(ctx, `select user_id::text from signalgen.subscriptions order by updated_at desc limit 1`).Scan(&owner); err != nil {
		t.Fatal("cannot find an existing subscription for the SQL check")
	}
	limits, err := LockedLimits(ctx, tx, owner)
	if err != nil {
		t.Fatalf("quota SQL rejected: %v", err)
	}
	if limits != LimitsForPlan("analyst") && limits != LimitsForPlan("pro") {
		t.Fatalf("unexpected capacity: %+v", limits)
	}
	var ruleCount, universeCount int
	if err := tx.QueryRow(ctx, `select (select count(*) from signalgen.user_rules where owner_user_id=$1::uuid),(select count(*) from signalgen.stock_universes where owner_user_id=$1::uuid)`, owner).Scan(&ruleCount, &universeCount); err != nil {
		t.Fatal("owner resource counts unavailable")
	}
	if ruleCount < 0 || universeCount < 0 {
		t.Fatal("invalid counts")
	}
}
