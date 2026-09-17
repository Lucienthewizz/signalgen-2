package session

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func testStore(t *testing.T, clock func() time.Time, ttl time.Duration) (*Store, *sql.DB) {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	randomBytes := make([]byte, 4096)
	for index := range randomBytes {
		randomBytes[index] = byte(index)
	}
	store, err := NewStore(db,
		WithClock(clock),
		WithTTL(ttl),
		WithRandom(bytes.NewReader(randomBytes)),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return store, db
}

func TestCreateAndVerifySession(t *testing.T) {
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	store, db := testStore(t, func() time.Time { return now }, 24*time.Hour)
	created, err := store.Create(context.Background(), "user-a", "install-a", "Chrome on Mac")
	if err != nil {
		t.Fatal(err)
	}
	if created.Token == "" || created.Session.UserID != "user-a" {
		t.Fatalf("created = %+v", created)
	}

	var storedToken string
	if err := db.QueryRow("SELECT hex(token_hash) FROM app_sessions WHERE id = ?", created.Session.ID).Scan(&storedToken); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(storedToken, created.Token) {
		t.Fatal("raw session token was persisted")
	}

	verified, err := store.Verify(context.Background(), "user-a", created.Token)
	if err != nil {
		t.Fatal(err)
	}
	if verified.ID != created.Session.ID || verified.InstallationID != "install-a" {
		t.Fatalf("verified = %+v", verified)
	}
}

func TestSessionCannotCrossUsers(t *testing.T) {
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	store, _ := testStore(t, func() time.Time { return now }, time.Hour)
	created, _ := store.Create(context.Background(), "user-a", "install-a", "Browser")
	if _, err := store.Verify(context.Background(), "user-b", created.Token); !errors.Is(err, ErrInvalid) {
		t.Fatalf("error = %v, want ErrInvalid", err)
	}
}

func TestSessionExpires(t *testing.T) {
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	store, _ := testStore(t, func() time.Time { return now }, time.Hour)
	created, _ := store.Create(context.Background(), "user-a", "install-a", "Browser")
	now = now.Add(time.Hour)
	if _, err := store.Verify(context.Background(), "user-a", created.Token); !errors.Is(err, ErrExpired) {
		t.Fatalf("error = %v, want ErrExpired", err)
	}
}

func TestRevokedSessionCannotBeReused(t *testing.T) {
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	store, _ := testStore(t, func() time.Time { return now }, time.Hour)
	created, _ := store.Create(context.Background(), "user-a", "install-a", "Browser")
	if err := store.Revoke(context.Background(), "user-a", created.Token); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Verify(context.Background(), "user-a", created.Token); !errors.Is(err, ErrRevoked) {
		t.Fatalf("error = %v, want ErrRevoked", err)
	}
}

func TestCreateRejectsIncompleteRequest(t *testing.T) {
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	store, _ := testStore(t, func() time.Time { return now }, time.Hour)
	if _, err := store.Create(context.Background(), "user-a", "", "Browser"); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("error = %v, want ErrInvalidRequest", err)
	}
}

func TestListSessionsIsOwnerScoped(t *testing.T) {
	now := time.Date(2026, 9, 18, 10, 0, 0, 0, time.UTC)
	store, _ := testStore(t, func() time.Time { return now }, time.Hour)
	createdA, err := store.Create(context.Background(), "user-a", "install-a", "Chrome")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create(context.Background(), "user-b", "install-b", "Firefox"); err != nil {
		t.Fatal(err)
	}
	sessions, err := store.List(context.Background(), "user-a")
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 || sessions[0].ID != createdA.Session.ID || sessions[0].UserID != "user-a" {
		t.Fatalf("sessions = %+v", sessions)
	}
}

func TestRevokeByIDIsOwnerScopedAndIdempotent(t *testing.T) {
	now := time.Date(2026, 9, 18, 10, 0, 0, 0, time.UTC)
	store, _ := testStore(t, func() time.Time { return now }, time.Hour)
	created, err := store.Create(context.Background(), "user-a", "install-a", "Chrome")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RevokeByID(context.Background(), "user-b", created.Session.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-user error = %v, want ErrNotFound", err)
	}
	if err := store.RevokeByID(context.Background(), "user-a", created.Session.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.RevokeByID(context.Background(), "user-a", created.Session.ID); err != nil {
		t.Fatalf("idempotent revoke error = %v", err)
	}
	if _, err := store.Verify(context.Background(), "user-a", created.Token); !errors.Is(err, ErrRevoked) {
		t.Fatalf("verify error = %v, want ErrRevoked", err)
	}
}
