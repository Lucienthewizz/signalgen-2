package screener

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"
)

const defaultTicketTTL = 30 * time.Second

var (
	ErrInvalid = errors.New("socket ticket is invalid")
	ErrExpired = errors.New("socket ticket is expired")
)

type Binding struct {
	UserID         string
	SessionID      string
	ComputeGrantID string
	RuleID         string
	DefinitionHash string
	EngineVersion  string
	SchemaVersion  string
	FeatureSchema  string
	ExpiresAt      time.Time
}

type CreatedTicket struct {
	Token     string    `json:"ticket"`
	ExpiresAt time.Time `json:"expires_at"`
}

type TicketStore struct {
	mu      sync.Mutex
	entries map[[32]byte]Binding
	now     func() time.Time
	random  io.Reader
	ttl     time.Duration
}

type TicketOption func(*TicketStore)

func WithTicketClock(clock func() time.Time) TicketOption {
	return func(store *TicketStore) { store.now = clock }
}

func WithTicketRandom(reader io.Reader) TicketOption {
	return func(store *TicketStore) { store.random = reader }
}

func WithTicketTTL(ttl time.Duration) TicketOption {
	return func(store *TicketStore) { store.ttl = ttl }
}

func NewTicketStore(options ...TicketOption) (*TicketStore, error) {
	store := &TicketStore{
		entries: make(map[[32]byte]Binding),
		now:     time.Now,
		random:  rand.Reader,
		ttl:     defaultTicketTTL,
	}
	for _, option := range options {
		option(store)
	}
	if store.now == nil || store.random == nil || store.ttl <= 0 {
		return nil, fmt.Errorf("invalid socket ticket store configuration")
	}
	return store, nil
}

func (store *TicketStore) Create(_ context.Context, binding Binding) (CreatedTicket, error) {
	if !validBinding(binding) {
		return CreatedTicket{}, ErrInvalid
	}
	raw := make([]byte, 32)
	if _, err := io.ReadFull(store.random, raw); err != nil {
		return CreatedTicket{}, fmt.Errorf("generate socket ticket: %w", err)
	}
	token := "sgt_" + base64.RawURLEncoding.EncodeToString(raw)
	hash := sha256.Sum256([]byte(token))
	now := store.now().UTC()
	binding.ExpiresAt = now.Add(store.ttl)

	store.mu.Lock()
	defer store.mu.Unlock()
	store.deleteExpiredLocked(now)
	store.entries[hash] = binding
	return CreatedTicket{Token: token, ExpiresAt: binding.ExpiresAt}, nil
}

// Consume atomically removes a ticket before returning its binding. Any retry,
// including concurrent retries, therefore fails closed.
func (store *TicketStore) Consume(_ context.Context, token string) (Binding, error) {
	hash := sha256.Sum256([]byte(strings.TrimSpace(token)))
	now := store.now().UTC()
	store.mu.Lock()
	defer store.mu.Unlock()
	binding, ok := store.entries[hash]
	if ok {
		delete(store.entries, hash)
	}
	store.deleteExpiredLocked(now)
	if !ok {
		return Binding{}, ErrInvalid
	}
	if !now.Before(binding.ExpiresAt) {
		return Binding{}, ErrExpired
	}
	return binding, nil
}

func (store *TicketStore) deleteExpiredLocked(now time.Time) {
	for hash, binding := range store.entries {
		if !now.Before(binding.ExpiresAt) {
			delete(store.entries, hash)
		}
	}
}

func validBinding(binding Binding) bool {
	return strings.TrimSpace(binding.UserID) != "" &&
		strings.TrimSpace(binding.SessionID) != "" &&
		strings.TrimSpace(binding.ComputeGrantID) != "" &&
		strings.TrimSpace(binding.RuleID) != "" &&
		strings.HasPrefix(binding.DefinitionHash, "sha256:") &&
		strings.TrimSpace(binding.EngineVersion) != "" &&
		strings.TrimSpace(binding.SchemaVersion) != "" &&
		strings.TrimSpace(binding.FeatureSchema) != ""
}
