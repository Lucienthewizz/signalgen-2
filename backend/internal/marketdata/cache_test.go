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

type providerFunc func(context.Context, []universe.Instrument, int) ([]Series, error)

func (function providerFunc) Daily(ctx context.Context, instruments []universe.Instrument, size int) ([]Series, error) {
	return function(ctx, instruments, size)
}

func validSeries(symbol string) Series {
	candles := make([]core.Candle, 20)
	for index := range candles {
		candles[index] = core.Candle{Timestamp: time.Date(2026, 1, index+1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339), Open: 100, High: 102, Low: 99, Close: 101, Volume: 1000}
	}
	return Series{Symbol: symbol, Candles: candles, Timezone: "UTC"}
}

var cacheInstruments = []universe.Instrument{{Symbol: "BBCA.JK", ProviderSymbol: "BBCA.JK"}}

func TestCacheCoalescesAndIsolatesReturnedData(t *testing.T) {
	var calls atomic.Int32
	started, release := make(chan struct{}), make(chan struct{})
	upstream := providerFunc(func(context.Context, []universe.Instrument, int) ([]Series, error) {
		calls.Add(1)
		close(started)
		<-release
		return []Series{validSeries("BBCA.JK")}, nil
	})
	provider, _ := NewCachedProvider(upstream, DefaultCacheOptions())
	var group sync.WaitGroup
	for range 20 {
		group.Add(1)
		go func() {
			defer group.Done()
			series, err := provider.Daily(context.Background(), cacheInstruments, 20)
			if err != nil {
				t.Error(err)
				return
			}
			series[0].Candles[0].Close = 999
		}()
	}
	<-started
	close(release)
	group.Wait()
	series, err := provider.Daily(context.Background(), cacheInstruments, 20)
	if err != nil || calls.Load() != 1 || series[0].Candles[0].Close != 101 {
		t.Fatalf("calls=%d, error=%v, series=%v", calls.Load(), err, series)
	}
}

func TestCacheExpiryBudgetAndErrors(t *testing.T) {
	var calls int
	var fail bool
	provider, _ := NewCachedProvider(providerFunc(func(_ context.Context, instruments []universe.Instrument, _ int) ([]Series, error) {
		calls++
		if fail {
			return nil, ErrUnavailable
		}
		return []Series{validSeries(instruments[0].Symbol)}, nil
	}), CacheOptions{TTL: time.Minute, FetchTimeout: time.Second, MaxEntries: 2, MaxCandles: 20, MaxInFlight: 1})
	now := time.Now()
	provider.now = func() time.Time { return now }
	for _, symbol := range []string{"BBCA.JK", "BBRI.JK"} {
		_, err := provider.Daily(context.Background(), []universe.Instrument{{Symbol: symbol, ProviderSymbol: symbol}}, 20)
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(provider.entries) != 1 || provider.candles != 20 {
		t.Fatal("cache candle budget exceeded")
	}
	now = now.Add(time.Minute)
	if _, err := provider.Daily(context.Background(), cacheInstruments, 20); err != nil {
		t.Fatal(err)
	}
	if calls != 3 {
		t.Fatalf("expiry fetch count = %d", calls)
	}
	now = now.Add(time.Minute)
	fail = true
	for range 2 {
		if _, err := provider.Daily(context.Background(), cacheInstruments, 20); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("error = %v", err)
		}
	}
	if calls != 5 {
		t.Fatal("provider failures were cached")
	}
}

func TestCacheCancellationAndFlightLimit(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	provider, _ := NewCachedProvider(providerFunc(func(ctx context.Context, _ []universe.Instrument, _ int) ([]Series, error) {
		close(started)
		select {
		case <-release:
			return []Series{validSeries("BBCA.JK")}, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}), CacheOptions{TTL: time.Minute, FetchTimeout: time.Second, MaxEntries: 1, MaxCandles: 20, MaxInFlight: 1})
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() { _, err := provider.Daily(ctx, cacheInstruments, 20); result <- err }()
	<-started
	cancel()
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel error = %v", err)
	}
	if _, err := provider.Daily(context.Background(), []universe.Instrument{{Symbol: "BBRI.JK", ProviderSymbol: "BBRI.JK"}}, 20); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("flight capacity error = %v", err)
	}
	close(release)
	if _, err := provider.Daily(context.Background(), cacheInstruments, 20); err != nil {
		t.Fatal(err)
	}
}

func TestCacheRejectsUnexpectedProviderSymbol(t *testing.T) {
	provider, _ := NewCachedProvider(providerFunc(func(context.Context, []universe.Instrument, int) ([]Series, error) {
		return []Series{validSeries("UNAUTHORIZED.JK")}, nil
	}), DefaultCacheOptions())
	if _, err := provider.Daily(context.Background(), cacheInstruments, 20); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("error = %v", err)
	}
}
