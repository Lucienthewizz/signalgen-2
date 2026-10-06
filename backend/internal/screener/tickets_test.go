package screener

import (
	"bytes"
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
)

func testBinding() Binding {
	return Binding{
		UserID: "user-a", SessionID: "ses-a", ComputeGrantID: "cgr-a",
		RuleID: "default-scalping-v1", DefinitionHash: "sha256:rule",
		EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion,
		FeatureSchema: "screener-features-1",
	}
}

func TestTicketIsBoundAndSingleUse(t *testing.T) {
	now := time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC)
	store, err := NewTicketStore(
		WithTicketClock(func() time.Time { return now }),
		WithTicketRandom(bytes.NewReader(bytes.Repeat([]byte{7}, 64))),
		WithTicketTTL(time.Minute),
	)
	if err != nil {
		t.Fatal(err)
	}
	created, err := store.Create(context.Background(), testBinding())
	if err != nil {
		t.Fatal(err)
	}
	if created.Token == "" || created.ExpiresAt != now.Add(time.Minute) {
		t.Fatalf("created ticket = %+v", created)
	}
	binding, err := store.Consume(context.Background(), created.Token)
	if err != nil {
		t.Fatal(err)
	}
	if binding.UserID != "user-a" || binding.SessionID != "ses-a" || binding.ComputeGrantID != "cgr-a" {
		t.Fatalf("binding = %+v", binding)
	}
	if _, err := store.Consume(context.Background(), created.Token); !errors.Is(err, ErrInvalid) {
		t.Fatalf("replay error = %v, want ErrInvalid", err)
	}
}

func TestExpiredTicketCannotBeConsumed(t *testing.T) {
	now := time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC)
	store, _ := NewTicketStore(
		WithTicketClock(func() time.Time { return now }),
		WithTicketRandom(bytes.NewReader(bytes.Repeat([]byte{8}, 64))),
		WithTicketTTL(time.Minute),
	)
	created, _ := store.Create(context.Background(), testBinding())
	now = now.Add(time.Minute)
	if _, err := store.Consume(context.Background(), created.Token); !errors.Is(err, ErrExpired) {
		t.Fatalf("expired error = %v, want ErrExpired", err)
	}
}

func TestConcurrentTicketConsumptionHasOneWinner(t *testing.T) {
	store, _ := NewTicketStore(WithTicketRandom(bytes.NewReader(bytes.Repeat([]byte{9}, 64))))
	created, _ := store.Create(context.Background(), testBinding())
	var wait sync.WaitGroup
	winners := make(chan struct{}, 2)
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			if _, err := store.Consume(context.Background(), created.Token); err == nil {
				winners <- struct{}{}
			}
		}()
	}
	wait.Wait()
	close(winners)
	if len(winners) != 1 {
		t.Fatalf("successful consumers = %d, want 1", len(winners))
	}
}

func TestTicketRejectsIncompleteBinding(t *testing.T) {
	store, _ := NewTicketStore()
	if _, err := store.Create(context.Background(), Binding{}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("error = %v, want ErrInvalid", err)
	}
}

func TestTicketCapacityDoesNotEvictValidTickets(t *testing.T) {
	now := time.Now()
	store, err := NewTicketStore(WithTicketClock(func() time.Time { return now }), WithTicketCapacity(2, 1))
	if err != nil {
		t.Fatal(err)
	}
	a, err := store.Create(context.Background(), testBinding())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Create(context.Background(), testBinding()); !errors.Is(err, ErrCapacity) {
		t.Fatal("owner limit bypassed")
	}
	binding := testBinding()
	binding.UserID = "user-b"
	if _, err := store.Create(context.Background(), binding); err != nil {
		t.Fatal(err)
	}
	binding.UserID = "user-c"
	if _, err := store.Create(context.Background(), binding); !errors.Is(err, ErrCapacity) {
		t.Fatal("global limit bypassed")
	}
	if _, err := store.Consume(context.Background(), a.Token); err != nil {
		t.Fatal("valid ticket was evicted")
	}
	if _, err := store.Create(context.Background(), binding); err != nil {
		t.Fatal("consumption did not release capacity")
	}
	now = now.Add(time.Minute)
	if _, err := store.Create(context.Background(), testBinding()); err != nil {
		t.Fatal("expiry did not release capacity")
	}
}
