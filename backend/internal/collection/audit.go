package collection

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type AuditEntry struct {
	Symbol         string   `json:"symbol"`
	ProviderSymbol string   `json:"provider_symbol"`
	Exchange       string   `json:"exchange"`
	Currency       string   `json:"currency"`
	Status         string   `json:"status"`
	Candles        int      `json:"candles"`
	First          string   `json:"first_timestamp,omitempty"`
	Last           string   `json:"last_timestamp,omitempty"`
	SHA256         string   `json:"ohlcv_sha256,omitempty"`
	Warnings       []string `json:"warnings,omitempty"`
	Error          string   `json:"error,omitempty"`
}

type AuditReport struct {
	Schema           string         `json:"schema"`
	Source           string         `json:"source"`
	Market           string         `json:"market"`
	CatalogSHA256    string         `json:"catalog_sha256"`
	From             string         `json:"from_inclusive"`
	To               string         `json:"to_exclusive"`
	UpdatedAt        string         `json:"updated_at"`
	StoppedReason    string         `json:"stopped_reason,omitempty"`
	CoverageComplete bool           `json:"coverage_complete"`
	AllUsable        bool           `json:"all_usable"`
	Counts           map[string]int `json:"counts"`
	Entries          []AuditEntry   `json:"entries"`
}

// AuditCatalog is serial, resumable provider QA, not a private rule execution or
// historical point-in-time universe. No user rule, grant or transaction is read.
func AuditCatalog(ctx context.Context, items []universe.Instrument, market, directory string, from, to time.Time, delay time.Duration, retryFailed bool, provider HistoryProvider, progress func(AuditEntry)) (AuditReport, error) {
	if directory == "" || provider == nil || (market != "IDX" && market != "US") || !from.Before(to) || to.Sub(from) > 366*24*time.Hour || delay < 500*time.Millisecond || delay > time.Minute {
		return AuditReport{}, fmt.Errorf("invalid catalog audit options")
	}
	items = append([]universe.Instrument(nil), items...)
	sort.Slice(items, func(i, j int) bool { return items[i].Symbol < items[j].Symbol })
	entries := make([]AuditEntry, 0)
	seen := make(map[string]bool)
	for _, item := range items {
		exchangeMatches := market == "IDX" && item.Exchange == "XIDX" || market == "US" && (item.Exchange == "XNAS" || item.Exchange == "XNYS")
		if universe.SymbolMarket(item.Symbol) != market && !exchangeMatches {
			continue
		}
		actual, _, err := universe.InstrumentMarket([]universe.Instrument{item})
		if err != nil || actual != market || seen[item.Symbol] || item.ProviderSymbol == "" {
			return AuditReport{}, fmt.Errorf("invalid catalog metadata")
		}
		seen[item.Symbol] = true
		entries = append(entries, AuditEntry{Symbol: item.Symbol, ProviderSymbol: item.ProviderSymbol, Exchange: item.Exchange, Currency: item.Currency, Status: "pending"})
	}
	if len(entries) == 0 {
		return AuditReport{}, fmt.Errorf("empty market catalog")
	}
	encoded, _ := json.Marshal(entries)
	hash := sha256.Sum256(encoded)
	report := AuditReport{Schema: "market-data-audit-1", Source: "active SignalGen catalog; provider OHLCV without extra adjustment; data QA only, no rule evaluation", Market: market, CatalogSHA256: hex.EncodeToString(hash[:]), From: from.UTC().Format(time.RFC3339), To: to.UTC().Format(time.RFC3339), Entries: entries}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return AuditReport{}, err
	}
	lockPath := filepath.Join(directory, ".audit.lock")
	lock, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return AuditReport{}, fmt.Errorf("audit directory is locked")
	}
	_ = lock.Close()
	defer os.Remove(lockPath)
	path := filepath.Join(directory, "report.json")
	var existing AuditReport
	if err := readJSON(path, &existing); err == nil {
		if existing.Schema != report.Schema || existing.Market != market || existing.CatalogSHA256 != report.CatalogSHA256 || existing.From != report.From || existing.To != report.To || len(existing.Entries) != len(entries) {
			return AuditReport{}, fmt.Errorf("report belongs to another catalog/window; choose a new directory")
		}
		for i, row := range existing.Entries {
			if row.Symbol != entries[i].Symbol || row.ProviderSymbol != entries[i].ProviderSymbol || row.Exchange != entries[i].Exchange || row.Currency != entries[i].Currency || (row.Status != "pending" && row.Status != "valid" && row.Status != "insufficient" && row.Status != "failed") {
				return AuditReport{}, fmt.Errorf("audit report binding is invalid")
			}
		}
		report = existing
	} else if !os.IsNotExist(err) {
		return AuditReport{}, fmt.Errorf("cannot read prior audit report")
	}
	report.StoppedReason = ""
	persist := func() error {
		report.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		report.Counts = map[string]int{"pending": 0, "valid": 0, "insufficient": 0, "failed": 0, "total": len(report.Entries)}
		for _, row := range report.Entries {
			report.Counts[row.Status]++
		}
		report.CoverageComplete = report.Counts["pending"] == 0
		report.AllUsable = report.Counts["valid"] == len(report.Entries)
		return writeJSON(path, report)
	}
	if err := persist(); err != nil {
		return report, err
	}
	attempts, failures := 0, 0
	for i, entry := range report.Entries {
		if entry.Status == "valid" || (entry.Status != "pending" && !retryFailed) {
			continue
		}
		if attempts > 0 {
			timer := time.NewTimer(delay)
			select {
			case <-timer.C:
			case <-ctx.Done():
				timer.Stop()
			}
		}
		if ctx.Err() != nil {
			report.StoppedReason = "budget_or_cancel"
			return report, persist()
		}
		attempts++
		history, err := provider.DailyHistory(ctx, universe.Instrument{Symbol: entry.Symbol, ProviderSymbol: entry.ProviderSymbol, Exchange: entry.Exchange, Currency: entry.Currency}, from, to)
		if ctx.Err() != nil {
			report.StoppedReason = "budget_or_cancel"
			return report, persist()
		}
		if err == nil {
			err = marketdata.ValidateHistory(history.Series, entry.Symbol, from, to)
		}
		entry.Status, entry.Error = "failed", ""
		entry.Candles, entry.First, entry.Last, entry.SHA256, entry.Warnings = 0, "", "", "", nil
		if err == nil {
			failures = 0
			entry.Status, entry.Candles = "valid", len(history.Series.Candles)
			if entry.Candles < 20 {
				entry.Status = "insufficient"
			}
			entry.First, entry.Last = history.Series.Candles[0].Timestamp, history.Series.Candles[entry.Candles-1].Timestamp
			data, _ := json.Marshal(history.Series.Candles)
			sum := sha256.Sum256(data)
			entry.SHA256 = hex.EncodeToString(sum[:])
			entry.Warnings = append([]string{"active catalog is not point-in-time; exchange calendar, delisting and redistribution rights not certified"}, history.Series.QualityWarnings...)
		} else {
			entry.Error = "invalid_provider_data"
			var upstream *marketdata.HTTPError
			if errors.As(err, &upstream) {
				entry.Error = fmt.Sprintf("provider_http_%d", upstream.Status)
				if upstream.Status == 429 {
					report.StoppedReason = "provider_rate_limited"
				}
			}
			transient := errors.Is(err, marketdata.ErrUnavailable)
			if upstream != nil {
				transient = upstream.Status >= 500
			}
			if transient {
				failures++
				if entry.Error == "invalid_provider_data" {
					entry.Error = "provider_unavailable"
				}
			} else {
				failures = 0
			}
			if failures >= 3 {
				report.StoppedReason = "provider_unavailable_three_times"
			}
		}
		report.Entries[i] = entry
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
