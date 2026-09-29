package database

import (
	"context"
	"os"
	"testing"
	"time"
)

// Opt-in: verify the configured pooler can reach the expected migration.
// This test reads metadata only and never prints the database URL.
func TestPostgresConnection(t *testing.T) {
	if os.Getenv("SIGNALGEN_RUN_POSTGRES_CONNECTION") != "1" {
		t.Skip("set SIGNALGEN_RUN_POSTGRES_CONNECTION=1 for live database check")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()
	pool, err := OpenPostgres(ctx, os.Getenv("SUPABASE_DB_URL"))
	if err != nil {
		t.Fatalf("Postgres connection failed: %v", err)
	}
	defer pool.Close()
	var migrated bool
	err = pool.QueryRow(ctx, `select to_regclass('signalgen.account_profiles') is not null
and to_regclass('signalgen.user_rules') is not null
and to_regclass('signalgen.app_sessions') is not null`).Scan(&migrated)
	if err != nil || !migrated {
		t.Fatalf("Postgres schema is unavailable: %v", err)
	}
}
