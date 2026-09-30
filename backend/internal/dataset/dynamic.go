package dataset

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

const dynamicOutputSize = 100

type dynamicEntry struct {
	owner    string
	manifest Manifest
	content  []byte
}

// DynamicStore builds immutable, owner-scoped market-data snapshots. Dates
// remain server-derived metadata: the browser chooses a rule and universe,
// never an arbitrary provider symbol or date window.
type DynamicStore struct {
	provider  marketdata.Provider
	universes universe.Repository
	mu        sync.RWMutex
	entries   map[string]dynamicEntry
}

func NewDynamicStore(provider marketdata.Provider, universes universe.Repository) (*DynamicStore, error) {
	if provider == nil || universes == nil {
		return nil, fmt.Errorf("market data provider and universe repository are required")
	}
	return &DynamicStore{provider: provider, universes: universes, entries: make(map[string]dynamicEntry)}, nil
}

func (store *DynamicStore) Prepare(ctx context.Context, owner string, request PrepareRequest) (Manifest, error) {
	owner = strings.TrimSpace(owner)
	if owner == "" || request.Purpose != "screen" || strings.TrimSpace(request.RuleID) == "" || strings.TrimSpace(request.UniverseID) == "" {
		return Manifest{}, ErrInvalidRequest
	}
	instruments, err := store.universes.Instruments(ctx, owner, request.UniverseID)
	if err != nil {
		if err == universe.ErrNotFound {
			return Manifest{}, ErrNotFound
		}
		return Manifest{}, err
	}
	series, err := store.provider.Daily(ctx, instruments, dynamicOutputSize)
	if err != nil {
		return Manifest{}, err
	}
	if len(series) == 0 {
		return Manifest{}, ErrIntegrity
	}

	content, err := json.Marshal(map[string]any{
		"schema_version": "ohlcv-multi-1",
		"purpose":        "screen",
		"market":         "IDX",
		"currency":       "IDR",
		"timeframe":      "1d",
		"timezone":       "UTC",
		"adjustment":     "none",
		"series":         series,
	})
	if err != nil {
		return Manifest{}, fmt.Errorf("encode dataset content: %w", err)
	}
	from, to, candleCount, symbols, err := summarizeSeries(series)
	if err != nil {
		return Manifest{}, err
	}
	id, err := randomDatasetID()
	if err != nil {
		return Manifest{}, err
	}
	hash := sha256.Sum256(content)
	manifest := Manifest{
		DatasetID: id, Version: time.Now().UTC().Format("20060102T150405Z"),
		SchemaVersion: "ohlcv-multi-1", Provider: "yahoo_finance", Purpose: "screen",
		Market: "IDX", Currency: "IDR", Symbols: symbols, Timeframe: "1d", Timezone: "UTC",
		RequestedRange: Range{From: from, To: to}, AvailableRange: Range{From: from, To: to},
		WarmupCandles: 20, Adjustment: "none", CandleCount: candleCount, DecodedBytes: len(content),
		Checksum: "sha256:" + hex.EncodeToString(hash[:]),
		Quality:  Quality{Status: "complete", Warnings: []string{"Yahoo Finance data; unofficial source for academic MVP use"}},
	}
	store.mu.Lock()
	store.entries[id] = dynamicEntry{owner: owner, manifest: manifest, content: content}
	store.mu.Unlock()
	return manifest, nil
}

func (store *DynamicStore) Manifest(_ context.Context, owner, id string) (Manifest, error) {
	store.mu.RLock()
	entry, ok := store.entries[strings.TrimSpace(id)]
	store.mu.RUnlock()
	if !ok || entry.owner != strings.TrimSpace(owner) {
		return Manifest{}, ErrNotFound
	}
	return entry.manifest, nil
}

func (store *DynamicStore) Content(ctx context.Context, owner, id string) ([]byte, Manifest, error) {
	manifest, err := store.Manifest(ctx, owner, id)
	if err != nil {
		return nil, Manifest{}, err
	}
	store.mu.RLock()
	content := append([]byte(nil), store.entries[id].content...)
	store.mu.RUnlock()
	return content, manifest, nil
}

func (store *DynamicStore) Ready(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}

func summarizeSeries(series []marketdata.Series) (string, string, int, []string, error) {
	var earliest, latest time.Time
	count := 0
	symbols := make([]string, 0, len(series))
	for _, item := range series {
		if len(item.Candles) < 20 {
			return "", "", 0, nil, ErrIntegrity
		}
		symbols = append(symbols, item.Symbol)
		for _, candle := range item.Candles {
			stamp, err := time.Parse(time.RFC3339, candle.Timestamp)
			if err != nil {
				return "", "", 0, nil, ErrIntegrity
			}
			if earliest.IsZero() || stamp.Before(earliest) {
				earliest = stamp
			}
			if latest.IsZero() || stamp.After(latest) {
				latest = stamp
			}
			count++
		}
	}
	return earliest.Format("2006-01-02"), latest.Format("2006-01-02"), count, symbols, nil
}

func randomDatasetID() (string, error) {
	raw := make([]byte, 12)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("create dataset id: %w", err)
	}
	return "ds_" + hex.EncodeToString(raw), nil
}
