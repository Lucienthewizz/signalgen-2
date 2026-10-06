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
	owner     string
	manifest  Manifest
	content   []byte
	expiresAt time.Time
}

// SnapshotLimits bound private datasets without evicting active handles. Full
// storage returns a retryable service error; expired handles can be prepared again.
type SnapshotLimits struct {
	TTL         time.Duration
	MaxEntries  int
	MaxPerOwner int
	MaxBytes    int
}

func DefaultSnapshotLimits() SnapshotLimits {
	return SnapshotLimits{TTL: 15 * time.Minute, MaxEntries: 128, MaxPerOwner: 16, MaxBytes: 32 << 20}
}

// DynamicStore builds immutable, owner-scoped market-data snapshots. Dates
// remain server-derived metadata: the browser chooses a rule and universe,
// never an arbitrary provider symbol or date window.
type DynamicStore struct {
	provider  marketdata.Provider
	universes universe.Repository
	mu        sync.RWMutex
	entries   map[string]dynamicEntry
	limits    SnapshotLimits
	bytes     int
	now       func() time.Time
}

func NewDynamicStore(provider marketdata.Provider, universes universe.Repository) (*DynamicStore, error) {
	return NewDynamicStoreWithLimits(provider, universes, DefaultSnapshotLimits())
}

func NewDynamicStoreWithLimits(provider marketdata.Provider, universes universe.Repository, limits SnapshotLimits) (*DynamicStore, error) {
	if provider == nil || universes == nil {
		return nil, fmt.Errorf("market data provider and universe repository are required")
	}
	if limits.TTL <= 0 || limits.MaxEntries < 1 || limits.MaxPerOwner < 1 || limits.MaxBytes < 1 {
		return nil, fmt.Errorf("invalid dataset snapshot limits")
	}
	return &DynamicStore{provider: provider, universes: universes, entries: make(map[string]dynamicEntry), limits: limits, now: time.Now}, nil
}

func (store *DynamicStore) Prepare(ctx context.Context, owner string, request PrepareRequest) (Manifest, error) {
	owner = strings.TrimSpace(owner)
	if owner == "" || request.Purpose != "screen" || strings.TrimSpace(request.RuleID) == "" || strings.TrimSpace(request.UniverseID) == "" {
		return Manifest{}, ErrInvalidRequest
	}
	// Check limits before an expensive provider fetch and again atomically when
	// storing, because simultaneous prepares may consume the remaining capacity.
	store.mu.Lock()
	store.pruneExpiredLocked()
	available := store.hasCapacityLocked(owner, 0)
	store.mu.Unlock()
	if !available {
		return Manifest{}, ErrCapacity
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
	if err := marketdata.ValidateSeries(series, instruments, dynamicOutputSize); err != nil {
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
	now := store.now().UTC()
	expiresAt := now.Add(store.limits.TTL)
	manifest := Manifest{
		DatasetID: id, Version: now.Format("20060102T150405Z"), ExpiresAt: expiresAt.Format(time.RFC3339),
		SchemaVersion: "ohlcv-multi-1", Provider: "yahoo_finance", Purpose: "screen",
		Market: "IDX", Currency: "IDR", Symbols: symbols, Timeframe: "1d", Timezone: "UTC",
		RequestedRange: Range{From: from, To: to}, AvailableRange: Range{From: from, To: to},
		WarmupCandles: 20, Adjustment: "none", CandleCount: candleCount, DecodedBytes: len(content),
		Checksum: "sha256:" + hex.EncodeToString(hash[:]),
		Quality:  Quality{Status: "complete", Warnings: []string{"Yahoo Finance data; unofficial source for academic MVP use"}},
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	store.pruneExpiredLocked()
	if !store.hasCapacityLocked(owner, len(content)) {
		return Manifest{}, ErrCapacity
	}
	store.entries[id] = dynamicEntry{owner: owner, manifest: cloneManifest(manifest), content: content, expiresAt: expiresAt}
	store.bytes += len(content)
	return cloneManifest(manifest), nil
}

func (store *DynamicStore) Manifest(_ context.Context, owner, id string) (Manifest, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.pruneExpiredLocked()
	entry, ok := store.entries[strings.TrimSpace(id)]
	if !ok || entry.owner != strings.TrimSpace(owner) {
		return Manifest{}, ErrNotFound
	}
	return cloneManifest(entry.manifest), nil
}

func (store *DynamicStore) Content(ctx context.Context, owner, id string) ([]byte, Manifest, error) {
	if err := ctx.Err(); err != nil {
		return nil, Manifest{}, err
	}
	// Read the bytes and metadata under the same lock; expiry cannot remove the
	// entry between a successful manifest lookup and a content lookup.
	store.mu.Lock()
	defer store.mu.Unlock()
	store.pruneExpiredLocked()
	entry, ok := store.entries[strings.TrimSpace(id)]
	if !ok || entry.owner != strings.TrimSpace(owner) {
		return nil, Manifest{}, ErrNotFound
	}
	return append([]byte(nil), entry.content...), cloneManifest(entry.manifest), nil
}

func (store *DynamicStore) pruneExpiredLocked() {
	for id, entry := range store.entries {
		if !store.now().Before(entry.expiresAt) {
			store.bytes -= len(entry.content)
			delete(store.entries, id)
		}
	}
}

func (store *DynamicStore) hasCapacityLocked(owner string, bytes int) bool {
	if len(store.entries) >= store.limits.MaxEntries || store.bytes+bytes > store.limits.MaxBytes {
		return false
	}
	count := 0
	for _, entry := range store.entries {
		if entry.owner == owner {
			count++
		}
	}
	return count < store.limits.MaxPerOwner
}

func cloneManifest(manifest Manifest) Manifest {
	manifest.Symbols = append([]string(nil), manifest.Symbols...)
	manifest.Quality.Warnings = append([]string(nil), manifest.Quality.Warnings...)
	return manifest
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
