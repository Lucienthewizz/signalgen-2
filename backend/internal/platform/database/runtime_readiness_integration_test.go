package database

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/platform/healthcheck"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Opt-in, read-only: use the same restricted runtime URL as the API, not a
// migration/admin role. No SQL mutations or raw connection errors are printed.
func TestPostgresRuntimeReadinessFromColdPool(t *testing.T) {
	if os.Getenv("SIGNALGEN_RUN_POSTGRES_RUNTIME_READINESS") != "1" {
		t.Skip("set SIGNALGEN_RUN_POSTGRES_RUNTIME_READINESS=1 for a live read-only runtime check")
	}
	config, err := postgresConfig(os.Getenv("SUPABASE_DB_URL"), nil)
	if err != nil {
		t.Fatal("runtime database configuration is invalid")
	}
	ctx, cancel := context.WithTimeout(context.Background(), healthcheck.ReadinessTimeout)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal("cannot create runtime connection pool")
	}
	defer pool.Close()
	// Deliberately do not Ping/warm the pool before the first metadata check.
	started := time.Now()
	if err := (PostgresReadiness{Pool: pool}).Ready(ctx); err != nil {
		t.Fatal("cold runtime schema/RLS readiness failed (connection details withheld)")
	}
	if err := (RuntimePrivileges{Pool: pool}).Ready(ctx); err != nil {
		t.Fatal("restricted runtime grants/policies readiness failed (connection details withheld)")
	}
	t.Logf("cold schema, RLS and restricted runtime privileges verified in %s (budget %s)", time.Since(started).Round(time.Millisecond), healthcheck.ReadinessTimeout)
}
