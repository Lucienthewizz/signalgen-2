package marketdata

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

func TestRedisCacheInvalidConfigurationRedactsURL(t *testing.T) {
	_, err := NewRedisCache("https://user:secret@example.invalid", "test")
	if err == nil || strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), "example.invalid") {
		t.Fatalf("unsafe configuration error: %v", err)
	}
}

func TestRedisCacheOutageFallsBackWithoutRepeatedDials(t *testing.T) {
	cache, err := NewRedisCache("redis://127.0.0.1:1/0", "outage")
	if err != nil {
		t.Fatal(err)
	}
	defer cache.Close()
	source := providerFunc(func(_ context.Context, items []universe.Instrument, _ int) ([]Series, error) {
		return []Series{validSeries(items[0].Symbol)}, nil
	})
	start := time.Now()
	for i := 0; i < 3; i++ {
		if _, err := sharedProvider(t, source, cache).Daily(context.Background(), cacheInstruments, 20); err != nil {
			t.Fatal(err)
		}
	}
	_, _, failures := cache.Stats()
	if failures != 1 || time.Since(start) > 2*time.Second {
		t.Fatalf("outage retried or stalled: failures=%d elapsed=%s", failures, time.Since(start))
	}
}

// Opt-in integration uses a disposable Redis, never a production cache.
func TestRedisCacheIntegration(t *testing.T) {
	url := os.Getenv("SIGNALGEN_TEST_REDIS_URL")
	if url == "" {
		t.Skip("set SIGNALGEN_TEST_REDIS_URL to a disposable Redis")
	}
	scope := fmt.Sprintf("test-%d", time.Now().UnixNano())
	cache, err := NewRedisCache(url, scope)
	if err != nil {
		t.Fatal(err)
	}
	defer cache.Close()
	ctx := context.Background()
	var calls atomic.Int32
	source := providerFunc(func(_ context.Context, items []universe.Instrument, _ int) ([]Series, error) {
		calls.Add(1)
		return []Series{validSeries(items[0].Symbol)}, nil
	})
	for i := 0; i < 2; i++ {
		if _, err := sharedProvider(t, source, cache).Daily(ctx, cacheInstruments, 20); err != nil {
			t.Fatal(err)
		}
	}
	hits, misses, failures := cache.Stats()
	if calls.Load() != 1 || hits != 1 || misses != 1 || failures != 0 {
		t.Fatalf("not shared through Redis: calls=%d hits=%d misses=%d failures=%d", calls.Load(), hits, misses, failures)
	}
	keys, err := cache.client.Keys(ctx, cache.prefix+"*").Result()
	if err != nil || len(keys) != 1 {
		t.Fatalf("isolated key lookup: %v %v", keys, err)
	}
	defer cache.client.Del(ctx, keys...)
	ttl, err := cache.client.PTTL(ctx, keys[0]).Result()
	if err != nil || ttl <= 0 || ttl > 5*time.Minute {
		t.Fatal("entry missing bounded TTL", ttl, err)
	}
	if err := cache.Set(ctx, "expire", []byte("value"), 20*time.Millisecond); err != nil {
		t.Fatal(err)
	}
	time.Sleep(40 * time.Millisecond)
	if value, err := cache.Get(ctx, "expire"); err != nil || len(value) != 0 {
		t.Fatal("expired Redis data reused", err)
	}
	other, err := NewRedisCache(url, scope+"-other-source")
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	if _, err := sharedProvider(t, source, other).Daily(ctx, cacheInstruments, 20); err != nil || calls.Load() != 2 {
		t.Fatal("different source scope reused Redis data", err)
	}
	otherKeys, _ := other.client.Keys(ctx, other.prefix+"*").Result()
	if len(otherKeys) > 0 {
		defer other.client.Del(ctx, otherKeys...)
	}
}
