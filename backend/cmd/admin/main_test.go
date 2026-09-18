package main

import (
	"bytes"
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
)

func TestGrantAndRevokeCommands(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "admin-test.db")
	store, err := access.OpenSQLite(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.EnsureProfile(context.Background(), "user-a", "user@example.com"); err != nil {
		t.Fatal(err)
	}
	store.Close()

	getenv := func(name string) string {
		if name == "SIGNALGEN_GO_DB_PATH" {
			return databasePath
		}
		return ""
	}
	var stdout, stderr bytes.Buffer
	until := time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339)
	code := run([]string{"grant", "--user", "user-a", "--feature", "screener", "--until", until, "--reason", "demo", "--actor", "operator-a"}, getenv, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("grant exit = %d, stderr = %s", code, stderr.String())
	}

	store, err = access.OpenSQLite(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RequireFeature(context.Background(), "user-a", access.FeatureScreener); err != nil {
		t.Fatal(err)
	}
	events, err := store.AuditEvents(context.Background(), "user-a")
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Actor != "operator-a" || events[0].Action != "feature.grant" || events[0].RequestID == "" {
		t.Fatalf("grant audit events = %+v", events)
	}
	store.Close()

	stdout.Reset()
	stderr.Reset()
	code = run([]string{"revoke", "--user", "user-a", "--feature", "screener", "--reason", "demo complete", "--actor", "operator-a"}, getenv, &stdout, &stderr)
	if code != 0 {
		t.Fatalf("revoke exit = %d, stderr = %s", code, stderr.String())
	}
	store, err = access.OpenSQLite(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	events, err = store.AuditEvents(context.Background(), "user-a")
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[1].Action != "feature.revoke" || events[1].Reason != "demo complete" {
		t.Fatalf("all audit events = %+v", events)
	}
}

func TestCommandRequiresDatabasePath(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := run([]string{"grant"}, func(string) string { return "" }, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("exit = %d, want 2", code)
	}
}
