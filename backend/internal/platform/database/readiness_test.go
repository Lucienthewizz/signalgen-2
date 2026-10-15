package database

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Schema regressions stay inside rolled-back transactions in an isolated DB.
// No cloud URL, host override or fallback is accepted for mutation fixtures.
func TestReadinessRejectsIncompleteAdminSchema(t *testing.T) {
	raw := os.Getenv("SIGNALGEN_TEST_PG_URL")
	if raw == "" {
		t.Skip("set SIGNALGEN_TEST_PG_URL for local readiness regression")
	}
	config, err := pgxpool.ParseConfig(raw)
	if err != nil || config.ConnConfig.Database != "signalgen_test" || (config.ConnConfig.Host != "127.0.0.1" && config.ConnConfig.Host != "localhost") || len(config.ConnConfig.Fallbacks) != 0 {
		t.Fatal("readiness regressions require isolated signalgen_test on loopback")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := OpenPostgres(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := (PostgresReadiness{Pool: pool}).Ready(ctx); err != nil {
		t.Fatal(err)
	}
	if err := (RuntimePrivileges{Pool: pool}).Ready(ctx); err == nil {
		t.Fatal("admin connection accepted as HTTP runtime")
	}
	for _, tc := range []struct{ name, sql string }{
		{"old_action_constraint", `alter table signalgen.audit_events drop constraint audit_events_action_check;
alter table signalgen.audit_events add constraint audit_events_action_check check(action in('feature.grant','feature.revoke','account.bootstrap_operator','account.role_changed')) not valid`},
		{"missing_audit_index", `drop index signalgen.audit_events_target_id_idx`},
		{"disabled_audit_trigger", `alter table signalgen.audit_events disable trigger reject_audit_update`},
		{"disabled_rules_rls", `alter table signalgen.user_rules disable row level security`},
		{"missing_bootstrap_table", `alter table signalgen.operator_bootstrap_state rename to incomplete_bootstrap_state`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			// No user input is bound to these fixed multi-statement fixtures.
			if _, err := tx.Exec(ctx, tc.sql, pgx.QueryExecModeSimpleProtocol); err != nil {
				t.Fatal(err)
			}
			if err := schemaReady(ctx, tx); err == nil {
				t.Fatal("incomplete schema incorrectly reported ready")
			}
		})
	}
}

// Both a complete migration and its least-privilege runtime access are needed.
// These fixed fixtures change only the local transaction; rollback restores
// permissions, policies and session authorization before returning the pool.
func TestRuntimeReadinessRejectsIncompleteAccess(t *testing.T) {
	raw := os.Getenv("SIGNALGEN_TEST_PG_URL")
	if raw == "" {
		t.Skip("set SIGNALGEN_TEST_PG_URL for local runtime access regression")
	}
	config, err := pgxpool.ParseConfig(raw)
	if err != nil || config.ConnConfig.Database != "signalgen_test" || (config.ConnConfig.Host != "127.0.0.1" && config.ConnConfig.Host != "localhost") || len(config.ConnConfig.Fallbacks) != 0 {
		t.Fatal("runtime regressions require isolated signalgen_test on loopback")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := OpenPostgres(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	for _, tc := range []struct {
		name, sql string
		ready     bool
	}{
		{"complete_access", "", true},
		{"missing_rules_insert", `revoke insert on signalgen.user_rules from signalgen_api`, false},
		{"missing_profile_update", `revoke update on signalgen.account_profiles from signalgen_api`, false},
		{"missing_schema_usage", `revoke usage on schema signalgen from signalgen_api`, false},
		{"missing_audit_sequence", `revoke usage on sequence signalgen.audit_events_id_seq from signalgen_api`, false},
		{"missing_subscription_sequence", `revoke usage on sequence signalgen.subscription_events_id_seq from signalgen_api`, false},
		{"missing_rules_select_policy", `drop policy backend_select on signalgen.user_rules`, false},
		{"wrong_policy_role", `alter policy backend_select on signalgen.user_rules to authenticated`, false},
		{"denied_policy_read", `alter policy backend_select on signalgen.user_rules using (false)`, false},
		{"denied_policy_write", `alter policy backend_insert on signalgen.user_rules with check (false)`, false},
		{"wrong_policy_operation", `drop policy backend_select on signalgen.user_rules;
create policy backend_select on signalgen.user_rules for insert to signalgen_api with check (true)`, false},
		{"restrictive_only_policy", `drop policy backend_select on signalgen.user_rules;
create policy backend_select on signalgen.user_rules as restrictive for select to signalgen_api using (true)`, false},
		{"extra_restrictive_policy", `create policy accidental_deny on signalgen.user_rules as restrictive for select to signalgen_api using (false)`, false},
		{"extra_public_restrictive_policy", `create policy accidental_deny on signalgen.user_rules as restrictive for all to public using (false)`, false},
		// An unrelated client-only policy must not break the trusted Go role.
		{"client_only_restrictive_policy", `create policy client_deny on signalgen.user_rules as restrictive for select to authenticated using (false)`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(context.Background())
			if tc.sql != "" {
				if _, err := tx.Exec(ctx, tc.sql, pgx.QueryExecModeSimpleProtocol); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := tx.Exec(ctx, "set local session authorization signalgen_api"); err != nil {
				t.Fatal(err)
			}
			err = runtimeReady(ctx, tx)
			if (err == nil) != tc.ready {
				t.Fatalf("ready=%t, want %t: %v", err == nil, tc.ready, err)
			}
		})
	}
	// The successful fixture must not leave a privileged test connection logged
	// in as the runtime role. Otherwise later DDL tests could fail misleadingly.
	var actor string
	if err := pool.QueryRow(ctx, "select session_user").Scan(&actor); err != nil || actor != config.ConnConfig.User {
		t.Fatalf("test session authorization was not restored: %v", err)
	}
}
