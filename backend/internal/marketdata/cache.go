package marketdata

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

// CacheOptions bounds public market-data storage and concurrent provider work.
// Private rules, identities, dataset handles, and grants never enter this cache.
type CacheOptions struct {
	TTL          time.Duration
	FetchTimeout time.Duration
	MaxEntries   int
	MaxCandles   int
	MaxInFlight  int
}

func DefaultCacheOptions() CacheOptions {
	return CacheOptions{TTL: 5 * time.Minute, FetchTimeout: 15 * time.Second, MaxEntries: 64, MaxCandles: 32000, MaxInFlight: 8}
}

type cachedSeries struct {
	series    Series
	expiresAt time.Time
}

type providerFlight struct {
	done   chan struct{}
	series Series
	err    error
}

// CachedProvider coalesces identical per-instrument fetches across users. Each
// caller still resolves its owner-scoped universe before calling this layer.
type CachedProvider struct {
	upstream Provider
	options  CacheOptions
	mu       sync.Mutex
	entries  map[string]cachedSeries
	flights  map[string]*providerFlight
	candles  int
	now      func() time.Time
}

func NewCachedProvider(upstream Provider, options CacheOptions) (*CachedProvider, error) {
	if upstream == nil || options.TTL <= 0 || options.FetchTimeout <= 0 || options.MaxEntries < 1 || options.MaxCandles < 20 || options.MaxInFlight < 1 {
		return nil, fmt.Errorf("invalid market-data cache configuration")
	}
	return &CachedProvider{upstream: upstream, options: options, entries: make(map[string]cachedSeries), flights: make(map[string]*providerFlight), now: time.Now}, nil
}

func (provider *CachedProvider) Daily(ctx context.Context, instruments []universe.Instrument, outputSize int) ([]Series, error) {
	return provider.Candles(ctx, instruments, outputSize, "1d")
}

func (provider *CachedProvider) Candles(ctx context.Context, instruments []universe.Instrument, outputSize int, timeframe string) ([]Series, error) {
	if timeframe == "" {
		timeframe = "1d"
	}
	if _, err := Policy(timeframe); err != nil {
		return nil, err
	}
	if len(instruments) < 1 || len(instruments) > universe.MaxSymbols || outputSize < 20 || outputSize > 5000 {
		return nil, ErrInvalidData
	}
	seen := make(map[string]bool, len(instruments))
	for _, instrument := range instruments {
		if instrument.Symbol == "" || instrument.ProviderSymbol == "" || seen[instrument.Symbol] {
			return nil, ErrInvalidData
		}
		seen[instrument.Symbol] = true
	}
	// A ten-stock cold cache must not require ten sequential network round trips.
	// Keep at most three concurrent waits per batch; the shared MaxInFlight limit
	// still caps all upstream work across users. Never fan out without a bound.
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	workers := min(3, provider.options.MaxInFlight, len(instruments))
	result := make([]Series, len(instruments))
	var group sync.WaitGroup
	var firstFailure sync.Once
	var batchErr error
	for offset := 0; offset < workers; offset++ {
		group.Add(1)
		go func() {
			defer group.Done()
			for index := offset; index < len(instruments); index += workers {
				series, err := provider.candleOne(ctx, instruments[index], outputSize, timeframe)
				if err != nil {
					firstFailure.Do(func() { batchErr = err; cancel() })
					return
				}
				// Separate indices are safe to write concurrently. Preserve catalog
				// order even when provider responses arrive in a different order.
				result[index] = series
			}
		}()
	}
	group.Wait()
	if batchErr != nil {
		return nil, batchErr
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (provider *CachedProvider) candleOne(ctx context.Context, instrument universe.Instrument, outputSize int, timeframe string) (Series, error) {
	if err := ctx.Err(); err != nil {
		return Series{}, err
	}
	policy, _ := Policy(timeframe)
	key := instrument.Symbol + "\x00" + instrument.ProviderSymbol + "\x00" + instrument.Exchange + "\x00" + instrument.Currency + "\x00" + timeframe + "\x00" + fmt.Sprint(policy.LookbackDays) + "\x00" + strconv.Itoa(outputSize)
	provider.mu.Lock()
	provider.pruneExpiredLocked()
	if entry, ok := provider.entries[key]; ok {
		result := cloneSeries(entry.series)
		provider.mu.Unlock()
		return result, nil
	}
	flight, exists := provider.flights[key]
	if !exists {
		if len(provider.flights) >= provider.options.MaxInFlight {
			provider.mu.Unlock()
			return Series{}, ErrUnavailable
		}
		flight = &providerFlight{done: make(chan struct{})}
		provider.flights[key] = flight
		// A cancelled browser only stops its own wait. Shared provider work has
		// an independent timeout, so it can still serve other waiting users.
		go provider.fetch(key, flight, instrument, outputSize, timeframe)
	}
	provider.mu.Unlock()
	select {
	case <-ctx.Done():
		return Series{}, ctx.Err()
	case <-flight.done:
		return cloneSeries(flight.series), flight.err
	}
}

func (provider *CachedProvider) fetch(key string, flight *providerFlight, instrument universe.Instrument, outputSize int, timeframe string) {
	ctx, cancel := context.WithTimeout(context.Background(), provider.options.FetchTimeout)
	defer cancel()
	instruments := []universe.Instrument{instrument}
	series, err := ReadCandles(ctx, provider.upstream, instruments, outputSize, timeframe)
	if err == nil {
		err = ValidateSeries(series, instruments, outputSize)
	}
	provider.mu.Lock()
	defer provider.mu.Unlock()
	if err == nil {
		flight.series = cloneSeries(series[0])
		provider.pruneExpiredLocked()
		count := len(flight.series.Candles)
		if count <= provider.options.MaxCandles {
			for len(provider.entries) >= provider.options.MaxEntries || provider.candles+count > provider.options.MaxCandles {
				provider.evictOldestLocked()
			}
			policy, _ := Policy(timeframe)
			ttl := min(provider.options.TTL, policy.CacheTTL)
			provider.entries[key] = cachedSeries{series: cloneSeries(flight.series), expiresAt: provider.now().Add(ttl)}
			provider.candles += count
		}
	}
	flight.err = err
	delete(provider.flights, key)
	close(flight.done)
}

func (provider *CachedProvider) pruneExpiredLocked() {
	for key, entry := range provider.entries {
		if !provider.now().Before(entry.expiresAt) {
			provider.candles -= len(entry.series.Candles)
			delete(provider.entries, key)
		}
	}
}

func (provider *CachedProvider) evictOldestLocked() {
	var oldestKey string
	var oldest time.Time
	for key, entry := range provider.entries {
		if oldest.IsZero() || entry.expiresAt.Before(oldest) {
			oldestKey, oldest = key, entry.expiresAt
		}
	}
	provider.candles -= len(provider.entries[oldestKey].series.Candles)
	delete(provider.entries, oldestKey)
}

func cloneSeries(series Series) Series {
	series.Candles = append([]core.Candle(nil), series.Candles...)
	series.QualityWarnings = append([]string(nil), series.QualityWarnings...)
	return series
}
