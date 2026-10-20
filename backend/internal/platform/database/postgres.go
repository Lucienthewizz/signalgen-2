// Package database owns infrastructure-level database connections. Feature
// packages receive the pool through dependency injection and never read env.
package database

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// OpenPostgres creates the server-only pool used by SignalGen repositories.
// The connection string must come from backend environment, never a browser.
func OpenPostgres(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	return OpenPostgresObserved(ctx, databaseURL, nil)
}

// OpenPostgresObserved adds credential-free timing to the same bounded pool.
// Tests/tools can keep using OpenPostgres without an operational logger.
func OpenPostgresObserved(ctx context.Context, databaseURL string, logger *slog.Logger) (*pgxpool.Pool, error) {
	config, err := postgresConfig(databaseURL, logger)
	if err != nil {
		return nil, err
	}
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

func postgresConfig(databaseURL string, logger *slog.Logger) (*pgxpool.Config, error) {
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
	// Pool connection construction may outlive the canceled Acquire caller.
	// Bound every new connection, not only the initial startup Ping.
	if config.ConnConfig.ConnectTimeout == 0 || config.ConnConfig.ConnectTimeout > 5*time.Second {
		config.ConnConfig.ConnectTimeout = 5 * time.Second
	}
	if logger != nil {
		config.ConnConfig.Tracer = &poolTracer{logger: logger, slow: time.Second}
	}
	return config, nil
}

// PostgresReadiness is kept separate from liveness, so dependency outages
// yield /ready=503 without stopping the process or exposing connection data.
type PostgresReadiness struct{ Pool *pgxpool.Pool }

func (check PostgresReadiness) Ready(ctx context.Context) error {
	if check.Pool == nil {
		return fmt.Errorf("Postgres pool is unavailable")
	}
	return schemaReady(ctx, check.Pool)
}

type rowQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// Accepting a transaction allows destructive regression fixtures to remain
// uncommitted and invisible to tests sharing the isolated database.
func schemaReady(ctx context.Context, db rowQuerier) error {
	var migrated bool
	err := db.QueryRow(ctx, `select
  to_regclass('signalgen.account_profiles') is not null and
  to_regclass('signalgen.feature_grants') is not null and
  to_regclass('signalgen.app_sessions') is not null and
  to_regclass('signalgen.account_device_state') is not null and
  to_regclass('signalgen.user_rules') is not null and
  to_regclass('signalgen.compute_grants') is not null and
  to_regclass('signalgen.operator_bootstrap_state') is not null and
  to_regclass('signalgen.audit_events') is not null and
  to_regclass('signalgen.subscription_plans') is not null and
  to_regclass('signalgen.subscription_plan_features') is not null and
  to_regclass('signalgen.subscriptions') is not null and
  to_regclass('signalgen.subscription_events') is not null and
  to_regclass('signalgen.stock_catalog') is not null and
  to_regclass('signalgen.stock_universes') is not null and
  to_regclass('signalgen.stock_universe_members') is not null and
  to_regclass('signalgen.workspace_state') is not null and
  (select count(*)=5 from pg_attribute
   where attrelid=to_regclass('signalgen.workspace_state')
     and attname in ('user_id','kind','data','version','updated_at')
     and not attisdropped) and
  (select count(*)=4 from pg_attribute
   where attrelid=to_regclass('signalgen.account_profiles')
     and attname in ('display_name','bio','profile_version','profile_updated_at')
     and not attisdropped) and
  exists (select 1 from pg_constraint
    where conrelid=to_regclass('signalgen.audit_events')
      and conname='audit_events_action_check' and contype='c' and convalidated
      and pg_get_constraintdef(oid) like '%account.status_changed%') and
  exists (select 1 from pg_index
    where indexrelid=to_regclass('signalgen.audit_events_target_id_idx')
      and indrelid=to_regclass('signalgen.audit_events') and indisvalid and indisready) and
  exists (select 1 from pg_trigger
    where tgrelid=to_regclass('signalgen.audit_events')
      and tgname='reject_audit_update' and tgenabled in ('O','A') and not tgisinternal) and
  (select count(*)=16 and bool_and(relrowsecurity) from pg_class
    where relnamespace=to_regnamespace('signalgen') and relkind='r'
      and relname in ('account_profiles','feature_grants','app_sessions',
        'account_device_state','user_rules','compute_grants','operator_bootstrap_state',
        'audit_events','subscription_plans','subscription_plan_features',
        'subscriptions','subscription_events','stock_catalog','stock_universes',
        'stock_universe_members','workspace_state'))`).Scan(&migrated)
	if err != nil {
		return fmt.Errorf("Postgres readiness: %w", err)
	}
	if !migrated {
		return fmt.Errorf("Postgres migration is incomplete")
	}
	return nil
}

// RuntimePrivileges is intentionally separate from schema readiness: migration
// tools/tests may use an admin pool, but the HTTP process must not use one.
type RuntimePrivileges struct{ Pool *pgxpool.Pool }

func (check RuntimePrivileges) Ready(ctx context.Context) error {
	if check.Pool == nil {
		return fmt.Errorf("Postgres pool is unavailable")
	}
	return runtimeReady(ctx, check.Pool)
}

// A transaction lets local tests revoke privileges without changing the
// shared test database or any cloud role. Production passes the runtime pool.
func runtimeReady(ctx context.Context, db rowQuerier) error {
	var safe bool
	err := db.QueryRow(ctx, `select
  current_user='signalgen_api' and session_user=current_user
  and not rolsuper and not rolbypassrls
  and not rolcreaterole and not rolcreatedb and not rolreplication
  and not has_schema_privilege(current_user,'signalgen','CREATE')
  and not has_schema_privilege(current_user,'public','CREATE')
  and not has_schema_privilege(current_user,'legacy','USAGE')
  and not has_table_privilege(current_user,'signalgen.audit_events','UPDATE,DELETE,TRUNCATE')
  and not has_table_privilege(current_user,'signalgen.operator_bootstrap_state','INSERT,UPDATE,DELETE')
  and not exists (select 1 from pg_auth_members where member=(select oid from pg_roles where rolname=current_user))
from pg_roles where rolname=current_user`).Scan(&safe)
	if err != nil {
		return fmt.Errorf("inspect runtime privileges: %w", err)
	}
	if !safe {
		return fmt.Errorf("HTTP runtime requires the restricted signalgen_api role")
	}
	return runtimeAccessReady(ctx, db)
}
