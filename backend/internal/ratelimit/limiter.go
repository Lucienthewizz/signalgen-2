package ratelimit

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

type windowEntry struct {
	count   int
	resetAt time.Time
}

// Limiter is a process-local fixed-window limiter for the single-instance MVP.
// Keys must use server-known account IDs and operation groups, never raw tokens.
type Limiter struct {
	mu          sync.Mutex
	max         int
	window      time.Duration
	now         func() time.Time
	entries     map[string]windowEntry
	lastCleanup time.Time
}

type Option func(*Limiter)

func WithClock(clock func() time.Time) Option {
	return func(limiter *Limiter) { limiter.now = clock }
}

func New(max int, window time.Duration, options ...Option) (*Limiter, error) {
	limiter := &Limiter{max: max, window: window, now: time.Now, entries: make(map[string]windowEntry)}
	for _, option := range options {
		option(limiter)
	}
	if limiter.max <= 0 || limiter.window <= 0 || limiter.now == nil {
		return nil, fmt.Errorf("invalid rate limiter configuration")
	}
	limiter.lastCleanup = limiter.now().UTC()
	return limiter, nil
}

func (limiter *Limiter) Allow(key string) (bool, time.Duration) {
	key = strings.TrimSpace(key)
	if key == "" {
		return false, limiter.window
	}
	now := limiter.now().UTC()
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	if now.Sub(limiter.lastCleanup) >= limiter.window {
		for existingKey, entry := range limiter.entries {
			if !now.Before(entry.resetAt) {
				delete(limiter.entries, existingKey)
			}
		}
		limiter.lastCleanup = now
	}
	entry, exists := limiter.entries[key]
	if !exists || !now.Before(entry.resetAt) {
		limiter.entries[key] = windowEntry{count: 1, resetAt: now.Add(limiter.window)}
		return true, 0
	}
	if entry.count >= limiter.max {
		return false, entry.resetAt.Sub(now)
	}
	entry.count++
	limiter.entries[key] = entry
	return true, 0
}
