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

func TestUnknownFeatureIsRejected(t *testing.T) {
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	store := testStore(t, func() time.Time { return now })
	_, _ = store.EnsureProfile(context.Background(), "user-a", "user@example.com")
	if err := store.GrantFeature(context.Background(), "user-a", "admin", now.Add(time.Hour), "bad"); !errors.Is(err, ErrInvalidValue) {
		t.Fatalf("error = %v, want ErrInvalidValue", err)
	}
}
