package access

import (
	"context"
	"database/sql"
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
	if err := store.GrantFeatureAudited(
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
	if grantEvent.Before != nil || grantEvent.After == nil || grantEvent.After.RevokedAt != nil ||
		grantEvent.Actor != "operator-a" || grantEvent.RequestID != "cli_grant" {
		t.Fatalf("grant event = %+v", grantEvent)
	}
	if revokeEvent.Before == nil || revokeEvent.Before.RevokedAt != nil ||
		revokeEvent.After == nil || revokeEvent.After.RevokedAt == nil || revokeEvent.Reason != "demo complete" {
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
	err := store.GrantFeatureAudited(
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
		err := store.GrantFeatureAudited(
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
