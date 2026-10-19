package dataset

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type usUniverse struct {
	fakeUniverseRepository
	items []universe.Instrument
}

func (fake usUniverse) Instruments(context.Context, string, string) ([]universe.Instrument, error) {
	return fake.items, nil
}

func TestUSSnapshotUsesTrustedUSDMetadataAndProtectsExchangeSlice(t *testing.T) {
	repo := usUniverse{items: []universe.Instrument{{Symbol: "AAPL", ProviderSymbol: "AAPL", Exchange: "XNAS", Currency: "USD"}}}
	store, _ := NewDynamicStore(fakeMarketProvider{}, repo)
	manifest, err := store.Prepare(context.Background(), "owner", PrepareRequest{Purpose: "screen", RuleID: "rule", UniverseID: "owned"})
	if err != nil || manifest.Market != "US" || manifest.Currency != "USD" || manifest.Exchanges[0] != "XNAS" {
		t.Fatalf("manifest=%+v error=%v", manifest, err)
	}
	manifest.Exchanges[0] = "CORRUPT"
	content, original, err := store.Content(context.Background(), "owner", manifest.DatasetID)
	var decoded map[string]any
	if err != nil || json.Unmarshal(content, &decoded) != nil || original.Exchanges[0] != "XNAS" || decoded["market"] != "US" || decoded["currency"] != "USD" {
		t.Fatalf("content metadata incorrect: %v", err)
	}
	if _, _, err := store.Content(context.Background(), "other", manifest.DatasetID); !errors.Is(err, ErrNotFound) {
		t.Fatal("cross-owner content accepted")
	}
}

func TestMixedMarketSnapshotIsRejectedBeforeFetch(t *testing.T) {
	repo := usUniverse{items: []universe.Instrument{{Symbol: "AAPL", Exchange: "XNAS", Currency: "USD"}, {Symbol: "BBCA.JK", Exchange: "XIDX", Currency: "IDR"}}}
	store, _ := NewDynamicStore(fakeMarketProvider{}, repo)
	_, err := store.Prepare(context.Background(), "owner", PrepareRequest{Purpose: "screen", RuleID: "rule", UniverseID: "owned"})
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("mixed market accepted: %v", err)
	}
}
