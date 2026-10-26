package marketdata

import (
	"context"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
	"testing"
	"time"
)

type intervalSource struct{ calls int }

func (p *intervalSource) Daily(ctx context.Context, items []universe.Instrument, size int) ([]Series, error) {
	return p.Candles(ctx, items, size, "1d")
}
func (p *intervalSource) Candles(_ context.Context, items []universe.Instrument, _ int, _ string) ([]Series, error) {
	p.calls++
	return []Series{validSeries(items[0].Symbol)}, nil
}
func TestIntervalCachesDoNotCollideAndRespectShortTTL(t *testing.T) {
	p := &intervalSource{}
	cache, _ := NewCachedProvider(p, DefaultCacheOptions())
	now := time.Now()
	cache.now = func() time.Time { return now }
	for _, tf := range []string{"1m", "5m", "1d", "1m", "5m", "1d"} {
		if _, err := cache.Candles(context.Background(), cacheInstruments, 100, tf); err != nil {
			t.Fatal(err)
		}
	}
	if p.calls != 3 {
		t.Fatalf("cross-timeframe collision or missed reuse: %d", p.calls)
	}
	now = now.Add(31 * time.Second)
	for _, tf := range []string{"1m", "5m", "1d"} {
		if _, err := cache.Candles(context.Background(), cacheInstruments, 100, tf); err != nil {
			t.Fatal(err)
		}
	}
	if p.calls != 4 {
		t.Fatalf("1m TTL not honored: %d", p.calls)
	}
}
