package ratelimit

import (
	"testing"
	"time"
)

func TestLimiterIsScopedAndResets(t *testing.T) {
	now := time.Date(2026, 9, 21, 0, 0, 0, 0, time.UTC)
	limiter, err := New(2, time.Minute, WithClock(func() time.Time { return now }))
	if err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		if allowed, _ := limiter.Allow("rules:user-a"); !allowed {
			t.Fatalf("attempt %d unexpectedly denied", attempt)
		}
	}
	allowed, retryAfter := limiter.Allow("rules:user-a")
	if allowed || retryAfter != time.Minute {
		t.Fatalf("limit result = allowed %v retry %s", allowed, retryAfter)
	}
	if allowed, _ := limiter.Allow("rules:user-b"); !allowed {
		t.Fatal("different account shared the same limit")
	}
	if allowed, _ := limiter.Allow("compute:user-a"); !allowed {
		t.Fatal("different operation shared the same limit")
	}
	now = now.Add(time.Minute)
	if allowed, retryAfter := limiter.Allow("rules:user-a"); !allowed || retryAfter != 0 {
		t.Fatalf("window did not reset: allowed %v retry %s", allowed, retryAfter)
	}
}

func TestLimiterRejectsInvalidConfigurationAndEmptyKey(t *testing.T) {
	if _, err := New(0, time.Minute); err == nil {
		t.Fatal("zero maximum unexpectedly accepted")
	}
	limiter, err := New(1, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if allowed, retryAfter := limiter.Allow(" "); allowed || retryAfter != time.Minute {
		t.Fatalf("empty key result = allowed %v retry %s", allowed, retryAfter)
	}
}
