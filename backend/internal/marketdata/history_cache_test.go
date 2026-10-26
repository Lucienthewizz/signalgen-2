package marketdata

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type rangeProvider struct {
	Provider
	calls   atomic.Int32
	release chan struct{}
}

func (p *rangeProvider) DailyHistory(ctx context.Context, i universe.Instrument, from, to time.Time) (History, error) {
	p.calls.Add(1)
	select {
	case <-p.release:
	case <-ctx.Done():
		return History{}, ctx.Err()
	}
	return History{SkippedNullRows: 2, Series: Series{Symbol: i.Symbol, Timezone: "UTC", Candles: []core.Candle{{Timestamp: from.Format(time.RFC3339), Open: 100, High: 102, Low: 99, Close: 101, Volume: 1}}, QualityWarnings: []string{"2 missing rows"}}}, nil
}
func TestRangeCacheCoalescesSeparatesWindowsAndClones(t *testing.T) {
	upstream := &rangeProvider{release: make(chan struct{})}
	cache, _ := NewCachedProvider(upstream, DefaultCacheOptions())
	instrument := universe.Instrument{Symbol: "TEST", ProviderSymbol: "TEST"}
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 1, 0)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			if _, err := cache.DailyHistory(context.Background(), instrument, from, to); err != nil {
				t.Error(err)
			}
		}()
	}
	close(start)
	close(upstream.release)
	wg.Wait()
	if upstream.calls.Load() != 1 {
		t.Fatalf("calls=%d", upstream.calls.Load())
	}
	first, err := cache.DailyHistory(context.Background(), instrument, from, to)
	if err != nil || first.SkippedNullRows != 2 {
		t.Fatal("lost quality evidence")
	}
	first.Series.Candles[0].Close = 500
	second, _ := cache.DailyHistory(context.Background(), instrument, from, to)
	if second.Series.Candles[0].Close != 101 {
		t.Fatal("cache alias")
	}
	if _, err := cache.DailyHistory(context.Background(), instrument, from, to.AddDate(0, 0, 1)); err != nil || upstream.calls.Load() != 2 {
		t.Fatal("window key missing")
	}
}
func TestRangeCacheCancellationAndUnavailableProvider(t *testing.T) {
	cache, _ := NewCachedProvider(&rangeProvider{release: make(chan struct{})}, DefaultCacheOptions())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := cache.DailyHistory(ctx, universe.Instrument{Symbol: "T", ProviderSymbol: "T"}, time.Now().Add(-time.Hour), time.Now()); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel %v", err)
	}
	cache, _ = NewCachedProvider(noHistoryProvider{}, DefaultCacheOptions())
	if _, err := cache.DailyHistory(context.Background(), universe.Instrument{}, time.Now(), time.Now()); !errors.Is(err, ErrHistoryUnavailable) {
		t.Fatalf("fallback %v", err)
	}
}

type noHistoryProvider struct{}

func (noHistoryProvider) Daily(context.Context, []universe.Instrument, int) ([]Series, error) {
	return nil, ErrUnavailable
}
