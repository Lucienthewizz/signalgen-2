package dataset

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

func validateBacktestPrepare(input PrepareRequest) error {
	config := core.DefaultBacktestConfig()
	config.Mode = input.Mode
	config.From = input.From
	config.To = input.To
	config.NSteps = input.NSteps
	if input.Timeframe != "" {
		config.Timeframe = input.Timeframe
	}
	if core.ValidateBacktestConfig(config) != nil || strings.TrimSpace(input.UniverseID) == "" || (input.Mode == "rule" && strings.TrimSpace(input.RuleID) == "") || (input.Mode == "manual" && input.RuleID != "") {
		return ErrInvalidRequest
	}
	return nil
}

func (store *DynamicStore) prepareBacktest(ctx context.Context, owner string, input PrepareRequest) (Manifest, error) {
	if err := validateBacktestPrepare(input); err != nil {
		return Manifest{}, err
	}
	owner = strings.TrimSpace(owner)
	if owner == "" {
		return Manifest{}, ErrInvalidRequest
	}
	if err := ctx.Err(); err != nil {
		return Manifest{}, err
	}
	from, _ := time.Parse("2006-01-02", input.From)
	to, _ := time.Parse("2006-01-02", input.To)
	if to.After(store.now().UTC()) {
		return Manifest{}, ErrInvalidRequest
	}
	fetchFrom := from.AddDate(0, 0, -90)
	fetchTo := to.AddDate(0, 0, 3*input.NSteps+11)
	tomorrow := store.now().UTC().Truncate(24*time.Hour).AddDate(0, 0, 1)
	if fetchTo.After(tomorrow) {
		fetchTo = tomorrow
	}
	if fetchTo.Sub(fetchFrom) > 6*366*24*time.Hour {
		return Manifest{}, ErrInvalidRequest
	}
	reader, ok := store.provider.(marketdata.HistoryProvider)
	if !ok {
		return Manifest{}, marketdata.ErrHistoryUnavailable
	}
	keyBytes, _ := json.Marshal(input)
	contextKey := "backtest\x00" + string(keyBytes)
	store.mu.Lock()
	store.pruneExpiredLocked()
	available := store.hasCapacityLocked(owner, 0)
	for _, entry := range store.entries {
		if entry.owner == owner && entry.contextKey == contextKey {
			available = true
			break
		}
	}
	store.mu.Unlock()
	if !available {
		return Manifest{}, ErrCapacity
	}
	instruments, err := store.universes.Instruments(ctx, owner, input.UniverseID)
	if err != nil {
		if err == universe.ErrNotFound {
			return Manifest{}, ErrNotFound
		}
		return Manifest{}, err
	}
	if len(instruments) < 1 || len(instruments) > universe.MaxSymbols {
		return Manifest{}, ErrInvalidRequest
	}
	market, currency, err := universe.InstrumentMarket(instruments)
	if err != nil {
		return Manifest{}, ErrInvalidRequest
	}
	series := make([]marketdata.Series, len(instruments))
	exchanges := make([]string, len(instruments))
	// At most three concurrent series; the shared provider adds its global bound.
	workCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	var group sync.WaitGroup
	var first sync.Once
	var failure error
	for offset := 0; offset < min(3, len(instruments)); offset++ {
		group.Add(1)
		go func() {
			defer group.Done()
			for i := offset; i < len(instruments); i += min(3, len(instruments)) {
				history, e := reader.DailyHistory(workCtx, instruments[i], fetchFrom, fetchTo)
				if e == nil {
					e = marketdata.ValidateHistory(history.Series, instruments[i].Symbol, fetchFrom, fetchTo)
				}
				if e == nil {
					warmup, inRange := 0, 0
					previousDay := ""
					for _, c := range history.Series.Candles {
						stamp, _ := time.Parse(time.RFC3339, c.Timestamp)
						day := stamp.UTC().Format("2006-01-02")
						if day <= previousDay {
							e = marketdata.ErrInvalidData
							break
						}
						previousDay = day
						if stamp.Before(from) {
							warmup++
						}
						if day >= input.From && day <= input.To {
							inRange++
						}
					}
					if e == nil && (warmup < 20 || inRange == 0) {
						e = marketdata.ErrInsufficientCandles
					}
				}
				if e != nil {
					first.Do(func() { failure = e; cancel() })
					return
				}
				series[i] = history.Series
				exchanges[i] = instruments[i].Exchange
			}
		}()
	}
	group.Wait()
	if failure != nil {
		return Manifest{}, failure
	}
	if err := ctx.Err(); err != nil {
		return Manifest{}, err
	}
	scope := &BacktestScope{Mode: input.Mode, From: input.From, To: input.To, NSteps: input.NSteps, RuleID: input.RuleID}
	content, err := json.Marshal(map[string]any{"schema_version": "ohlcv-multi-1", "purpose": "backtest", "market": market, "currency": currency, "timeframe": "1d", "timezone": "UTC", "adjustment": "none", "backtest": scope, "series": series})
	if err != nil {
		return Manifest{}, err
	}
	firstDate, lastDate, count, symbols, err := summarizeSeries(series)
	if err != nil {
		return Manifest{}, err
	}
	id, err := randomDatasetID()
	if err != nil {
		return Manifest{}, err
	}
	hash := sha256.Sum256(content)
	now := store.now().UTC()
	expires := now.Add(store.limits.TTL)
	source := marketdata.DescribeSource(store.provider)
	source.Warnings = append(source.Warnings, "Raw OHLCV; splits/dividends and exchange-calendar completeness are not verified. Exit horizons without enough closed candles remain open.")
	for _, item := range series {
		source.Warnings = append(source.Warnings, item.QualityWarnings...)
	}
	manifest := Manifest{DatasetID: id, Version: now.Format("20060102T150405Z"), ExpiresAt: expires.Format(time.RFC3339), SchemaVersion: "ohlcv-multi-1", Provider: source.Provider, Purpose: "backtest", Market: market, Currency: currency, Symbols: symbols, Exchanges: exchanges, Timeframe: "1d", Timezone: "UTC", RequestedRange: Range{input.From, input.To}, AvailableRange: Range{firstDate, lastDate}, WarmupCandles: 20, Adjustment: "none", CandleCount: count, DecodedBytes: len(content), Checksum: "sha256:" + hex.EncodeToString(hash[:]), Quality: Quality{Status: "partial", Warnings: source.Warnings}, Backtest: scope}
	manifest.AvailableTimestampRange, _ = timestampRanges(series)
	store.mu.Lock()
	defer store.mu.Unlock()
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
	store.entries[id] = dynamicEntry{contextKey: contextKey, owner: owner, manifest: cloneManifest(manifest), content: content, expiresAt: expires}
	store.bytes += len(content)
	return manifest, nil
}
