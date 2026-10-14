package session

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// This opt-in test creates minimal tables only in an explicitly named local
// scratch DB. Never point it at the cloud/project DB. No real account is used.
func TestPostgresMultiSessionPolicy(t *testing.T) {
	dsn := os.Getenv("SIGNALGEN_SESSION_POLICY_TEST_DSN")
	if dsn == "" {
		t.Skip("local scratch Postgres DSN not configured")
	}
	parsed, err := url.Parse(dsn)
	if err != nil || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") || parsed.Path != "/signalgen_session_policy_test" {
		t.Fatal("session policy tests require a named local scratch database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal("scratch Postgres connection configuration failed")
	}
	defer pool.Close()
	_, err = pool.Exec(ctx, `create schema signalgen;
create table signalgen.account_profiles(user_id uuid primary key,status text not null);
create table signalgen.account_device_state(user_id uuid primary key references signalgen.account_profiles(user_id),current_installation_id text not null,last_switched_at timestamptz,updated_at timestamptz not null);
create table signalgen.app_sessions(id text primary key,user_id uuid not null references signalgen.account_profiles(user_id),installation_id text not null,label text not null,token_hash bytea not null unique,created_at timestamptz not null,expires_at timestamptz not null,last_seen_at timestamptz not null,revoked_at timestamptz);
insert into signalgen.account_profiles values
('11111111-1111-4111-8111-111111111111','active'),
('22222222-2222-4222-8222-222222222222','active'),
('33333333-3333-4333-8333-333333333333','active');`)
	if err != nil {
		t.Fatal("scratch schema initialization failed")
	}
	store, _ := NewPostgresRepository(pool, 5, 24*time.Hour)
	owner := "11111111-1111-4111-8111-111111111111"
	other := "22222222-2222-4222-8222-222222222222"
	sessions := make([]Created, 5)
	for i := range sessions {
		sessions[i], err = store.Create(ctx, owner, fmt.Sprintf("browser-%d", i), "Test browser")
		if err != nil {
			t.Fatalf("create session %d failed", i+1)
		}
	}
	if _, err := store.Create(ctx, owner, "sixth-browser", "Rejected"); !errors.Is(err, ErrSessionLimit) {
		t.Fatalf("sixth browser was not denied: %v", err)
	}
	for _, created := range sessions {
		if _, err := store.Verify(ctx, owner, created.Token); err != nil {
			t.Fatal("a rejected sixth browser revoked an existing session")
		}
	}
	rotated, err := store.Create(ctx, owner, "browser-0", "Same-browser relogin")
	if err != nil {
		t.Fatal("same-browser rotation consumed a sixth slot")
	}
	if _, err := store.Verify(ctx, owner, sessions[0].Token); !errors.Is(err, ErrRevoked) {
		t.Fatal("old same-browser token still works")
	}
	if _, err := store.Verify(ctx, other, rotated.Token); !errors.Is(err, ErrInvalid) {
		t.Fatal("cross-owner token accepted")
	}
	for _, created := range sessions[1:] {
		if _, err := store.Verify(ctx, owner, created.Token); err != nil {
			t.Fatal("relogin revoked another browser")
		}
	}
	var created, denied atomic.Int32
	var group sync.WaitGroup
	for i := 0; i < 10; i++ {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			_, err := store.Create(ctx, other, fmt.Sprintf("parallel-%d", i), "Concurrent test")
			if err == nil {
				created.Add(1)
			} else if errors.Is(err, ErrSessionLimit) {
				denied.Add(1)
			} else {
				t.Error("unexpected concurrent session error")
			}
		}(i)
	}
	group.Wait()
	if created.Load() != 5 || denied.Load() != 5 {
		t.Fatalf("concurrent capacity: created=%d denied=%d", created.Load(), denied.Load())
	}
	exclusive, _ := NewPostgresRepository(pool, 1, 24*time.Hour)
	owner3 := "33333333-3333-4333-8333-333333333333"
	if _, err := exclusive.Create(ctx, owner3, "exclusive-a", "Default A"); err != nil {
		t.Fatal("default first session failed")
	}
	if _, err := exclusive.Create(ctx, owner3, "exclusive-b", "Default B"); err != nil {
		t.Fatal("default first switch failed")
	}
	if _, err := exclusive.Create(ctx, owner3, "exclusive-c", "Default C"); !errors.Is(err, ErrDeviceCooldown) {
		t.Fatal("default cooldown not retained")
	}
	t.Log("PASS: five active, sixth denied, same-browser rotation, cross-owner denial, concurrent capacity, default cooldown")
}
