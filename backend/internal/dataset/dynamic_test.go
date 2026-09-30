package dataset

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type fakeUniverseRepository struct {
	owner string
}

func (fake fakeUniverseRepository) Catalog(context.Context) ([]universe.Instrument, error) {
	return nil, nil
}
func (fake fakeUniverseRepository) List(context.Context, string) ([]universe.Universe, error) {
	return nil, nil
}
func (fake fakeUniverseRepository) Get(context.Context, string, string) (universe.Universe, error) {
	return universe.Universe{}, nil
}
func (fake fakeUniverseRepository) Instruments(_ context.Context, owner, id string) ([]universe.Instrument, error) {
	if owner != fake.owner || id != "univ-a" {
		return nil, universe.ErrNotFound
	}
	return []universe.Instrument{{Symbol: "BBCA.JK", ProviderSymbol: "BBCA.JK"}}, nil
}
func (fake fakeUniverseRepository) Create(context.Context, string, string, []string) (universe.Universe, error) {
	return universe.Universe{}, nil
}
func (fake fakeUniverseRepository) Update(context.Context, string, string, string, []string, int) (universe.Universe, error) {
	return universe.Universe{}, nil
}
func (fake fakeUniverseRepository) Delete(context.Context, string, string, int) error { return nil }

type fakeMarketProvider struct{}

func (fakeMarketProvider) Daily(_ context.Context, instruments []universe.Instrument, _ int) ([]marketdata.Series, error) {
	candles := make([]core.Candle, 20)
	for index := range candles {
		candles[index] = core.Candle{Timestamp: time.Date(2026, 1, index+1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339), Open: 100, High: 102, Low: 99, Close: 101, Volume: 1000}
	}
	return []marketdata.Series{{Symbol: instruments[0].Symbol, Timezone: "UTC", Candles: candles}}, nil
}

func TestDynamicStoreDerivesDatesAndProtectsOwner(t *testing.T) {
	store, err := NewDynamicStore(fakeMarketProvider{}, fakeUniverseRepository{owner: "user-a"})
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := store.Prepare(context.Background(), "user-a", PrepareRequest{
		Purpose: "screen", RuleID: "rule-a", UniverseID: "univ-a",
	})
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Provider != "yahoo_finance" || manifest.AvailableRange.From != "2026-01-01" || manifest.AvailableRange.To != "2026-01-20" {
		t.Fatalf("manifest = %+v", manifest)
	}
	if _, err := store.Manifest(context.Background(), "user-b", manifest.DatasetID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner manifest error = %v", err)
	}
	if content, _, err := store.Content(context.Background(), "user-a", manifest.DatasetID); err != nil || len(content) == 0 {
		t.Fatalf("content bytes = %d, error = %v", len(content), err)
	}
}

func TestDynamicStoreRejectsCrossOwnerUniverse(t *testing.T) {
	store, _ := NewDynamicStore(fakeMarketProvider{}, fakeUniverseRepository{owner: "user-a"})
	_, err := store.Prepare(context.Background(), "user-b", PrepareRequest{
		Purpose: "screen", RuleID: "rule-a", UniverseID: "univ-a",
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("error = %v, want ErrNotFound", err)
	}
}
