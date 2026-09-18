package rules

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	_ "modernc.org/sqlite"
)

func testStore(t *testing.T) (*Store, *access.Store) {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+t.Name()+"?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	accessStore, err := access.NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := accessStore.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	ruleStore, err := NewStore(db, WithClock(func() time.Time {
		return time.Date(2026, 9, 18, 12, 0, 0, 0, time.UTC)
	}))
	if err != nil {
		t.Fatal(err)
	}
	if err := ruleStore.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	return ruleStore, accessStore
}

func validDefinition(name string) core.RuleSnapshot {
	return core.RuleSnapshot{
		Name: name, Logic: "AND", SignalType: "BUY", CooldownSec: 60,
		Conditions: []core.Condition{{Left: "EMA9", Op: ">", Right: "EMA20"}},
	}
}

func TestRuleCRUDIsOwnerScopedAndVersioned(t *testing.T) {
	store, accounts := testStore(t)
	_, _ = accounts.EnsureProfile(context.Background(), "user-a", "a@example.com")
	_, _ = accounts.EnsureProfile(context.Background(), "user-b", "b@example.com")
	created, err := store.Create(context.Background(), "user-a", validDefinition("My rule"))
	if err != nil {
		t.Fatal(err)
	}
	if created.Version != 1 || created.OwnerType != "user" || created.ReadOnly || created.DefinitionHash == "" {
		t.Fatalf("created rule = %+v", created)
	}
	items, err := store.List(context.Background(), "user-a")
	if err != nil || len(items) != 1 || items[0].ID != created.ID {
		t.Fatalf("owner list = %+v, error = %v", items, err)
	}
	otherItems, err := store.List(context.Background(), "user-b")
	if err != nil || len(otherItems) != 0 {
		t.Fatalf("other list = %+v, error = %v", otherItems, err)
	}
	if _, err := store.Get(context.Background(), "user-b", created.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner get error = %v", err)
	}
	if _, err := store.Update(
		context.Background(), "user-a", created.ID, 99, validDefinition("Wrong version"),
	); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale update error = %v", err)
	}
	updated, err := store.Update(
		context.Background(), "user-a", created.ID, 1, validDefinition("Updated rule"),
	)
	if err != nil || updated.Version != 2 || updated.Name != "Updated rule" || updated.DefinitionHash == created.DefinitionHash {
		t.Fatalf("updated rule = %+v, error = %v", updated, err)
	}
	if err := store.Delete(context.Background(), "user-b", created.ID, 2); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner delete error = %v", err)
	}
	if err := store.Delete(context.Background(), "user-a", created.ID, 1); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("stale delete error = %v", err)
	}
	if err := store.Delete(context.Background(), "user-a", created.ID, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(context.Background(), "user-a", created.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted get error = %v", err)
	}
}

func TestRuleCreateRejectsInvalidDefinitionAndUnknownOwner(t *testing.T) {
	store, accounts := testStore(t)
	_, _ = accounts.EnsureProfile(context.Background(), "user-a", "a@example.com")
	invalid := validDefinition("Invalid")
	invalid.Conditions[0].Left = "UNSUPPORTED"
	if _, err := store.Create(context.Background(), "user-a", invalid); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid definition error = %v", err)
	}
	if _, err := store.Create(context.Background(), "missing", validDefinition("Orphan")); err == nil {
		t.Fatal("unknown owner unexpectedly created a rule")
	}
}

func TestRuleCreateEnforcesPerUserLimit(t *testing.T) {
	store, accounts := testStore(t)
	_, _ = accounts.EnsureProfile(context.Background(), "user-a", "a@example.com")
	for index := 0; index < MaxRulesPerUser; index++ {
		if _, err := store.Create(
			context.Background(), "user-a", validDefinition(fmt.Sprintf("Rule %d", index)),
		); err != nil {
			t.Fatalf("create %d: %v", index, err)
		}
	}
	if _, err := store.Create(
		context.Background(), "user-a", validDefinition("Over limit"),
	); !errors.Is(err, ErrLimit) {
		t.Fatalf("limit error = %v, want ErrLimit", err)
	}
}
