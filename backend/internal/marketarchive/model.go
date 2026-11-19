// Package marketarchive owns shared, versioned daily OHLCV. It never reads
// private user state and does not calculate indicators or evaluate rules.
package marketarchive

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

var (
	ErrCapacity    = errors.New("market archive database capacity limit reached")
	ErrBusy        = errors.New("market synchronization is already running")
	ErrSmokeClosed = errors.New("scheduler smoke test is not armed or its budget has ended")
)

const (
	ImportBudget int64 = 350 * 1024 * 1024
	HardBudget   int64 = 400 * 1024 * 1024
)

type Run struct {
	ID             string     `json:"id"`
	Revision       int64      `json:"revision"`
	Scope          string     `json:"scope"`
	Market         string     `json:"market"`
	ExternalID     string     `json:"external_id"`
	Trigger        string     `json:"trigger"`
	From           time.Time  `json:"from"`
	To             time.Time  `json:"to_exclusive"`
	Status         string     `json:"status"`
	Total          int        `json:"total"`
	Successful     int        `json:"successful"`
	Failed         int        `json:"failed"`
	Inserted       int        `json:"inserted"`
	Changed        int        `json:"changed"`
	Unchanged      int        `json:"unchanged"`
	PreflightBytes int64      `json:"preflight_bytes,omitempty"`
	ProjectedBytes int64      `json:"projected_bytes,omitempty"`
	StartedAt      time.Time  `json:"started_at"`
	FinishedAt     *time.Time `json:"finished_at,omitempty"`
}

type Quality struct {
	Warnings         []string  `json:"warnings"`
	SkippedNullRows  int       `json:"skipped_null_rows"`
	ExcludedOpenRows int       `json:"excluded_open_rows"`
	CheckedAt        time.Time `json:"checked_at"`
}

type HistorySource interface {
	DailyHistory(context.Context, universe.Instrument, time.Time, time.Time) (marketdata.History, error)
}

// Window uses exchange-local dates, clamping month ends rather than normalizing
// February 31 into March. Provider finality checks remain authoritative.
func Window(now time.Time, market string) (time.Time, time.Time, error) {
	zone := "Asia/Jakarta"
	if market == "US" {
		zone = "America/New_York"
	} else if market != "IDX" {
		return time.Time{}, time.Time{}, universe.ErrInvalid
	}
	location, err := time.LoadLocation(zone)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	local := now.In(location)
	to := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
	if local.Hour() >= 18 {
		to = to.AddDate(0, 0, 1)
	}
	target := time.Date(to.Year(), to.Month()-3, 1, 0, 0, 0, 0, location)
	last := time.Date(target.Year(), target.Month()+1, 0, 0, 0, 0, 0, location).Day()
	day := min(to.Day(), last)
	from := time.Date(target.Year(), target.Month(), day, 0, 0, 0, 0, location)
	return from.UTC(), to.UTC(), nil
}

func catalogHash(items []universe.Instrument) string {
	// Provider symbols are omitted by Instrument's public JSON tag.
	type binding struct{ Symbol, ProviderSymbol, Exchange, Currency string }
	bound := make([]binding, len(items))
	for i, item := range items {
		bound[i] = binding{item.Symbol, item.ProviderSymbol, item.Exchange, item.Currency}
	}
	raw, _ := json.Marshal(bound)
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:])
}
