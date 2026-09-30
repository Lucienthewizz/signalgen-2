// Package database owns infrastructure-level database connections. Feature
// packages receive the pool through dependency injection and never read env.
package database

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// OpenPostgres creates the server-only pool used by SignalGen repositories.
// The connection string must come from backend environment, never a browser.
func OpenPostgres(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	if strings.TrimSpace(databaseURL) == "" {
		return nil, fmt.Errorf("SUPABASE_DB_URL is required")
	}
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("invalid SUPABASE_DB_URL")
	}
	// Session-pooler connections hold a backend connection while idle. Keep
	// this small until measured production concurrency justifies an increase.
	config.MaxConns = 5
	config.MinConns = 0
	config.MaxConnIdleTime = 2 * time.Minute
	config.MaxConnLifetime = 30 * time.Minute
	connectCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(connectCtx, config)
	if err != nil {
		return nil, fmt.Errorf("create Postgres pool: %w", err)
	}
	if err := pool.Ping(connectCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect to Postgres: %w", err)
	}
	return pool, nil
}

// PostgresReadiness is kept separate from liveness, so dependency outages
// yield /ready=503 without stopping the process or exposing connection data.
type PostgresReadiness struct{ Pool *pgxpool.Pool }

func (check PostgresReadiness) Ready(ctx context.Context) error {
	if check.Pool == nil {
		return fmt.Errorf("Postgres pool is unavailable")
	}
	var migrated bool
	err := check.Pool.QueryRow(ctx, `select
  to_regclass('signalgen.account_profiles') is not null and
  to_regclass('signalgen.feature_grants') is not null and
  to_regclass('signalgen.app_sessions') is not null and
  to_regclass('signalgen.account_device_state') is not null and
  to_regclass('signalgen.user_rules') is not null and
  to_regclass('signalgen.compute_grants') is not null and
  to_regclass('signalgen.audit_events') is not null and
  to_regclass('signalgen.subscription_plans') is not null and
  to_regclass('signalgen.subscription_plan_features') is not null and
  to_regclass('signalgen.subscriptions') is not null and
  to_regclass('signalgen.subscription_events') is not null`).Scan(&migrated)
	if err != nil {
		return fmt.Errorf("Postgres readiness: %w", err)
	}
	if !migrated {
		return fmt.Errorf("Postgres migration is incomplete")
	}
	return nil
}
