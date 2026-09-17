package compute

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

func TestComputeGrantBindingAndExpiry(t *testing.T) {
	now := time.Date(2026, 9, 18, 0, 0, 0, 0, time.UTC)
	db, err := sql.Open("sqlite", "file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	store, err := NewStore(db,
		WithClock(func() time.Time { return now }),
		WithTTL(time.Minute),
		WithRandom(bytes.NewReader(bytes.Repeat([]byte{9}, 64))),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	grant, err := store.Create(context.Background(), CreateRequest{
		UserID: "user-a", SessionID: "ses-a", Purpose: "screen",
		DatasetID: "dataset-a", DatasetVersion: "v1", DatasetChecksum: "sha256:data",
		RuleID: "rule-a", DefinitionHash: "sha256:rule",
		EngineVersion: "core-0.2.0", SchemaVersion: "signal-baseline-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Verify(context.Background(), "user-a", "ses-a", grant.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Verify(context.Background(), "user-b", "ses-a", grant.ID); !errors.Is(err, ErrInvalid) {
		t.Fatalf("cross-user error = %v", err)
	}
	now = now.Add(time.Minute)
	if _, err := store.Verify(context.Background(), "user-a", "ses-a", grant.ID); !errors.Is(err, ErrExpired) {
		t.Fatalf("expired error = %v", err)
	}
}

func TestComputeGrantRejectsIncompleteBinding(t *testing.T) {
	db, err := sql.Open("sqlite", "file:invalid_compute?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	store, _ := NewStore(db)
	_ = store.Migrate(context.Background())
	if _, err := store.Create(context.Background(), CreateRequest{}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("error = %v, want ErrInvalid", err)
	}
}
