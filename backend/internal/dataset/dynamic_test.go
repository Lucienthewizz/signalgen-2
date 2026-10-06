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

func TestDynamicSnapshotsExpireAndPreserveActiveHandles(t *testing.T) {
	store, _ := NewDynamicStoreWithLimits(fakeMarketProvider{}, fakeUniverseRepository{owner: "user-a"}, SnapshotLimits{TTL: time.Minute, MaxEntries: 2, MaxPerOwner: 1, MaxBytes: 1 << 20})
	now := time.Now().UTC()
	store.now = func() time.Time { return now }
	input := PrepareRequest{Purpose: "screen", RuleID: "rule-a", UniverseID: "univ-a"}
	manifest, err := store.Prepare(context.Background(), "user-a", input)
	if err != nil || manifest.ExpiresAt == "" {
		t.Fatalf("manifest=%+v error=%v", manifest, err)
	}
	manifest.Symbols[0] = "CORRUPT.JK"
	manifest.Quality.Warnings[0] = "corrupt"
	if _, err := store.Prepare(context.Background(), "user-a", input); !errors.Is(err, ErrCapacity) {
		t.Fatalf("capacity error=%v", err)
	}
	content, original, err := store.Content(context.Background(), "user-a", "  "+manifest.DatasetID+"  ")
	if err != nil || original.Symbols[0] != "BBCA.JK" || original.Quality.Warnings[0] == "corrupt" {
		t.Fatalf("content error=%v, original=%+v", err, original)
	}
	content[0] = '!'
	untouched, _, _ := store.Content(context.Background(), "user-a", manifest.DatasetID)
	if untouched[0] == '!' {
		t.Fatal("caller mutated stored content")
	}
	now = now.Add(time.Minute)
	if _, err := store.Manifest(context.Background(), "user-a", manifest.DatasetID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expiry error=%v", err)
	}
	if store.bytes != 0 {
		t.Fatal("expired bytes were not reclaimed")
	}
	if _, err := store.Prepare(context.Background(), "user-a", input); err != nil {
		t.Fatal(err)
	}
}

func TestDynamicSnapshotsEnforceByteLimit(t *testing.T) {
	store, _ := NewDynamicStoreWithLimits(fakeMarketProvider{}, fakeUniverseRepository{owner: "user-a"}, SnapshotLimits{TTL: time.Minute, MaxEntries: 2, MaxPerOwner: 2, MaxBytes: 1})
	_, err := store.Prepare(context.Background(), "user-a", PrepareRequest{Purpose: "screen", RuleID: "rule-a", UniverseID: "univ-a"})
	if !errors.Is(err, ErrCapacity) || store.bytes != 0 || len(store.entries) != 0 {
		t.Fatalf("error=%v bytes=%d", err, store.bytes)
	}
}
