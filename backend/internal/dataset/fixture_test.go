package dataset

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
)

func TestFixtureReadinessDetectsContentCorruption(t *testing.T) {
	store, err := NewFixtureStore(fixturePath(t))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Ready(context.Background()); err != nil {
		t.Fatal(err)
	}
	store.content[0] ^= 0xff
	if err := store.Ready(context.Background()); !errors.Is(err, ErrIntegrity) {
		t.Fatalf("error = %v, want ErrIntegrity", err)
	}
}

func fixturePath(t *testing.T) string {
	t.Helper()
	return filepath.Join("..", "..", "core", "testdata", "default_scalping_v1.json")
}

func TestFixturePrepareAndContent(t *testing.T) {
	store, err := NewFixtureStore(fixturePath(t))
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := store.Prepare(context.Background(), "user-1", PrepareRequest{
		Purpose: "screen", RuleID: "default-scalping-v1", UniverseID: "univ-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if manifest.CandleCount != 40 || manifest.Provider != "fixture" {
		t.Fatalf("manifest = %+v", manifest)
	}
	content, _, err := store.Content(context.Background(), "user-1", manifest.DatasetID)
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

func TestFixtureRejectsInvalidContractRequests(t *testing.T) {
	store, err := NewFixtureStore(fixturePath(t))
	if err != nil {
		t.Fatal(err)
	}
	requests := []PrepareRequest{
		{Purpose: "backtest", RuleID: "rule-1", UniverseID: "univ-1"},
		{Purpose: "screen", UniverseID: "univ-1"},
		{Purpose: "screen", RuleID: "rule-1"},
	}
	for _, request := range requests {
		if _, err := store.Prepare(context.Background(), "user-1", request); !errors.Is(err, ErrInvalidRequest) {
			t.Errorf("request %+v error = %v", request, err)
		}
	}
	if _, _, err := store.Content(context.Background(), "user-1", "unknown"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing content error = %v", err)
	}
}
