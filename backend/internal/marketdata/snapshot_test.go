package marketdata

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type revisionProvider struct {
	mu       sync.Mutex
	revision string
	view     *revisionView
	err      error
	captured chan string
}

func (p *revisionProvider) Snapshot(ctx context.Context) (string, Provider, error) {
	if err := ctx.Err(); err != nil {
		return "", nil, err
	}
	p.mu.Lock()
	revision, view, err := p.revision, p.view, p.err
	p.mu.Unlock()
	if p.captured != nil {
		p.captured <- revision
	}
	return revision, view, err
}
func (p *revisionProvider) set(revision string, view *revisionView, err error) {
	p.mu.Lock()
	p.revision = revision
	p.view = view
	p.err = err
	p.mu.Unlock()
}
func (p *revisionProvider) Daily(context.Context, []universe.Instrument, int) ([]Series, error) {
	return nil, errors.New("unpinned latest read")
}
func (p *revisionProvider) DailyHistory(context.Context, universe.Instrument, time.Time, time.Time) (History, error) {
	return History{}, errors.New("unpinned history read")
}

type revisionView struct {
	price            float64
	calls            atomic.Int32
	started, release chan struct{}
	once             sync.Once
}

func (v *revisionView) one(ctx context.Context, symbol string) (Series, error) {
	v.calls.Add(1)
	if v.started != nil {
		v.once.Do(func() { close(v.started) })
	}
	if v.release != nil {
		select {
		case <-v.release:
		case <-ctx.Done():
			return Series{}, ctx.Err()
		}
	}
	s := validSeries(symbol)
	for i := range s.Candles {
		s.Candles[i].Open = v.price
		s.Candles[i].High = v.price + 2
		s.Candles[i].Low = v.price - 1
		s.Candles[i].Close = v.price + 1
	}
	return s, nil
}
func (v *revisionView) Daily(ctx context.Context, items []universe.Instrument, size int) ([]Series, error) {
	s, err := v.one(ctx, items[0].Symbol)
	return []Series{s}, err
}
func (v *revisionView) Candles(ctx context.Context, items []universe.Instrument, size int, timeframe string) ([]Series, error) {
	return v.Daily(ctx, items, size)
}
func (v *revisionView) DailyHistory(ctx context.Context, item universe.Instrument, from, to time.Time) (History, error) {
	s, err := v.one(ctx, item.Symbol)
	return History{Series: s}, err
}

func TestSnapshotPinsInflightGenerationAndCoalescesAcrossCancellation(t *testing.T) {
	for _, history := range []bool{false, true} {
		t.Run(map[bool]string{false: "latest", true: "history"}[history], func(t *testing.T) {
			a := &revisionView{price: 100, started: make(chan struct{}), release: make(chan struct{})}
			b := &revisionView{price: 200}
			upstream := &revisionProvider{revision: "A", view: a, captured: make(chan string, 10)}
			cache, _ := NewCachedProvider(upstream, DefaultCacheOptions())
			item := universe.Instrument{Symbol: "TEST", ProviderSymbol: "TEST"}
			from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
			to := from.AddDate(0, 1, 0)
			read := func(ctx context.Context) (float64, error) {
				if history {
					h, err := cache.DailyHistory(ctx, item, from, to)
					if err != nil {
						return 0, err
					}
					return h.Series.Candles[0].Close, nil
				}
				s, err := cache.Daily(ctx, []universe.Instrument{item}, 20)
				if err != nil {
					return 0, err
				}
				return s[0].Candles[0].Close, nil
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			canceled := make(chan error, 1)
			go func() { _, err := read(ctx); canceled <- err }()
			<-a.started
			<-upstream.captured
			joined := make(chan float64, 1)
			joinedErr := make(chan error, 1)
			go func() { value, err := read(context.Background()); joined <- value; joinedErr <- err }()
			if revision := <-upstream.captured; revision != "A" {
				t.Fatal("second request did not bind A")
			}
			upstream.set("B", b, nil)
			cancel()
			if err := <-canceled; !errors.Is(err, context.Canceled) {
				t.Fatal("cancellation lost", err)
			}
			value, err := read(context.Background())
			if err != nil || value != 201 {
				t.Fatal("B coalesced with A", value, err)
			}
			close(a.release)
			if value := <-joined; value != 101 {
				t.Fatal("in-flight A became B", value)
			}
			if err := <-joinedErr; err != nil {
				t.Fatal(err)
			}
			if a.calls.Load() != 1 || b.calls.Load() != 1 {
				t.Fatal("generation coalescing lost", a.calls.Load(), b.calls.Load())
			}
			// A's key must contain A data even after B became current during its fetch.
			upstream.set("A", a, nil)
			value, err = read(context.Background())
			if err != nil || value != 101 || a.calls.Load() != 1 {
				t.Fatal("wrong generation stored under A key", value, err)
			}
			upstream.set("B", b, ErrUnavailable)
			if _, err := read(context.Background()); !errors.Is(err, ErrUnavailable) {
				t.Fatal("failed snapshot used hot stale entry", err)
			}
		})
	}
}
func TestSnapshotResolvesOncePerMultiSymbolRequest(t *testing.T) {
	upstream := &revisionProvider{revision: "A", view: &revisionView{price: 100}, captured: make(chan string, 10)}
	cache, _ := NewCachedProvider(upstream, DefaultCacheOptions())
	items := []universe.Instrument{{Symbol: "A", ProviderSymbol: "A"}, {Symbol: "B", ProviderSymbol: "B"}, {Symbol: "C", ProviderSymbol: "C"}}
	result, err := cache.Daily(context.Background(), items, 20)
	if err != nil || len(result) != 3 {
		t.Fatal(err)
	}
	if len(upstream.captured) != 1 {
		t.Fatal("snapshot resolved separately per symbol", len(upstream.captured))
	}
	for i := range result {
		if result[i].Symbol != items[i].Symbol {
			t.Fatal("order changed")
		}
	}
}
func TestSnapshotKeySeparationBudgetsAndInvalidRevisions(t *testing.T) {
	view := &revisionView{price: 100}
	upstream := &revisionProvider{revision: "A", view: view}
	options := DefaultCacheOptions()
	options.MaxEntries = 3
	options.MaxCandles = 60
	cache, _ := NewCachedProvider(upstream, options)
	item := universe.Instrument{Symbol: "TEST", ProviderSymbol: "TEST"}
	ctx := context.Background()
	for _, frame := range []string{"1d", "5m"} {
		if _, err := cache.Candles(ctx, []universe.Instrument{item}, 20, frame); err != nil {
			t.Fatal(err)
		}
	}
	other := item
	other.ProviderSymbol = "OTHER"
	if _, err := cache.Daily(ctx, []universe.Instrument{other}, 20); err != nil {
		t.Fatal(err)
	}
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 1, 0)
	for _, end := range []time.Time{to, to.Add(time.Nanosecond)} {
		if _, err := cache.DailyHistory(ctx, item, from, end); err != nil {
			t.Fatal(err)
		}
	}
	if view.calls.Load() != 5 {
		t.Fatal("keys merged", view.calls.Load())
	}
	for i := 0; i < 10; i++ {
		upstream.set(string(rune('B'+i)), view, nil)
		if _, err := cache.Daily(ctx, []universe.Instrument{item}, 20); err != nil {
			t.Fatal(err)
		}
	}
	cache.mu.Lock()
	entries, candles, flights := len(cache.entries), cache.candles, len(cache.flights)
	cache.mu.Unlock()
	if entries > 3 || candles > 60 || flights != 0 {
		t.Fatal("generation metadata escaped budgets", entries, candles, flights)
	}
	for _, revision := range []string{"", strings.Repeat("x", 129), "bad\x00revision"} {
		upstream.set(revision, view, nil)
		if _, err := cache.Daily(ctx, []universe.Instrument{item}, 20); !errors.Is(err, ErrInvalidData) {
			t.Fatal("invalid revision accepted", revision, err)
		}
	}
}
