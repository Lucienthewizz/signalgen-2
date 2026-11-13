package collection

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// ScheduleOptions configures a serial, fixed-delay collector, not a catch-up queue.
type ScheduleOptions struct {
	CatalogPath, SourceURL, Directory              string
	Every, RetryDelay, RunTimeout, InstrumentDelay time.Duration
	Keep                                           int
	RetirementGrace                                time.Duration
	RetentionDryRun                                bool
}

type ScheduledResult struct {
	StartedAt, From, To time.Time
	Report              Report
	Err                 error
}

func (o ScheduleOptions) Validate() error {
	if o.CatalogPath == "" || o.Directory == "" || !strings.HasPrefix(o.SourceURL, "https://") {
		return fmt.Errorf("scheduler requires a catalog, output store and HTTPS provenance")
	}
	if o.Every < time.Minute || o.Every > 7*24*time.Hour || o.RetryDelay < time.Minute || o.RetryDelay > 24*time.Hour || o.RunTimeout <= 0 || o.RunTimeout > 6*time.Hour {
		return fmt.Errorf("schedule every must be 1m..168h, retry 1m..24h and run timeout positive..6h")
	}
	if o.InstrumentDelay < 0 || o.InstrumentDelay > time.Minute || o.Keep < 2 || o.RetirementGrace < 24*time.Hour {
		return fmt.Errorf("invalid scheduler pacing or retention")
	}
	return nil
}

// ClosedDayBoundary excludes today's date until the conservative 18:00 WIB cutoff.
func ClosedDayBoundary(now time.Time, location *time.Location) time.Time {
	local := now.In(location)
	boundary := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
	if local.Hour() >= 18 {
		boundary = boundary.AddDate(0, 0, 1)
	}
	return boundary
}

// RunScheduler stops on cancellation. Per-run errors are reported and retried
// after a bounded delay; the provider must honor context cancellation.
func RunScheduler(ctx context.Context, options ScheduleOptions, provider HistoryProvider, observe func(ScheduledResult)) error {
	return runScheduler(ctx, options, provider, observe, time.Now, waitSchedule)
}
func waitSchedule(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
func runScheduler(ctx context.Context, o ScheduleOptions, provider HistoryProvider, observe func(ScheduledResult), now func() time.Time, wait func(context.Context, time.Duration) error) error {
	if err := o.Validate(); err != nil {
		return err
	}
	if provider == nil {
		return fmt.Errorf("scheduler provider is required")
	}
	jakarta, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		return err
	}
	for {
		if ctx.Err() != nil {
			return nil
		}
		result := ScheduledResult{StartedAt: now()}
		result.To = ClosedDayBoundary(result.StartedAt, jakarta)
		result.From = result.To.AddDate(-5, 0, 0)
		runCtx, cancel := context.WithTimeout(ctx, o.RunTimeout)
		catalog, e := ReadCatalog(o.CatalogPath, o.SourceURL, result.StartedAt)
		if e == nil {
			result.Report, e = Sync(runCtx, catalog, provider, Options{Directory: o.Directory, From: result.From, To: result.To, Interval: o.InstrumentDelay}, 7, nil)
			if e == nil {
				_, e = Prune(runCtx, o.Directory, RetentionOptions{Keep: o.Keep, MinAge: o.RetirementGrace, DryRun: o.RetentionDryRun})
			}
		}
		cancel()
		result.Err = e
		if observe != nil {
			observe(result)
		}
		if ctx.Err() != nil {
			return nil
		}
		delay := o.Every
		if e != nil {
			delay = o.RetryDelay
		}
		if err := wait(ctx, delay); err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
	}
}
