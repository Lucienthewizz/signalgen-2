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
	contextKey string
	owner      string
	manifest   Manifest
	content    []byte
	expiresAt  time.Time
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
	if request.Timeframe == "" {
		request.Timeframe = "1d"
	}
	if _, err := marketdata.Policy(request.Timeframe); err != nil {
		return Manifest{}, err
	}
	if err := ctx.Err(); err != nil {
		return Manifest{}, err
	}
	owner = strings.TrimSpace(owner)
	if owner == "" || request.Purpose != "screen" || strings.TrimSpace(request.RuleID) == "" || strings.TrimSpace(request.UniverseID) == "" {
		return Manifest{}, ErrInvalidRequest
	}
	// Check limits before an expensive provider fetch and again atomically when
	// storing, because simultaneous prepares may consume the remaining capacity.
	store.mu.Lock()
	store.pruneExpiredLocked()
	available := store.hasCapacityLocked(owner, 0)
	contextKey := request.RuleID + "\x00" + request.UniverseID + "\x00" + request.Timeframe
	canReuse := false
	for _, entry := range store.entries {
		if entry.owner == owner && entry.contextKey == contextKey {
			canReuse = true
			break
		}
	}
	store.mu.Unlock()
	// Capacity is enforced atomically at publication, after checking whether an
	// identical owner-scoped snapshot can be reused. Even a full store may reuse.
	if !available && !canReuse {
		return Manifest{}, ErrCapacity
	}
	instruments, err := store.universes.Instruments(ctx, owner, request.UniverseID)
	if err != nil {
		if err == universe.ErrNotFound {
			return Manifest{}, ErrNotFound
		}
		return Manifest{}, err
	}
	market, currency, err := universe.InstrumentMarket(instruments)
	if err != nil {
		return Manifest{}, ErrInvalidRequest
	}
	exchanges := make([]string, len(instruments))
	for index, item := range instruments {
		exchanges[index] = item.Exchange
	}
	series, err := marketdata.ReadCandles(ctx, store.provider, instruments, dynamicOutputSize, request.Timeframe)
	if err != nil {
		return Manifest{}, err
	}
	if err := ctx.Err(); err != nil {
		return Manifest{}, err
	}
	if err := marketdata.ValidateSeries(series, instruments, dynamicOutputSize); err != nil {
		return Manifest{}, ErrIntegrity
	}

	content, err := json.Marshal(map[string]any{
		"schema_version": "ohlcv-multi-1",
		"purpose":        "screen",
		"market":         market,
		"currency":       currency,
		"timeframe":      request.Timeframe,
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
	if request.Timeframe != "1d" {
		expiresAt = now.Add(min(store.limits.TTL, 5*time.Minute))
	}
	source := marketdata.DescribeSource(store.provider)
	// Keep request-specific quality evidence with this immutable snapshot.
	// "complete" is the existing contract for validated selected candles, not
	// proof of gap-free exchange history; omissions must remain visible here.
	for _, item := range series {
		source.Warnings = append(source.Warnings, item.QualityWarnings...)
	}
	manifest := Manifest{
		DatasetID: id, Version: now.Format("20060102T150405Z"), ExpiresAt: expiresAt.Format(time.RFC3339),
		SchemaVersion: "ohlcv-multi-1", Provider: source.Provider, Purpose: "screen",
		Market: market, Currency: currency, Symbols: symbols, Exchanges: exchanges, Timeframe: request.Timeframe, Timezone: "UTC",
		RequestedRange: Range{From: from, To: to}, AvailableRange: Range{From: from, To: to},
		WarmupCandles: 20, Adjustment: "none", CandleCount: candleCount, DecodedBytes: len(content),
		Checksum: "sha256:" + hex.EncodeToString(hash[:]),
		Quality:  Quality{Status: "complete", Warnings: source.Warnings},
	}
	manifest.AvailableTimestampRange, manifest.RequestedTimestampRange = timestampRanges(series)
	if request.Timeframe != "1d" && manifest.RequestedTimestampRange != nil {
		manifest.RequestedRange = Range{From: manifest.RequestedTimestampRange.From[:10], To: manifest.RequestedTimestampRange.To[:10]}
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	// Do not publish a new handle when this request already timed out or left.
	if err := ctx.Err(); err != nil {
		return Manifest{}, err
	}
	store.pruneExpiredLocked()
	for _, entry := range store.entries {
		if entry.owner == owner && entry.contextKey == contextKey && entry.manifest.Checksum == manifest.Checksum {
			return cloneManifest(entry.manifest), nil
		}
	}
	if !store.hasCapacityLocked(owner, len(content)) {
		return Manifest{}, ErrCapacity
	}
	store.entries[id] = dynamicEntry{contextKey: contextKey, owner: owner, manifest: cloneManifest(manifest), content: content, expiresAt: expiresAt}
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
	if manifest.AvailableTimestampRange != nil {
		copy := *manifest.AvailableTimestampRange
		manifest.AvailableTimestampRange = &copy
	}
	if manifest.RequestedTimestampRange != nil {
		copy := *manifest.RequestedTimestampRange
		manifest.RequestedTimestampRange = &copy
	}
	manifest.Symbols = append([]string(nil), manifest.Symbols...)
	manifest.Exchanges = append([]string(nil), manifest.Exchanges...)
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
