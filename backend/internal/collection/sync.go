package collection

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

// Publication points to an immutable completed generation. Readers never use
// a partially updated report, even if the collector is interrupted.
type Publication struct {
	Schema     string `json:"schema"`
	Generation string `json:"generation"`
}

func publishedArchive(root string) (*ArchiveProvider, error) {
	var p Publication
	if err := readJSON(filepath.Join(root, "current.json"), &p); err != nil {
		return nil, err
	}
	if p.Schema != "idx-store-1" || !strings.HasPrefix(p.Generation, "generation-") || filepath.Base(p.Generation) != p.Generation {
		return nil, fmt.Errorf("invalid IDX publication")
	}
	return NewArchiveProvider(filepath.Join(root, p.Generation))
}

// Sync creates/resumes a generation using a prior published snapshot as its
// warm cache. Existing fixed-window archives remain unchanged and compatible.
func Sync(ctx context.Context, catalog Catalog, provider HistoryProvider, options Options, overlapDays int, progress func(Entry)) (Report, error) {
	if provider == nil || overlapDays < 1 || overlapDays > 90 || !options.From.Before(options.To) || options.To.Sub(options.From) > 6*366*24*time.Hour {
		return Report{}, fmt.Errorf("invalid incremental options")
	}
	if err := os.MkdirAll(options.Directory, 0700); err != nil {
		return Report{}, err
	}
	lock, err := os.OpenFile(filepath.Join(options.Directory, ".sync.lock"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return Report{}, fmt.Errorf("incremental store is locked: %w", err)
	}
	lock.Close()
	defer os.Remove(filepath.Join(options.Directory, ".sync.lock"))
	previous, err := publishedArchive(options.Directory)
	if err != nil && !os.IsNotExist(err) {
		return Report{}, err
	}
	if err == nil && options.To.Before(previous.to) {
		return Report{}, fmt.Errorf("incremental end date cannot move backwards")
	}
	digest := sha256.Sum256([]byte(catalog.SourceSHA256 + options.From.Format(time.RFC3339) + options.To.Format(time.RFC3339)))
	generation := "generation-" + hex.EncodeToString(digest[:16])
	root := options.Directory
	options.Directory = filepath.Join(root, generation)
	// Published generations are immutable, including on an explicit refresh.
	if previous != nil && previous.directory == options.Directory {
		return readReport(previous.directory)
	}
	options.RetryFailed = true
	options.Refresh = false
	report, err := Run(ctx, catalog, &incrementalHistory{upstream: provider, previous: previous, overlapDays: overlapDays}, options, progress)
	if err != nil {
		return report, err
	}
	for _, entry := range report.Entries {
		if entry.Status != "success" {
			return report, fmt.Errorf("incremental collection incomplete; previous publication retained")
		}
	}
	if report.StoppedReason != "" {
		return report, fmt.Errorf("incremental collection stopped: %s", report.StoppedReason)
	}
	if _, err = NewArchiveProvider(options.Directory); err != nil {
		return report, err
	}
	if err = ctx.Err(); err != nil {
		return report, err
	}
	return report, publishGeneration(root, generation, previous)
}
func readReport(directory string) (Report, error) {
	var r Report
	err := readJSON(filepath.Join(directory, "report.json"), &r)
	return r, err
}

type incrementalHistory struct {
	upstream    HistoryProvider
	previous    *ArchiveProvider
	overlapDays int
}

func (p *incrementalHistory) DailyHistory(ctx context.Context, item universe.Instrument, from, to time.Time) (marketdata.History, error) {
	fetchFrom := from
	var old marketdata.History
	if p.previous != nil {
		if in, ok := p.previous.items[item.ProviderSymbol]; ok && !from.Before(p.previous.from) {
			snapshot, err := readSnapshot(p.previous.directory, in, p.previous.from, p.previous.to)
			if err != nil {
				return marketdata.History{}, err
			}
			old = snapshot.History
			old.Series.QualityWarnings = append([]string(nil), p.previous.entries[item.ProviderSymbol].Warnings...)
			// Use the last successfully requested end, not the last candle. Weekends
			// and suspensions otherwise repeatedly expand the network request.
			fetchFrom = p.previous.to.AddDate(0, 0, -p.overlapDays)
			if fetchFrom.Before(from) {
				fetchFrom = from
			}
		}
	}
	fresh, err := p.upstream.DailyHistory(ctx, item, fetchFrom, to)
	if err != nil {
		return marketdata.History{}, err
	}
	if err = marketdata.ValidateHistory(fresh.Series, item.Symbol, fetchFrom, to); err != nil {
		return marketdata.History{}, err
	}
	candles := make([]core.Candle, 0, len(old.Series.Candles)+len(fresh.Series.Candles))
	for _, c := range old.Series.Candles {
		stamp, _ := time.Parse(time.RFC3339, c.Timestamp)
		if !stamp.Before(from) && stamp.Before(fetchFrom) {
			candles = append(candles, c)
		}
	}
	candles = append(candles, fresh.Series.Candles...)
	fresh.Series.Candles = candles
	fresh.Series.QualityWarnings = append(fresh.Series.QualityWarnings, "Incremental raw OHLCV; corrections older than the overlap window require an explicit rebuild.")
	// Historical omitted-row totals are retained conservatively; overlap counts
	// are not added because that would count the same missing row repeatedly.
	fresh.SkippedNullRows = max(fresh.SkippedNullRows, old.SkippedNullRows)
	warnings := append(old.Series.QualityWarnings, fresh.Series.QualityWarnings...)
	fresh.Series.QualityWarnings = nil
	seenWarnings := map[string]bool{}
	for _, warning := range warnings {
		if !seenWarnings[warning] {
			fresh.Series.QualityWarnings = append(fresh.Series.QualityWarnings, warning)
			seenWarnings[warning] = true
		}
	}
	if err = marketdata.ValidateHistory(fresh.Series, item.Symbol, from, to); err != nil {
		return marketdata.History{}, err
	}
	return fresh, nil
}

// StoreProvider resolves the publication per request. Existing requests keep
// their immutable generation; the API's shared cache still applies its TTL.
type StoreProvider struct{ root string }

func NewStoreProvider(root string) (*StoreProvider, error) {
	if _, err := publishedArchive(root); err != nil {
		return nil, err
	}
	return &StoreProvider{root}, nil
}
func (p *StoreProvider) Daily(ctx context.Context, items []universe.Instrument, size int) ([]marketdata.Series, error) {
	a, err := publishedArchive(p.root)
	if err != nil {
		return nil, marketdata.ErrUnavailable
	}
	return a.Daily(ctx, items, size)
}
func (p *StoreProvider) DailyHistory(ctx context.Context, item universe.Instrument, from, to time.Time) (marketdata.History, error) {
	a, err := publishedArchive(p.root)
	if err != nil {
		return marketdata.History{}, marketdata.ErrUnavailable
	}
	return a.DailyHistory(ctx, item, from, to)
}
func (p *StoreProvider) Source() marketdata.Source {
	return marketdata.Source{Provider: "yahoo_finance", Warnings: []string{"Scheduled IDX archive; daily data, not real-time. Publication changes are subject to the shared cache TTL; inspect snapshot available dates."}}
}

func (p *ArchiveProvider) DailyHistory(ctx context.Context, item universe.Instrument, from, to time.Time) (marketdata.History, error) {
	if err := ctx.Err(); err != nil {
		return marketdata.History{}, err
	}
	in, ok := p.items[item.Symbol]
	if !ok || item.ProviderSymbol != in.ProviderSymbol || from.Before(p.from) || !from.Before(to) {
		return marketdata.History{}, marketdata.ErrHistoryUnavailable
	}
	if p.entries[item.Symbol].Status != "success" {
		return marketdata.History{}, marketdata.ErrUnavailable
	}
	snapshot, err := readSnapshot(p.directory, in, p.from, p.to)
	if err != nil {
		return marketdata.History{}, marketdata.ErrInvalidData
	}
	result := snapshot.History
	result.Series.Candles = nil
	for _, c := range snapshot.History.Series.Candles {
		stamp, _ := time.Parse(time.RFC3339, c.Timestamp)
		if !stamp.Before(from) && stamp.Before(to) {
			result.Series.Candles = append(result.Series.Candles, c)
		}
	}
	result.Series.QualityWarnings = append([]string(nil), p.entries[item.Symbol].Warnings...)
	if len(result.Series.Candles) == 0 {
		return marketdata.History{}, marketdata.ErrInsufficientCandles
	}
	return result, marketdata.ValidateHistory(result.Series, item.Symbol, from, to)
}
