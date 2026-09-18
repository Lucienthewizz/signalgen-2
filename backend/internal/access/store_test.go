package access

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func testStore(t *testing.T, clock func() time.Time) *Store {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	store, err := NewStore(db, WithClock(clock))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	return store
}

func TestEnsureProfileUsesSafeDefaultsAndPreservesStatus(t *testing.T) {
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	store := testStore(t, func() time.Time { return now })
	account, err := store.EnsureProfile(context.Background(), "user-a", "first@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if account.Role != RoleUser || account.Status != StatusActive {
		t.Fatalf("account = %+v", account)
	}
	if err := store.SetStatus(context.Background(), "user-a", StatusSuspended); err != nil {
		t.Fatal(err)
	}
	account, err = store.EnsureProfile(context.Background(), "user-a", "new@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if account.Status != StatusSuspended || account.Role != RoleUser || account.Email != "new@example.com" {
		t.Fatalf("updated account = %+v", account)
	}
}

func TestFeatureGrantExpiryAndRevocation(t *testing.T) {
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	store := testStore(t, func() time.Time { return now })
	_, _ = store.EnsureProfile(context.Background(), "user-a", "user@example.com")
	if err := store.GrantFeature(context.Background(), "user-a", FeatureScreener, now.Add(time.Hour), "demo access"); err != nil {
		t.Fatal(err)
	}
	if err := store.RequireFeature(context.Background(), "user-a", FeatureScreener); err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Hour)
	if err := store.RequireFeature(context.Background(), "user-a", FeatureScreener); !errors.Is(err, ErrEntitlementMissing) {
		t.Fatalf("expired error = %v", err)
	}

	if err := store.GrantFeature(context.Background(), "user-a", FeatureScreener, now.Add(time.Hour), "renewed demo"); err != nil {
		t.Fatal(err)
	}
	if err := store.RevokeFeature(context.Background(), "user-a", FeatureScreener); err != nil {
		t.Fatal(err)
	}
	if err := store.RequireFeature(context.Background(), "user-a", FeatureScreener); !errors.Is(err, ErrEntitlementMissing) {
		t.Fatalf("revoked error = %v", err)
	}
}

func TestFeatureGrantsReturnsOperatorRecordState(t *testing.T) {
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	store := testStore(t, func() time.Time { return now })
	_, _ = store.EnsureProfile(context.Background(), "user-a", "user@example.com")
	if _, err := store.GrantFeatureAudited(
		context.Background(), "operator-a", "req_grant", "user-a", FeatureScreener,
		now.Add(time.Hour), "demo",
	); err != nil {
		t.Fatal(err)
	}
	grants, err := store.FeatureGrants(context.Background(), "user-a")
	if err != nil || len(grants) != 1 || !grants[0].Active || grants[0].UserID != "user-a" {
		t.Fatalf("active grants = %+v, error = %v", grants, err)
	}
	if err := store.RevokeFeatureAudited(
		context.Background(), "operator-a", "req_revoke", "user-a", FeatureScreener, "complete",
	); err != nil {
		t.Fatal(err)
	}
	grants, err = store.FeatureGrants(context.Background(), "user-a")
	if err != nil || len(grants) != 1 || grants[0].Active || grants[0].RevokedAt == nil {
		t.Fatalf("revoked grants = %+v, error = %v", grants, err)
	}
	if _, err := store.FeatureGrants(context.Background(), "missing"); !errors.Is(err, ErrAccountNotFound) {
		t.Fatalf("missing account error = %v", err)
	}
}

func TestSuspendedAccountIsDenied(t *testing.T) {
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	store := testStore(t, func() time.Time { return now })
	_, _ = store.EnsureProfile(context.Background(), "user-a", "user@example.com")
	_ = store.GrantFeature(context.Background(), "user-a", FeatureBacktest, now.Add(time.Hour), "demo")
	_ = store.SetStatus(context.Background(), "user-a", StatusSuspended)
	if err := store.RequireFeature(context.Background(), "user-a", FeatureBacktest); !errors.Is(err, ErrAccountSuspended) {
		t.Fatalf("error = %v, want ErrAccountSuspended", err)
	}
}

func TestRequireOperatorUsesServerRoleAndActiveStatus(t *testing.T) {
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	store := testStore(t, func() time.Time { return now })
	_, _ = store.EnsureProfile(context.Background(), "user-a", "user@example.com")
	if _, err := store.RequireOperator(context.Background(), "user-a"); !errors.Is(err, ErrRoleRequired) {
		t.Fatalf("default user error = %v, want ErrRoleRequired", err)
	}
	if _, err := store.db.Exec(
		"UPDATE account_profiles SET role = ? WHERE user_id = ?", RoleOperator, "user-a",
	); err != nil {
		t.Fatal(err)
	}
	account, err := store.RequireOperator(context.Background(), "user-a")
	if err != nil || account.Role != RoleOperator {
		t.Fatalf("operator account = %+v, error = %v", account, err)
	}
	if err := store.SetStatus(context.Background(), "user-a", StatusSuspended); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RequireOperator(context.Background(), "user-a"); !errors.Is(err, ErrAccountSuspended) {
		t.Fatalf("suspended operator error = %v, want ErrAccountSuspended", err)
	}
}

func TestBootstrapOperatorAllowsOnlyFirstActiveAccountAndAudits(t *testing.T) {
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	store := testStore(t, func() time.Time { return now })
	_, _ = store.EnsureProfile(context.Background(), "user-a", "first@example.com")
	_, _ = store.EnsureProfile(context.Background(), "user-b", "second@example.com")
	if err := store.BootstrapOperator(
		context.Background(), "local:lucien", "cli_bootstrap", "user-a", "initial project operator",
	); err != nil {
		t.Fatal(err)
	}
	account, err := store.RequireOperator(context.Background(), "user-a")
	if err != nil || account.Role != RoleOperator {
		t.Fatalf("operator account = %+v, error = %v", account, err)
	}
	// Even direct database tampering that removes the role must not reopen the
	// one-time bootstrap path.
	if _, err := store.db.Exec(
		"UPDATE account_profiles SET role = ? WHERE user_id = ?", RoleUser, "user-a",
	); err != nil {
		t.Fatal(err)
	}
	if err := store.BootstrapOperator(
		context.Background(), "local:other", "cli_second", "user-b", "second operator",
	); !errors.Is(err, ErrBootstrapClosed) {
		t.Fatalf("second bootstrap error = %v, want ErrBootstrapClosed", err)
	}
	second, err := store.Account(context.Background(), "user-b")
	if err != nil || second.Role != RoleUser {
		t.Fatalf("second account = %+v, error = %v", second, err)
	}
	events, err := store.AuditEvents(context.Background(), "user-a")
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Action != "account.bootstrap_operator" || events[0].Feature != "" {
		t.Fatalf("bootstrap events = %+v", events)
	}
	var before, after AccountRoleState
	if err := json.Unmarshal(events[0].Before, &before); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(events[0].After, &after); err != nil {
		t.Fatal(err)
	}
	if before.Role != RoleUser || after.Role != RoleOperator || events[0].Actor != "local:lucien" {
		t.Fatalf("before=%+v after=%+v event=%+v", before, after, events[0])
	}
}

func TestBootstrapOperatorRejectsMissingOrSuspendedAccount(t *testing.T) {
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	store := testStore(t, func() time.Time { return now })
	if err := store.BootstrapOperator(
		context.Background(), "local:lucien", "cli_missing", "missing", "initial operator",
	); !errors.Is(err, ErrAccountNotFound) {
		t.Fatalf("missing account error = %v", err)
	}
	_, _ = store.EnsureProfile(context.Background(), "user-a", "user@example.com")
	_ = store.SetStatus(context.Background(), "user-a", StatusSuspended)
	if err := store.BootstrapOperator(
		context.Background(), "local:lucien", "cli_suspended", "user-a", "initial operator",
	); !errors.Is(err, ErrAccountSuspended) {
		t.Fatalf("suspended account error = %v", err)
	}
}

func TestMigrateSealsDatabaseWithExistingOperator(t *testing.T) {
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	store := testStore(t, func() time.Time { return now })
	_, _ = store.EnsureProfile(context.Background(), "legacy-operator", "operator@example.com")
	_, _ = store.EnsureProfile(context.Background(), "user-b", "user@example.com")
	if _, err := store.db.Exec(
		"UPDATE account_profiles SET role = ? WHERE user_id = ?", RoleOperator, "legacy-operator",
	); err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.Exec(
		"UPDATE account_profiles SET role = ? WHERE user_id = ?", RoleUser, "legacy-operator",
	); err != nil {
		t.Fatal(err)
	}
	if err := store.BootstrapOperator(
		context.Background(), "local:other", "cli_reopen", "user-b", "try reopen",
	); !errors.Is(err, ErrBootstrapClosed) {
		t.Fatalf("reopened bootstrap error = %v, want ErrBootstrapClosed", err)
	}
}

func TestUnknownFeatureIsRejected(t *testing.T) {
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	store := testStore(t, func() time.Time { return now })
	_, _ = store.EnsureProfile(context.Background(), "user-a", "user@example.com")
	if err := store.GrantFeature(context.Background(), "user-a", "admin", now.Add(time.Hour), "bad"); !errors.Is(err, ErrInvalidValue) {
		t.Fatalf("error = %v, want ErrInvalidValue", err)
	}
}

func TestGrantAndRevokeWriteImmutableAuditStates(t *testing.T) {
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	store := testStore(t, func() time.Time { return now })
	_, _ = store.EnsureProfile(context.Background(), "user-a", "user@example.com")
	if _, err := store.GrantFeatureAudited(
		context.Background(), "operator-a", "cli_grant", "user-a", FeatureScreener, now.Add(time.Hour), "demo access",
	); err != nil {
		t.Fatal(err)
	}
	now = now.Add(10 * time.Minute)
	if err := store.RevokeFeatureAudited(
		context.Background(), "operator-a", "cli_revoke", "user-a", FeatureScreener, "demo complete",
	); err != nil {
		t.Fatal(err)
	}
	events, err := store.AuditEvents(context.Background(), "user-a")
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 {
		t.Fatalf("events = %+v", events)
	}
	grantEvent, revokeEvent := events[0], events[1]
	var grantedState GrantState
	if err := json.Unmarshal(grantEvent.After, &grantedState); err != nil {
		t.Fatal(err)
	}
	var beforeRevoke, afterRevoke GrantState
	if err := json.Unmarshal(revokeEvent.Before, &beforeRevoke); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(revokeEvent.After, &afterRevoke); err != nil {
		t.Fatal(err)
	}
	if grantEvent.Before != nil || grantEvent.After == nil || grantedState.RevokedAt != nil ||
		grantEvent.Actor != "operator-a" || grantEvent.RequestID != "cli_grant" {
		t.Fatalf("grant event = %+v", grantEvent)
	}
	if revokeEvent.Before == nil || beforeRevoke.RevokedAt != nil ||
		revokeEvent.After == nil || afterRevoke.RevokedAt == nil || revokeEvent.Reason != "demo complete" {
		t.Fatalf("revoke event = %+v", revokeEvent)
	}
	if _, err := store.db.Exec("UPDATE audit_events SET reason = 'tampered' WHERE id = ?", grantEvent.ID); err == nil {
		t.Fatal("audit update unexpectedly succeeded")
	}
	if _, err := store.db.Exec("DELETE FROM audit_events WHERE id = ?", grantEvent.ID); err == nil {
		t.Fatal("audit delete unexpectedly succeeded")
	}
}

func TestGrantFailureRollsBackAuditAndState(t *testing.T) {
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	store := testStore(t, func() time.Time { return now })
	_, err := store.GrantFeatureAudited(
		context.Background(), "operator-a", "cli_missing", "missing-user", FeatureScreener, now.Add(time.Hour), "invalid target",
	)
	if err == nil {
		t.Fatal("expected grant failure for missing account")
	}
	var grants, audits int
	if err := store.db.QueryRow("SELECT COUNT(*) FROM feature_grants").Scan(&grants); err != nil {
		t.Fatal(err)
	}
	if err := store.db.QueryRow("SELECT COUNT(*) FROM audit_events").Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if grants != 0 || audits != 0 {
		t.Fatalf("grants=%d audits=%d", grants, audits)
	}
}

func TestAuditedMutationRequiresActorRequestAndReason(t *testing.T) {
	now := time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	store := testStore(t, func() time.Time { return now })
	_, _ = store.EnsureProfile(context.Background(), "user-a", "user@example.com")
	for _, test := range []struct {
		actor, requestID, reason string
	}{
		{"", "cli_1", "demo"},
		{"operator-a", "", "demo"},
		{"operator-a", "cli_1", ""},
	} {
		_, err := store.GrantFeatureAudited(
			context.Background(), test.actor, test.requestID, "user-a", FeatureScreener, now.Add(time.Hour), test.reason,
		)
		if !errors.Is(err, ErrInvalidValue) {
			t.Fatalf("actor=%q request=%q reason=%q error=%v", test.actor, test.requestID, test.reason, err)
		}
	}
	events, err := store.AuditEvents(context.Background(), "user-a")
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 0 {
		t.Fatalf("events = %+v", events)
	}
}

func TestMigratePreservesLegacyAuditRowsAndAddsBootstrapAction(t *testing.T) {
	db, err := sql.Open("sqlite", "file:legacy_audit_migration?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	defer db.Close()
	_, err = db.Exec(`
CREATE TABLE audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('feature.grant', 'feature.revoke')),
    target_user_id TEXT NOT NULL,
    feature TEXT NOT NULL CHECK (feature IN ('screener', 'backtest')),
    reason TEXT NOT NULL,
    request_id TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    created_at INTEGER NOT NULL
);
INSERT INTO audit_events (
    actor, action, target_user_id, feature, reason, request_id, after_json, created_at
) VALUES ('legacy', 'feature.grant', 'user-a', 'screener', 'legacy grant', 'legacy_1', '{}', 1);
`)
	if err != nil {
		t.Fatal(err)
	}
	store, err := NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	events, err := store.AuditEvents(context.Background(), "user-a")
	if err != nil || len(events) != 1 || events[0].RequestID != "legacy_1" {
		t.Fatalf("legacy events = %+v, error = %v", events, err)
	}
	var definition string
	if err := db.QueryRow(
		"SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'audit_events'",
	).Scan(&definition); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(definition, "account.bootstrap_operator") {
		t.Fatalf("audit schema was not upgraded: %s", definition)
	}
}
