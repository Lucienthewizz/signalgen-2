package collection

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type HistoryProvider interface {
	DailyHistory(context.Context, universe.Instrument, time.Time, time.Time) (marketdata.History, error)
}

type Options struct {
	Directory   string
	From        time.Time
	To          time.Time
	Interval    time.Duration
	Limit       int
	RetryFailed bool
	Refresh     bool
}

type Entry struct {
	Code            string   `json:"code"`
	Status          string   `json:"status"`
	Candles         int      `json:"candles"`
	FirstTimestamp  string   `json:"first_timestamp,omitempty"`
	LastTimestamp   string   `json:"last_timestamp,omitempty"`
	SkippedNullRows int      `json:"skipped_null_rows,omitempty"`
	Warnings        []string `json:"warnings,omitempty"`
	Error           string   `json:"error,omitempty"`
}

// Report is persisted after each ticker. Pending and failed rows stay visible;
// a partly finished run never becomes a claim of complete IDX market history.
type Report struct {
	Schema               string  `json:"schema"`
	CatalogSHA256        string  `json:"catalog_sha256"`
	SourceURL            string  `json:"source_url"`
	CatalogRetrievedAt   string  `json:"catalog_retrieved_at"`
	RequestedFrom        string  `json:"requested_from"`
	RequestedToExclusive string  `json:"requested_to_exclusive"`
	Interval             string  `json:"interval"`
	Adjustment           string  `json:"adjustment"`
	UpdatedAt            string  `json:"updated_at"`
	StoppedReason        string  `json:"stopped_reason,omitempty"`
	Entries              []Entry `json:"entries"`
}

type Snapshot struct {
	Code                 string             `json:"code"`
	RequestedFrom        string             `json:"requested_from"`
	RequestedToExclusive string             `json:"requested_to_exclusive"`
	FetchedAt            string             `json:"fetched_at"`
	DataSHA256           string             `json:"data_sha256"`
	History              marketdata.History `json:"history"`
}

// Run deliberately uses one worker. Acquisition is separate from the API so
// importing hundreds of tickers does not increase live-screening socket limits.
func Run(ctx context.Context, catalog Catalog, provider HistoryProvider, options Options, progress func(Entry)) (Report, error) {
	if provider == nil || options.Directory == "" || !options.From.Before(options.To) || options.Interval < 0 || options.Limit < 0 || len(catalog.Items) == 0 {
		return Report{}, fmt.Errorf("invalid collection options")
	}
	if err := os.MkdirAll(options.Directory, 0700); err != nil {
		return Report{}, err
	}
	lockPath := filepath.Join(options.Directory, ".collect.lock")
	lock, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return Report{}, fmt.Errorf("collection directory is locked: %w", err)
	}
	_ = lock.Close()
	defer os.Remove(lockPath)
	from, to := options.From.Format(time.RFC3339), options.To.Format(time.RFC3339)
	report := Report{Schema: "idx-daily-collection-1", CatalogSHA256: catalog.SourceSHA256, SourceURL: catalog.SourceURL, CatalogRetrievedAt: catalog.RetrievedAt, RequestedFrom: from, RequestedToExclusive: to, Interval: "1d", Adjustment: "raw_ohlcv"}
	reportPath := filepath.Join(options.Directory, "report.json")
	if err := readJSON(reportPath, &report); err != nil {
		if !os.IsNotExist(err) {
			return Report{}, fmt.Errorf("read existing report: %w", err)
		}
		files, readErr := os.ReadDir(options.Directory)
		if readErr != nil {
			return Report{}, readErr
		}
		for _, file := range files {
			if file.Name() != ".collect.lock" {
				return Report{}, fmt.Errorf("output directory is nonempty without a collection report; choose another directory")
			}
		}
	}
	if report.Schema != "idx-daily-collection-1" || report.CatalogSHA256 != catalog.SourceSHA256 || report.RequestedFrom != from || report.RequestedToExclusive != to {
		return Report{}, fmt.Errorf("existing directory belongs to a different catalog/window; choose another output directory")
	}
	if len(report.Entries) == 0 {
		for _, item := range catalog.Items {
			report.Entries = append(report.Entries, Entry{Code: item.Code, Status: "pending"})
		}
		if err := writeJSON(filepath.Join(options.Directory, "catalog.json"), catalog); err != nil {
			return report, err
		}
	}
	if len(report.Entries) != len(catalog.Items) {
		return report, fmt.Errorf("report/catalog count mismatch")
	}
	for index, item := range catalog.Items {
		if report.Entries[index].Code != item.Code || !stockCode.MatchString(item.Code) {
			return report, fmt.Errorf("report/catalog code mismatch")
		}
	}
	report.StoppedReason = ""
	persist := func() error {
		report.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		return writeJSON(reportPath, report)
	}
	if err := persist(); err != nil {
		return report, err
	}
	attempts, transientFailures := 0, 0
	for index, item := range catalog.Items {
		entry := report.Entries[index]
		if entry.Status == "success" && !options.Refresh {
			if err := verifySnapshot(options.Directory, item, options.From, options.To); err != nil {
				return report, fmt.Errorf("saved %s data is invalid; inspect or explicitly refresh: %w", item.Code, err)
			}
			continue
		}
		if entry.Status == "failed" && !options.RetryFailed && !options.Refresh {
			continue
		}
		if options.Limit > 0 && attempts >= options.Limit {
			report.StoppedReason = "attempt_limit"
			break
		}
		if attempts > 0 && options.Interval > 0 {
			timer := time.NewTimer(options.Interval)
			select {
			case <-ctx.Done():
				timer.Stop()
				report.StoppedReason = "cancelled"
				_ = persist()
				return report, ctx.Err()
			case <-timer.C:
			}
		}
		if err := ctx.Err(); err != nil {
			report.StoppedReason = "cancelled"
			_ = persist()
			return report, err
		}
		attempts++
		history, err := provider.DailyHistory(ctx, universe.Instrument{Symbol: item.ProviderSymbol, ProviderSymbol: item.ProviderSymbol}, options.From, options.To)
		entry = Entry{Code: item.Code, Status: "failed"}
		if err == nil {
			err = marketdata.ValidateHistory(history.Series, item.ProviderSymbol, options.From, options.To)
		}
		if err == nil {
			data, _ := json.Marshal(history)
			hash := sha256.Sum256(data)
			snapshot := Snapshot{Code: item.Code, RequestedFrom: from, RequestedToExclusive: to, FetchedAt: time.Now().UTC().Format(time.RFC3339), DataSHA256: hex.EncodeToString(hash[:]), History: history}
			if err := writeJSON(filepath.Join(options.Directory, item.Code+".json"), snapshot); err != nil {
				return report, err
			}
			entry.Status, entry.Candles = "success", len(history.Series.Candles)
			entry.FirstTimestamp, entry.LastTimestamp = history.Series.Candles[0].Timestamp, history.Series.Candles[len(history.Series.Candles)-1].Timestamp
			entry.SkippedNullRows = history.SkippedNullRows
			entry.Warnings = []string{"provider coverage not reconciled with exchange calendar/suspensions", "raw prices; split/dividend adjustment policy not validated"}
			if history.SkippedNullRows > 0 {
				entry.Warnings = append(entry.Warnings, "null OHLCV rows omitted; gaps remain")
			}
			if item.ListingDate > options.From.Format("2006-01-02") {
				entry.Warnings = append(entry.Warnings, "listing began after requested start")
			}
			if entry.Candles < 20 {
				entry.Warnings = append(entry.Warnings, "fewer than 20 candles; not ready for existing indicator warmup")
			}
			transientFailures = 0
		} else {
			// Domain errors are intentionally recorded without provider response bodies.
			entry.Error = "invalid_or_unavailable_provider_data"
			var httpError *marketdata.HTTPError
			if errors.As(err, &httpError) {
				entry.Error = fmt.Sprintf("provider_http_%d", httpError.Status)
				if httpError.Status == 429 {
					report.StoppedReason = "provider_rate_limited"
				}
				if httpError.Status >= 500 {
					transientFailures++
				} else {
					transientFailures = 0
				}
			} else if errors.Is(err, marketdata.ErrUnavailable) {
				transientFailures++
			} else {
				transientFailures = 0
			}
			if transientFailures >= 3 {
				report.StoppedReason = "provider_unavailable_three_times"
			}
		}
		report.Entries[index] = entry
		if err := persist(); err != nil {
			return report, err
		}
		if progress != nil {
			progress(entry)
		}
		if report.StoppedReason != "" {
			break
		}
	}
	if err := persist(); err != nil {
		return report, err
	}
	return report, nil
}

func verifySnapshot(directory string, item Instrument, from, to time.Time) error {
	var snapshot Snapshot
	if err := readJSON(filepath.Join(directory, item.Code+".json"), &snapshot); err != nil {
		return err
	}
	if snapshot.Code != item.Code || snapshot.RequestedFrom != from.Format(time.RFC3339) || snapshot.RequestedToExclusive != to.Format(time.RFC3339) {
		return fmt.Errorf("snapshot binding mismatch")
	}
	data, _ := json.Marshal(snapshot.History)
	hash := sha256.Sum256(data)
	if hex.EncodeToString(hash[:]) != snapshot.DataSHA256 {
		return fmt.Errorf("snapshot checksum mismatch")
	}
	return marketdata.ValidateHistory(snapshot.History.Series, item.ProviderSymbol, from, to)
}

func readJSON(path string, target any) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if info.Size() > 16<<20 {
		return fmt.Errorf("collection file exceeds 16 MiB")
	}
	decoder := json.NewDecoder(io.LimitReader(file, 16<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return fmt.Errorf("unexpected trailing JSON")
	}
	return nil
}

// Atomic replacement prevents an interrupted process leaving a half-written
// success marker. Data files are plaintext backend research artifacts (0600),
// NOT encrypted browser cache and NOT safe to expose as a public directory.
func writeJSON(path string, value any) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".collection-*")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(value); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}
