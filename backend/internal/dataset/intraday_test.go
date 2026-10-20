package dataset

import (
	"context"
	"errors"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
	"testing"
	"time"
)

type intervalMarket struct {
	fakeMarketProvider
	got string
}

func (p *intervalMarket) Candles(ctx context.Context, items []universe.Instrument, size int, tf string) ([]marketdata.Series, error) {
	p.got = tf
	series, err := p.fakeMarketProvider.Daily(ctx, items, size)
	for i := range series {
		series[i].RequestedFrom = "2025-12-29T00:00:00Z"
		series[i].RequestedTo = "2026-01-21T00:00:00Z"
	}
	return series, err
}
func TestIntradaySnapshotMetadataTTLReuseAndDailyArchiveRejection(t *testing.T) {
	p := &intervalMarket{}
	store, _ := NewDynamicStore(p, fakeUniverseRepository{owner: "user-a"})
	now := time.Now().UTC().Truncate(time.Second)
	store.now = func() time.Time { return now }
	input := PrepareRequest{Purpose: "screen", RuleID: "rule-a", UniverseID: "univ-a", Timeframe: "5m"}
	manifest, err := store.Prepare(context.Background(), "user-a", input)
	if err != nil || p.got != "5m" || manifest.Timeframe != "5m" || manifest.ExpiresAt != now.Add(5*time.Minute).Format(time.RFC3339) || manifest.AvailableTimestampRange == nil || manifest.RequestedTimestampRange == nil {
		t.Fatalf("manifest=%+v err=%v", manifest, err)
	}
	manifest.AvailableTimestampRange.From = "CORRUPT"
	again, err := store.Prepare(context.Background(), "user-a", input)
	if err != nil || again.DatasetID != manifest.DatasetID || again.AvailableTimestampRange.From == "CORRUPT" {
		t.Fatalf("reuse or immutability failed: %v", err)
	}
	if _, err = store.Manifest(context.Background(), "user-b", manifest.DatasetID); !errors.Is(err, ErrNotFound) {
		t.Fatal("cross-owner intraday snapshot access")
	}
	now = now.Add(6 * time.Minute)
	if _, err = store.Manifest(context.Background(), "user-a", manifest.DatasetID); !errors.Is(err, ErrNotFound) {
		t.Fatal("expired intraday snapshot accepted")
	}
	archive, _ := NewDynamicStore(fakeMarketProvider{}, fakeUniverseRepository{owner: "user-a"})
	if _, err = archive.Prepare(context.Background(), "user-a", input); !errors.Is(err, marketdata.ErrIntervalUnavailable) {
		t.Fatalf("daily-only source accepted intraday: %v", err)
	}
}
