package dataset

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type backtestProvider struct {
	fakeMarketProvider
	calls  atomic.Int32
	cancel context.CancelFunc
}

func (p *backtestProvider) DailyHistory(ctx context.Context, instrument universe.Instrument, from, to time.Time) (marketdata.History, error) {
	p.calls.Add(1)
	candles := []core.Candle{}
	for stamp := from; stamp.Before(to); stamp = stamp.AddDate(0, 0, 1) {
		candles = append(candles, core.Candle{Timestamp: stamp.Format(time.RFC3339), Open: 100, High: 102, Low: 99, Close: 101, Volume: 1})
	}
	if p.cancel != nil {
		p.cancel()
	}
	return marketdata.History{Series: marketdata.Series{Symbol: instrument.Symbol, Timezone: "UTC", Candles: candles, QualityWarnings: []string{"test gap warning"}}}, nil
}
func backtestPrepare() PrepareRequest {
	return PrepareRequest{Purpose: "backtest", Mode: "manual", Timeframe: "1d", From: "2026-01-20", To: "2026-01-25", NSteps: 3, UniverseID: "univ-a"}
}

func TestBacktestSnapshotRangeIsolationReuseAndCloning(t *testing.T) {
	provider := &backtestProvider{}
	store, _ := NewDynamicStore(provider, fakeUniverseRepository{owner: "user-a"})
	input := backtestPrepare()
	manifest, err := store.Prepare(context.Background(), "user-a", input)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Purpose != "backtest" || manifest.CandleCount <= 100 || manifest.RequestedRange.From != input.From || manifest.Backtest == nil || !strings.Contains(strings.Join(manifest.Quality.Warnings, " "), "gap warning") {
		t.Fatalf("manifest=%+v", manifest)
	}
	reused, err := store.Prepare(context.Background(), "user-a", input)
	if err != nil || reused.DatasetID != manifest.DatasetID {
		t.Fatalf("reuse=%+v %v", reused, err)
	}
	manifest.Backtest.Mode = "corrupted"
	again, _ := store.Manifest(context.Background(), "user-a", manifest.DatasetID)
	if again.Backtest.Mode != "manual" {
		t.Fatal("manifest pointer alias")
	}
	if _, err := store.Manifest(context.Background(), "user-b", manifest.DatasetID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign read %v", err)
	}
	before := provider.calls.Load()
	if _, err := store.Prepare(context.Background(), "user-b", input); !errors.Is(err, ErrNotFound) || provider.calls.Load() != before {
		t.Fatal("foreign universe fetched data")
	}
	input.From = "2026-01-21"
	changed, err := store.Prepare(context.Background(), "user-a", input)
	if err != nil || changed.Checksum == again.Checksum {
		t.Fatal("different range reused snapshot")
	}
}

func TestBacktestPreparationRejectsBeforeProviderAndCancels(t *testing.T) {
	for _, change := range []func(*PrepareRequest){func(r *PrepareRequest) { r.Timeframe = "5m" }, func(r *PrepareRequest) { r.Mode = "rule" }, func(r *PrepareRequest) { r.NSteps = 101 }, func(r *PrepareRequest) { r.To = "2020-01-01" }, func(r *PrepareRequest) { r.RuleID = "unwanted" }} {
		provider := &backtestProvider{}
		store, _ := NewDynamicStore(provider, fakeUniverseRepository{owner: "user-a"})
		input := backtestPrepare()
		change(&input)
		if _, err := store.Prepare(context.Background(), "user-a", input); err == nil || provider.calls.Load() != 0 {
			t.Fatalf("invalid input fetched: %+v", input)
		}
	}
	store, _ := NewDynamicStore(fakeMarketProvider{}, fakeUniverseRepository{owner: "user-a"})
	if _, err := store.Prepare(context.Background(), "user-a", backtestPrepare()); !errors.Is(err, marketdata.ErrHistoryUnavailable) {
		t.Fatalf("provider fallback: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	provider := &backtestProvider{cancel: cancel}
	store, _ = NewDynamicStore(provider, fakeUniverseRepository{owner: "user-a"})
	if _, err := store.Prepare(ctx, "user-a", backtestPrepare()); !errors.Is(err, context.Canceled) || len(store.entries) != 0 {
		t.Fatalf("cancel published: %v", err)
	}
}

func TestBacktestSnapshotsRespectCapacityAndExpiry(t *testing.T) {
	store, _ := NewDynamicStoreWithLimits(&backtestProvider{}, fakeUniverseRepository{owner: "user-a"}, SnapshotLimits{TTL: time.Minute, MaxEntries: 1, MaxPerOwner: 1, MaxBytes: 1 << 20})
	now := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	store.now = func() time.Time { return now }
	input := backtestPrepare()
	first, err := store.Prepare(context.Background(), "user-a", input)
	if err != nil {
		t.Fatal(err)
	}
	input.NSteps++
	if _, err := store.Prepare(context.Background(), "user-a", input); !errors.Is(err, ErrCapacity) {
		t.Fatalf("capacity %v", err)
	}
	now = now.Add(time.Minute)
	if _, err := store.Manifest(context.Background(), "user-a", first.DatasetID); !errors.Is(err, ErrNotFound) {
		t.Fatal("expired snapshot survived")
	}
	if _, err := store.Prepare(context.Background(), "user-a", input); err != nil {
		t.Fatal(err)
	}
}
