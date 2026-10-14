package collection

import (
	"context"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

// ArchiveProvider serves a fixed research collection, not a live price feed.
// The API still resolves the user's universe before this adapter is called.
// Only catalog metadata stays in memory; selected candles are read on demand.
// Deploy an immutable, read-only directory and restart to select a new archive.
type ArchiveProvider struct {
	directory string
	items     map[string]Instrument
	entries   map[string]Entry
	from      time.Time
	to        time.Time
	warnings  []string
}

var _ marketdata.Provider = (*ArchiveProvider)(nil)

// NewArchiveProvider validates metadata at startup without downloading anything
// or importing private user state. Failed/pending tickers remain unavailable.
func NewArchiveProvider(directory string) (*ArchiveProvider, error) {
	directory = strings.TrimSpace(directory)
	if directory == "" {
		return nil, fmt.Errorf("IDX archive directory is required")
	}
	info, err := os.Stat(directory)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("IDX archive directory is unavailable")
	}
	if _, err := os.Lstat(filepath.Join(directory, ".collect.lock")); !os.IsNotExist(err) {
		return nil, fmt.Errorf("IDX archive must not have an active collection lock")
	}
	var catalog Catalog
	var report Report
	if err := readJSON(filepath.Join(directory, "catalog.json"), &catalog); err != nil {
		return nil, fmt.Errorf("invalid IDX archive catalog")
	}
	if err := readJSON(filepath.Join(directory, "report.json"), &report); err != nil {
		return nil, fmt.Errorf("invalid IDX archive report")
	}
	from, fromErr := time.Parse(time.RFC3339, report.RequestedFrom)
	to, toErr := time.Parse(time.RFC3339, report.RequestedToExclusive)
	_, retrievedErr := time.Parse(time.RFC3339, catalog.RetrievedAt)
	_, updatedErr := time.Parse(time.RFC3339, report.UpdatedAt)
	hash, hashErr := hex.DecodeString(catalog.SourceSHA256)
	if report.Schema != "idx-daily-collection-1" || report.Interval != "1d" || report.Adjustment != "raw_ohlcv" ||
		fromErr != nil || toErr != nil || !from.Before(to) || to.Sub(from) > 6*366*24*time.Hour ||
		retrievedErr != nil || updatedErr != nil || hashErr != nil || len(hash) != 32 ||
		report.CatalogSHA256 != catalog.SourceSHA256 || report.SourceURL != catalog.SourceURL ||
		report.CatalogRetrievedAt != catalog.RetrievedAt || len(catalog.Items) < 1 || len(catalog.Items) > 12000 ||
		len(report.Entries) != len(catalog.Items) {
		return nil, fmt.Errorf("IDX archive metadata binding is invalid")
	}
	provider := &ArchiveProvider{directory: directory, from: from, to: to, items: make(map[string]Instrument), entries: make(map[string]Entry)}
	successes := 0
	for index, item := range catalog.Items {
		entry := report.Entries[index]
		if !stockCode.MatchString(item.Code) || item.ProviderSymbol != item.Code+".JK" || entry.Code != item.Code {
			return nil, fmt.Errorf("IDX archive instrument binding is invalid")
		}
		if _, exists := provider.items[item.ProviderSymbol]; exists {
			return nil, fmt.Errorf("IDX archive contains duplicate instruments")
		}
		switch entry.Status {
		case "success":
			first, firstErr := time.Parse(time.RFC3339, entry.FirstTimestamp)
			last, lastErr := time.Parse(time.RFC3339, entry.LastTimestamp)
			if entry.Candles < 1 || entry.Candles > 2500 || entry.SkippedNullRows < 0 || firstErr != nil || lastErr != nil ||
				first.Before(from) || !last.Before(to) || last.Before(first) || entry.Error != "" {
				return nil, fmt.Errorf("IDX archive success metadata is invalid")
			}
			successes++
		case "failed", "pending":
		default:
			return nil, fmt.Errorf("IDX archive entry status is invalid")
		}
		provider.items[item.ProviderSymbol] = item
		provider.entries[item.ProviderSymbol] = entry
	}
	if successes == 0 {
		return nil, fmt.Errorf("IDX archive has no available histories")
	}
	provider.warnings = []string{
		fmt.Sprintf("Fixed historical archive [%s, %s); NOT real-time; collected %s", report.RequestedFrom, report.RequestedToExclusive, report.UpdatedAt),
		fmt.Sprintf("Collection coverage: %d/%d successful tickers; missing dates, suspensions and corporate-action adjustment are not verified", successes, len(catalog.Items)),
	}
	return provider, nil
}

// Daily returns the latest outputSize archived candles, with a minimum warmup
// of 20. It never substitutes live Yahoo data, zero candles or a no-match result
// for an unavailable ticker. A request either gets all selected series or fails.
func (provider *ArchiveProvider) Daily(ctx context.Context, instruments []universe.Instrument, outputSize int) ([]marketdata.Series, error) {
	if len(instruments) < 1 || len(instruments) > universe.MaxSymbols || outputSize < 20 || outputSize > 5000 {
		return nil, marketdata.ErrInvalidData
	}
	seen := make(map[string]bool, len(instruments))
	for _, instrument := range instruments {
		item, exists := provider.items[instrument.Symbol]
		if !exists || instrument.ProviderSymbol != item.ProviderSymbol || seen[instrument.Symbol] {
			return nil, marketdata.ErrInvalidData
		}
		seen[instrument.Symbol] = true
	}
	result := make([]marketdata.Series, 0, len(instruments))
	for _, instrument := range instruments {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		entry := provider.entries[instrument.Symbol]
		if entry.Status != "success" || entry.Candles < 20 {
			return nil, marketdata.ErrUnavailable
		}
		snapshot, err := readSnapshot(provider.directory, provider.items[instrument.Symbol], provider.from, provider.to)
		if err != nil {
			if os.IsNotExist(err) || os.IsPermission(err) {
				return nil, marketdata.ErrUnavailable
			}
			return nil, marketdata.ErrInvalidData
		}
		series := snapshot.History.Series
		if len(series.Candles) != entry.Candles || series.Candles[0].Timestamp != entry.FirstTimestamp ||
			series.Candles[len(series.Candles)-1].Timestamp != entry.LastTimestamp ||
			snapshot.History.SkippedNullRows != entry.SkippedNullRows {
			return nil, marketdata.ErrInvalidData
		}
		if len(series.Candles) > outputSize {
			series.Candles = series.Candles[len(series.Candles)-outputSize:]
		}
		result = append(result, series)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return result, marketdata.ValidateSeries(result, instruments, outputSize)
}

// Source keeps the existing Yahoo provider identifier for API compatibility;
// warnings distinguish archive date/coverage from a network provider request.
func (provider *ArchiveProvider) Source() marketdata.Source {
	return marketdata.Source{Provider: "yahoo_finance", Warnings: append([]string(nil), provider.warnings...)}
}
