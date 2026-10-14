package dataset

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/collection"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
)

type describedMarketProvider struct{ fakeMarketProvider }

func (describedMarketProvider) Source() marketdata.Source {
	return marketdata.Source{Provider: "yahoo_finance", Warnings: []string{"Fixed archive; NOT real-time"}}
}

func TestDynamicStoreRetainsArchiveWarningThroughCache(t *testing.T) {
	cache, err := marketdata.NewCachedProvider(describedMarketProvider{}, marketdata.DefaultCacheOptions())
	if err != nil {
		t.Fatal(err)
	}
	store, _ := NewDynamicStore(cache, fakeUniverseRepository{owner: "user-a"})
	manifest, err := store.Prepare(context.Background(), "user-a", PrepareRequest{Purpose: "screen", RuleID: "rule-a", UniverseID: "univ-a"})
	if err != nil || manifest.Provider != "yahoo_finance" || len(manifest.Quality.Warnings) != 2 || !strings.Contains(manifest.Quality.Warnings[1], "NOT real-time") {
		t.Fatalf("manifest=%+v error=%v", manifest, err)
	}
	manifest.Quality.Warnings[1] = "mutated"
	again, _ := store.Manifest(context.Background(), "user-a", manifest.DatasetID)
	if strings.Contains(again.Quality.Warnings[1], "mutated") {
		t.Fatal("caller mutated stored provenance")
	}
}

func TestArchiveDatasetResearchFiles(t *testing.T) {
	directory := os.Getenv("SIGNALGEN_IDX_HISTORY_TEST_DIR")
	if directory == "" {
		t.Skip("set SIGNALGEN_IDX_HISTORY_TEST_DIR for archive-to-private-dataset smoke check")
	}
	provider, err := collection.NewArchiveProvider(directory)
	if err != nil {
		t.Fatal(err)
	}
	cache, _ := marketdata.NewCachedProvider(provider, marketdata.DefaultCacheOptions())
	store, _ := NewDynamicStore(cache, fakeUniverseRepository{owner: "user-a"})
	request := PrepareRequest{Purpose: "screen", RuleID: "rule-a", UniverseID: "univ-a"}
	if _, err := store.Prepare(context.Background(), "user-b", request); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner universe error=%v", err)
	}
	manifest, err := store.Prepare(context.Background(), "user-a", request)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.CandleCount != 100 || len(manifest.Quality.Warnings) != 3 || !strings.Contains(manifest.Quality.Warnings[1], "NOT real-time") {
		t.Fatalf("manifest=%+v", manifest)
	}
	if _, _, err := store.Content(context.Background(), "user-b", manifest.DatasetID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner content error=%v", err)
	}
	content, returned, err := store.Content(context.Background(), "user-a", manifest.DatasetID)
	if err != nil || len(content) == 0 || returned.Checksum != manifest.Checksum {
		t.Fatalf("content length=%d error=%v", len(content), err)
	}
	t.Logf("private BBCA dataset: %d candles; available %s .. %s; owner isolation passed", manifest.CandleCount, manifest.AvailableRange.From, manifest.AvailableRange.To)
}
