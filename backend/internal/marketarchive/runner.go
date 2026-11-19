package marketarchive

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type Options struct {
	Scope, Market, ExternalID, Trigger string
	Now                                time.Time
	Delay                              time.Duration
	// Bootstrap is a pinned, validated local IDX archive, never a directory writer.
	Bootstrap HistorySource
	Progress  func(Run, string, string)
}

type Runner struct {
	Store  *Store
	Source HistorySource
}

// Collect freezes the catalog and window, stages each result, then atomically
// publishes one revision. A failed ticker retains explicit failure metadata.
func (r *Runner) Collect(ctx context.Context, o Options) (Run, error) {
	if r.Store == nil || r.Source == nil || o.Delay < time.Second {
		return Run{}, fmt.Errorf("collector requires a source, store and pacing of at least one second")
	}
	ctx, unlock, err := r.Store.Lock(ctx, o.Scope, o.Market)
	if err != nil {
		return Run{}, err
	}
	defer unlock()
	// Database work counts toward the one-second request spacing. Do not add
	// another second after every transaction during a full-catalog import.
	local := *r
	local.Source = &pacedHistory{source: r.Source, delay: o.Delay}
	r = &local
	if o.Now.IsZero() {
		o.Now = time.Now()
	}
	from, to, err := Window(o.Now, o.Market)
	if err != nil {
		return Run{}, err
	}
	items, err := r.Store.Catalog(ctx, o.Market, o.Scope)
	if err != nil {
		return Run{}, err
	}
	run, err := r.Store.Begin(ctx, o.Scope, o.Market, o.ExternalID, o.Trigger, from, to, items)
	if err != nil {
		return run, err
	}
	if run.Status != "running" {
		return r.Store.Report(ctx, run.ID)
	}
	stop := func(cause error) (Run, error) {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		status := "failed"
		if errors.Is(cause, ErrCapacity) {
			status = "capacity_blocked"
		} else if errors.Is(cause, context.Canceled) || errors.Is(cause, context.DeadlineExceeded) {
			status = "cancelled"
		}
		_ = r.Store.MarkStopped(cleanup, run, status)
		run.Status = status
		if report, err := r.Store.Report(cleanup, run.ID); err == nil {
			run = report
		}
		return run, cause
	}
	// Measured first samples estimate both markets before the initial import.
	// Include serialized staging twice plus tuple/index overhead per candle.
	samples := map[string]marketdata.History{}
	var existing int
	if err = r.Store.DB.QueryRow(ctx, `select count(*) from signalgen.market_publications where scope=$1 and market=$2`, o.Scope, o.Market).Scan(&existing); err != nil {
		return stop(err)
	}
	if existing == 0 && o.Scope == "production" {
		var bytes, candles int64
		probes, probeErr := r.Store.Catalog(ctx, o.Market, "smoke")
		if probeErr != nil {
			return stop(probeErr)
		}
		for _, item := range probes {
			h, _, fetchErr := r.fetch(ctx, item, from, to, o.Delay)
			if fetchErr != nil {
				return stop(fmt.Errorf("capacity sample %s: %s", item.Symbol, sourceCode(fetchErr)))
			}
			samples[item.Symbol] = h
			raw, _ := json.Marshal(h.Series.Candles)
			bytes += int64(len(raw)) * 2
			candles += int64(len(h.Series.Candles))
		}
		var catalogTotal int64
		if err = r.Store.DB.QueryRow(ctx, `select count(*) from signalgen.stock_catalog s where active and provider='yahoo_finance' and exchange in ('XIDX','XNAS','XNYS') and not exists(select 1 from signalgen.market_candles c where c.symbol=s.symbol and c.scope='production' and c.valid_to is null)`).Scan(&catalogTotal); err != nil {
			return stop(err)
		}
		current, e := r.Store.DatabaseBytes(ctx)
		if e != nil {
			return stop(e)
		}
		// Recent IPOs must not make the projection artificially small. Budget
		// every weekday in the frozen calendar window, with a minimum row cost.
		var sessions int64
		for day := from; day.Before(to); day = day.AddDate(0, 0, 1) {
			if day.Weekday() != time.Saturday && day.Weekday() != time.Sunday {
				sessions++
			}
		}
		if candles == 0 {
			return stop(marketdata.ErrInsufficientCandles)
		}
		perCandle := max(int64(700), bytes/candles+384)
		projected := current + perCandle*sessions*catalogTotal
		run.PreflightBytes = current
		run.ProjectedBytes = projected
		if _, err = r.Store.DB.Exec(ctx, `update signalgen.market_sync_runs set preflight_bytes=$2,projected_bytes=$3 where id=$1`, run.ID, current, projected); err != nil {
			return stop(err)
		}
		if projected >= ImportBudget {
			return stop(fmt.Errorf("%w: projected total %d bytes exceeds import target", ErrCapacity, projected))
		}
	}
	for _, item := range items {
		if err = ctx.Err(); err != nil {
			return stop(err)
		}
		var done bool
		if err = r.Store.DB.QueryRow(ctx, `select status='success' from signalgen.market_sync_items where run_id=$1 and symbol=$2`, run.ID, item.Symbol).Scan(&done); err != nil {
			return stop(err)
		}
		if done {
			continue
		}
		start := from
		var last *time.Time
		if err = r.Store.DB.QueryRow(ctx, `select max(timestamp) from signalgen.market_candles where scope=$1 and symbol=$2 and valid_to is null`, o.Scope, item.Symbol).Scan(&last); err != nil {
			return stop(err)
		}
		if last != nil && last.AddDate(0, 0, -7).After(start) {
			start = last.AddDate(0, 0, -7)
		}
		history, ok := samples[item.Symbol]
		attempts := 1
		var fetchErr error
		if !ok {
			// Local bootstrap contributes only its validated overlap; recent Yahoo
			// data still has to succeed before this ticker can be called updated.
			var old marketdata.History
			if last == nil && o.Market == "IDX" && o.Bootstrap != nil {
				if window, ok := o.Bootstrap.(interface{ Window() (time.Time, time.Time) }); ok {
					oldFrom, oldTo := window.Window()
					end := minTime(to, oldTo)
					if !from.Before(oldFrom) && from.Before(end) {
						old, _ = o.Bootstrap.DailyHistory(ctx, item, from, end)
						if len(old.Series.Candles) > 0 {
							stamp, _ := time.Parse(time.RFC3339, old.Series.Candles[len(old.Series.Candles)-1].Timestamp)
							start = maxTime(from, stamp.AddDate(0, 0, -7))
						}
					}
				}
			}
			history, attempts, fetchErr = r.fetch(ctx, item, start, to, o.Delay)
			if fetchErr == nil && len(old.Series.Candles) > 0 {
				history = merge(old, history)
			}
		}
		if err = r.Store.Stage(ctx, run, item, history, attempts, fetchErr); err != nil {
			return stop(err)
		}
		status := "success"
		if fetchErr != nil {
			status = sourceCode(fetchErr)
		}
		if o.Progress != nil {
			o.Progress(run, item.Symbol, status)
		}
	}
	run, err = r.Store.Publish(ctx, run)
	if err != nil {
		return stop(err)
	}
	if err = r.Store.Prune(ctx, o.Scope); err != nil {
		return run, err
	}
	return r.Store.Report(ctx, run.ID)
}

func (r *Runner) fetch(ctx context.Context, item universe.Instrument, from, to time.Time, delay time.Duration) (marketdata.History, int, error) {
	for attempt := 1; attempt <= 2; attempt++ {
		h, err := r.Source.DailyHistory(ctx, item, from, to)
		if err == nil {
			err = marketdata.ValidateHistory(h.Series, item.Symbol, from, to)
		}
		if err == nil {
			return h, attempt, nil
		}
		if attempt == 2 || !transient(err) {
			return h, attempt, err
		}
		pause := max(delay, 2*time.Second)
		var response *marketdata.HTTPError
		if errors.As(err, &response) {
			pause = max(pause, response.RetryAfter)
		}
		// Never retry earlier than Retry-After or after the caller's deadline.
		if err = wait(ctx, pause); err != nil {
			return marketdata.History{}, attempt, err
		}
	}
	panic("unreachable")
}

func transient(err error) bool {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, marketdata.ErrInvalidData) {
		return false
	}
	var h *marketdata.HTTPError
	if errors.As(err, &h) {
		return h.Status == 429 || h.Status >= 500
	}
	return errors.Is(err, marketdata.ErrUnavailable)
}
func wait(ctx context.Context, pause time.Duration) error {
	timer := time.NewTimer(pause)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}
func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
func merge(old, new marketdata.History) marketdata.History {
	byStamp := map[string]core.Candle{}
	for _, c := range old.Series.Candles {
		byStamp[c.Timestamp] = c
	}
	for _, c := range new.Series.Candles {
		byStamp[c.Timestamp] = c
	}
	new.Series.Candles = make([]core.Candle, 0, len(byStamp))
	for _, c := range byStamp {
		new.Series.Candles = append(new.Series.Candles, c)
	}
	sort.Slice(new.Series.Candles, func(i, j int) bool { return new.Series.Candles[i].Timestamp < new.Series.Candles[j].Timestamp })
	new.Series.QualityWarnings = append(new.Series.QualityWarnings, "Includes validated local IDX bootstrap; overlap refreshed from Yahoo.")
	for _, warning := range old.Series.QualityWarnings {
		new.Series.QualityWarnings = append(new.Series.QualityWarnings, "Local bootstrap provenance: "+warning)
	}
	new.Series.QualityWarnings = append(new.Series.QualityWarnings, "Skipped-row counters cover the refreshed Yahoo segment; missing local historical dates are not independently verified.")
	return new
}
