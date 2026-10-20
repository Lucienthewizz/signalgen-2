package marketdata

import (
	"context"
	"errors"
	"fmt"
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

func TestCacheBatchFetchesAreBoundedAndKeepInstrumentOrder(t *testing.T) {
	var active, peak, calls atomic.Int32
	upstream := providerFunc(func(ctx context.Context, instruments []universe.Instrument, _ int) ([]Series, error) {
		calls.Add(1)
		current := active.Add(1)
		defer active.Add(-1)
		for old := peak.Load(); current > old && !peak.CompareAndSwap(old, current); old = peak.Load() {
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(10 * time.Millisecond):
			return []Series{validSeries(instruments[0].Symbol)}, nil
		}
	})
	provider, _ := NewCachedProvider(upstream, DefaultCacheOptions())
	instruments := make([]universe.Instrument, 10)
	for i := range instruments {
		symbol := fmt.Sprintf("TEST%d", i)
		instruments[i] = universe.Instrument{Symbol: symbol, ProviderSymbol: symbol}
	}
	for run := 0; run < 2; run++ {
		series, err := provider.Daily(context.Background(), instruments, 20)
		if err != nil || len(series) != 10 {
			t.Fatalf("run=%d len=%d error=%v", run, len(series), err)
		}
		for i := range series {
			if series[i].Symbol != instruments[i].Symbol {
				t.Fatal("parallel fetch changed instrument order")
			}
		}
	}
	if calls.Load() != 10 || peak.Load() < 2 || peak.Load() > 3 {
		t.Fatalf("upstream calls=%d peak=%d; want 10 fetches and 2..3 concurrently", calls.Load(), peak.Load())
	}
}

func TestCacheBatchErrorAndCancellationNeverReturnPartialSuccess(t *testing.T) {
	for _, fail := range []bool{false, true} {
		provider, _ := NewCachedProvider(providerFunc(func(ctx context.Context, instruments []universe.Instrument, _ int) ([]Series, error) {
			if fail && instruments[0].Symbol == "BAD" {
				return nil, ErrUnavailable
			}
			<-ctx.Done()
			return nil, ctx.Err()
		}), CacheOptions{TTL: time.Minute, FetchTimeout: 30 * time.Millisecond, MaxEntries: 4, MaxCandles: 100, MaxInFlight: 3})
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Millisecond)
		series, err := provider.Daily(ctx, []universe.Instrument{{Symbol: "OK", ProviderSymbol: "OK"}, {Symbol: "BAD", ProviderSymbol: "BAD"}}, 20)
		cancel()
		if err == nil || series != nil {
			t.Fatalf("partial batch accepted: len=%d error=%v", len(series), err)
		}
	}
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
		series := validSeries("BBCA.JK")
		series.QualityWarnings = []string{"original quality warning"}
		return []Series{series}, nil
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
			series[0].QualityWarnings[0] = "mutated warning"
		}()
	}
	<-started
	close(release)
	group.Wait()
	series, err := provider.Daily(context.Background(), cacheInstruments, 20)
	if err != nil || calls.Load() != 1 || series[0].Candles[0].Close != 101 || series[0].QualityWarnings[0] != "original quality warning" {
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
