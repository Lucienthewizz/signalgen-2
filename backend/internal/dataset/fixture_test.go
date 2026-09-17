package dataset

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
)

func fixturePath(t *testing.T) string {
	t.Helper()
	return filepath.Join("..", "..", "core", "testdata", "default_scalping_v1.json")
}

func TestFixturePrepareAndContent(t *testing.T) {
	store, err := NewFixtureStore(fixturePath(t))
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := store.Prepare(PrepareRequest{
		Purpose: "screen", Market: "IDX", Symbols: []string{"BBCA.JK"}, Timeframe: "1d",
		DateFrom: "2026-01-01", DateTo: "2026-02-09",
	})
	if err != nil {
		t.Fatal(err)
	}
	if manifest.CandleCount != 40 || manifest.Provider != "fixture" {
		t.Fatalf("manifest = %+v", manifest)
	}
	content, _, err := store.Content(manifest.DatasetID)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(content)
	if manifest.Checksum != "sha256:"+hex.EncodeToString(hash[:]) {
		t.Fatalf("checksum = %s", manifest.Checksum)
	}
	var payload struct {
		Candles []json.RawMessage `json:"candles"`
	}
	if err := json.Unmarshal(content, &payload); err != nil || len(payload.Candles) != 40 {
		t.Fatalf("content candles = %d, error = %v", len(payload.Candles), err)
	}
}

func TestFixtureRejectsUnsupportedAndOutOfRangeRequests(t *testing.T) {
	store, err := NewFixtureStore(fixturePath(t))
	if err != nil {
		t.Fatal(err)
	}
	requests := []PrepareRequest{
		{Purpose: "backtest", Market: "IDX", Symbols: []string{"BBCA.JK"}, Timeframe: "1d", DateFrom: "2026-01-01", DateTo: "2026-02-09"},
		{Purpose: "screen", Market: "IDX", Symbols: []string{"TLKM.JK"}, Timeframe: "1d", DateFrom: "2026-01-01", DateTo: "2026-02-09"},
		{Purpose: "screen", Market: "IDX", Symbols: []string{"BBCA.JK"}, Timeframe: "1d", DateFrom: "2025-01-01", DateTo: "2026-02-09"},
	}
	for _, request := range requests {
		if _, err := store.Prepare(request); !errors.Is(err, ErrInvalidRequest) {
			t.Errorf("request %+v error = %v", request, err)
		}
	}
	if _, _, err := store.Content("unknown"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing content error = %v", err)
	}
}
