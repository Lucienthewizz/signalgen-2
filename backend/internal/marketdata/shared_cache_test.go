package marketdata

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type memoryShared struct {
	mu     sync.Mutex
	values map[string][]byte
	err    error
}

func (store *memoryShared) Get(_ context.Context, key string) ([]byte, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	return append([]byte(nil), store.values[key]...), store.err
}
func (store *memoryShared) Set(_ context.Context, key string, value []byte, _ time.Duration) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.err != nil {
		return store.err
	}
	if store.values == nil {
		store.values = make(map[string][]byte)
	}
	store.values[key] = append([]byte(nil), value...)
	return nil
}

func sharedProvider(t *testing.T, source Provider, store SharedCache) *CachedProvider {
	t.Helper()
	options := DefaultCacheOptions()
	options.Shared = store
	provider, err := NewCachedProvider(source, options)
	if err != nil {
		t.Fatal(err)
	}
	return provider
}

func TestSharedCacheReusesAcrossInstancesAndRetainsQuality(t *testing.T) {
	store := &memoryShared{}
	var calls atomic.Int32
	source := providerFunc(func(_ context.Context, items []universe.Instrument, _ int) ([]Series, error) {
		calls.Add(1)
		series := validSeries(items[0].Symbol)
		series.RequestedFrom, series.RequestedTo = "2026-01-01", "2026-02-01"
		series.QualityWarnings = []string{"missing provider rows"}
		return []Series{series}, nil
	})
	first := sharedProvider(t, source, store)
	if _, err := first.Daily(context.Background(), cacheInstruments, 20); err != nil {
		t.Fatal(err)
	}
	second := sharedProvider(t, source, store)
	series, err := second.Daily(context.Background(), cacheInstruments, 20)
	if err != nil || calls.Load() != 1 || series[0].RequestedFrom != "2026-01-01" || series[0].RequestedTo != "2026-02-01" || len(series[0].QualityWarnings) != 1 {
		t.Fatalf("cache failed to retain metadata: calls=%d err=%v series=%v", calls.Load(), err, series)
	}
	series[0].Candles[0].Close = 999
	series[0].QualityWarnings[0] = "mutated"
	third := sharedProvider(t, source, store)
	series, err = third.Daily(context.Background(), cacheInstruments, 20)
	if err != nil || series[0].Candles[0].Close != 101 || series[0].QualityWarnings[0] != "missing provider rows" {
		t.Fatal("shared data aliases caller")
	}
	for key, entry := range second.entries {
		if !entry.expiresAt.Equal(first.entries[key].expiresAt) {
			t.Fatal("shared hit extended freshness")
		}
	}
}

func TestSharedCacheRejectsInvalidExpiredOrUnavailableData(t *testing.T) {
	for _, kind := range []string{"malformed", "wrong-symbol", "expired", "future", "negative-quality", "version", "unavailable", "oversized"} {
		t.Run(kind, func(t *testing.T) {
			store := &memoryShared{}
			var calls atomic.Int32
			source := providerFunc(func(_ context.Context, items []universe.Instrument, _ int) ([]Series, error) {
				calls.Add(1)
				return []Series{validSeries(items[0].Symbol)}, nil
			})
			if _, err := sharedProvider(t, source, store).Daily(context.Background(), cacheInstruments, 20); err != nil {
				t.Fatal(err)
			}
			for key, value := range store.values {
				var payload sharedPayload
				if err := json.Unmarshal(value, &payload); err != nil {
					t.Fatal(err)
				}
				switch kind {
				case "wrong-symbol":
					payload.Series.Symbol = "OTHER"
				case "expired":
					payload.ExpiresAt = time.Now().Add(-time.Second)
				case "future":
					payload.ExpiresAt = time.Now().Add(time.Hour)
				case "negative-quality":
					payload.SkippedNullRows = -1
				case "version":
					payload.Version = 99
				case "unavailable":
					store.err = errors.New("cache unavailable")
				}
				value, _ = json.Marshal(payload)
				if kind == "malformed" {
					value = []byte("{")
				}
				if kind == "oversized" {
					value = make([]byte, maxSharedPayload+1)
				}
				store.values[key] = value
			}
			if _, err := sharedProvider(t, source, store).Daily(context.Background(), cacheInstruments, 20); err != nil || calls.Load() != 2 {
				t.Fatalf("invalid shared value must fetch provider, calls=%d err=%v", calls.Load(), err)
			}
		})
	}
}

func TestSharedCacheSeparatesIntervalsSizesAndRevisions(t *testing.T) {
	store := &memoryShared{}
	source := &revisionProvider{}
	a := &revisionView{price: 100}
	source.set("A", a, nil)
	for _, request := range []struct {
		timeframe string
		size      int
	}{{"1m", 20}, {"5m", 20}, {"1d", 20}, {"1d", 100}, {"1m", 20}} {
		if _, err := sharedProvider(t, source, store).Candles(context.Background(), cacheInstruments, request.size, request.timeframe); err != nil {
			t.Fatal(err)
		}
	}
	if a.calls.Load() != 4 {
		t.Fatalf("cache context collision: %d", a.calls.Load())
	}
	b := &revisionView{price: 200}
	source.set("B", b, nil)
	series, err := sharedProvider(t, source, store).Daily(context.Background(), cacheInstruments, 20)
	if err != nil || b.calls.Load() != 1 || series[0].Candles[0].Close != 201 {
		t.Fatal("publication revision reused old Redis data", err)
	}
	source.set("bad", b, ErrInvalidData)
	if _, err := sharedProvider(t, source, store).Daily(context.Background(), cacheInstruments, 20); !errors.Is(err, ErrInvalidData) {
		t.Fatal("invalid publication hidden by shared cache", err)
	}
}

func TestSharedHistorySeparatesWindowsAndRetainsQuality(t *testing.T) {
	store := &memoryShared{}
	release := make(chan struct{})
	close(release)
	source := &rangeProvider{release: release}
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 1, 0)
	item := universe.Instrument{Symbol: "TEST", ProviderSymbol: "TEST"}
	for i := 0; i < 2; i++ {
		result, err := sharedProvider(t, source, store).DailyHistory(context.Background(), item, from, to)
		if err != nil || result.SkippedNullRows != 2 || len(result.Series.QualityWarnings) != 1 {
			t.Fatal("history evidence lost", err)
		}
	}
	if source.calls.Load() != 1 {
		t.Fatal("history not shared")
	}
	if _, err := sharedProvider(t, source, store).DailyHistory(context.Background(), item, from, to.AddDate(0, 0, 1)); err != nil || source.calls.Load() != 2 {
		t.Fatal("history window collision", err)
	}
}

func TestSharedCacheNeverStoresProviderFailures(t *testing.T) {
	store := &memoryShared{}
	source := providerFunc(func(context.Context, []universe.Instrument, int) ([]Series, error) { return nil, ErrUnavailable })
	if _, err := sharedProvider(t, source, store).Daily(context.Background(), cacheInstruments, 20); !errors.Is(err, ErrUnavailable) {
		t.Fatal(err)
	}
	if len(store.values) != 0 {
		t.Fatal("provider failure stored as data")
	}
}
