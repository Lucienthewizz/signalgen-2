package apitests

import (
	"context"
	"testing"

	platformdb "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Called only after each integration test validates its isolated loopback URL.
// The fixture/admin pool remains separate; all application queries run with
// the exact production role, without using or logging a production password.
func runtimeTestPool(t *testing.T, ctx context.Context, raw string) *pgxpool.Pool {
	t.Helper()
	config, err := pgxpool.ParseConfig(raw)
	if err != nil {
		t.Fatal(err)
	}
	config.MaxConns = 5
	config.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		_, err := conn.Exec(ctx, "set session authorization signalgen_api")
		return err
	}
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := (platformdb.RuntimePrivileges{Pool: pool}).Ready(ctx); err != nil {
		t.Fatal(err)
	}
	if err := (platformdb.PostgresReadiness{Pool: pool}).Ready(ctx); err != nil {
		t.Fatal(err)
	}
	return pool
}
