// Command schematest verifies SignalGen's migrations and RLS contract against
// an empty, local PostgreSQL database. It deliberately refuses remote hosts and
// any database whose name is not exactly signalgen_test.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const testDatabaseEnv = "SIGNALGEN_TEST_PG_URL"

func main() {
	var repoRoot string
	flag.StringVar(&repoRoot, "repo-root", "..", "repository root containing supabase/")
	flag.Parse()

	if err := run(repoRoot, os.Getenv(testDatabaseEnv)); err != nil {
		fmt.Fprintln(os.Stderr, "schematest:", err)
		os.Exit(1)
	}
}

func run(repoRoot, databaseURL string) error {
	if err := validateTestDatabaseURL(databaseURL); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("connect to isolated PostgreSQL test database: %w", err)
	}
	defer conn.Close(context.Background())

	if err := requireFreshDatabase(ctx, conn); err != nil {
		return err
	}

	stubPath := filepath.Join(repoRoot, "supabase", "tests", "local_auth_stub.sql")
	if err := executeSQLFile(ctx, conn, stubPath); err != nil {
		return err
	}

	migrationPattern := filepath.Join(repoRoot, "supabase", "migrations", "*.sql")
	migrations, err := filepath.Glob(migrationPattern)
	if err != nil {
		return fmt.Errorf("find migrations: %w", err)
	}
	if len(migrations) == 0 {
		return fmt.Errorf("no migrations found at %s", migrationPattern)
	}
	sort.Strings(migrations)
	for _, migration := range migrations {
		if err := executeSQLFile(ctx, conn, migration); err != nil {
			return err
		}
	}

	// ownership.sql intentionally chooses the first two Auth identities. Seed
	// deterministic fixtures without printing their generated UUID values.
	if _, err := conn.Exec(ctx, `
insert into auth.users (email, created_at) values
  ('schema-owner@test.invalid', now() - interval '1 minute'),
  ('schema-other@test.invalid', now());`); err != nil {
		return fmt.Errorf("seed isolated Auth users: %w", err)
	}

	checks := []string{
		filepath.Join(repoRoot, "supabase", "tests", "schema_boundaries.sql"),
		filepath.Join(repoRoot, "supabase", "tests", "ownership.sql"),
	}
	for _, check := range checks {
		if err := executeSQLFile(ctx, conn, check); err != nil {
			return err
		}
	}

	fmt.Printf("schema test passed: %d migrations, %d policy checks\n", len(migrations), len(checks))
	return nil
}

func validateTestDatabaseURL(raw string) error {
	if strings.TrimSpace(raw) == "" {
		return fmt.Errorf("%s is required", testDatabaseEnv)
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid %s", testDatabaseEnv)
	}
	if parsed.Scheme != "postgres" && parsed.Scheme != "postgresql" {
		return fmt.Errorf("%s must use postgres:// or postgresql://", testDatabaseEnv)
	}
	config, err := pgx.ParseConfig(raw)
	if err != nil {
		return fmt.Errorf("invalid %s", testDatabaseEnv)
	}
	// Inspect pgx's effective config as well as the visible URL. This prevents a
	// query-string option from silently redirecting the connection elsewhere.
	if (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") ||
		(config.Host != "127.0.0.1" && config.Host != "localhost") {
		return errors.New("schema tests only accept a loopback PostgreSQL host")
	}
	if parsed.Path != "/signalgen_test" || config.Database != "signalgen_test" {
		return errors.New("schema tests require a database named exactly signalgen_test")
	}
	return nil
}

func requireFreshDatabase(ctx context.Context, conn *pgx.Conn) error {
	var hasApplicationSchema bool
	err := conn.QueryRow(ctx, `select
  to_regnamespace('auth') is not null or
  to_regnamespace('signalgen') is not null or
  to_regnamespace('legacy') is not null`).Scan(&hasApplicationSchema)
	if err != nil {
		return fmt.Errorf("inspect isolated test database: %w", err)
	}
	if hasApplicationSchema {
		return errors.New("signalgen_test must be empty; refusing to overwrite existing schemas")
	}
	return nil
}

func executeSQLFile(ctx context.Context, conn *pgx.Conn, path string) error {
	script, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	if _, err := conn.Exec(ctx, string(script), pgx.QueryExecModeSimpleProtocol); err != nil {
		return fmt.Errorf("execute %s: %w", path, err)
	}
	return nil
}
