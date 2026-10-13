// collectidx is an explicit offline acquisition job. It never connects to
// Supabase, changes user rules, raises API limits, or starts an HTTP server.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/collection"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	jakarta, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		return err
	}
	now := time.Now()
	latestEnd := closedDayBoundary(now, jakarta)
	catalogPath := flag.String("catalog", "", "official IDX .xlsx or UTF-8 CSV")
	source := flag.String("source-url", "https://www.idx.co.id/id/data-pasar/data-saham/daftar-saham/", "source provenance (not fetched by this job)")
	asOf := flag.String("as-of", latestEnd.Format("2006-01-02"), "exclusive end date in Asia/Jakarta; excludes this entire date")
	fromDate := flag.String("from", "", "inclusive date, defaults to one year before as-of")
	output := flag.String("out", "data/idx", "private backend output directory")
	interval := flag.Duration("delay", time.Second, "pause between instruments, minimum 500ms")
	limit := flag.Int("limit", 0, "attempt at most N instruments; 0 visits whole catalog")
	retryFailed := flag.Bool("retry-failed", false, "retry previously failed rows")
	refresh := flag.Bool("refresh", false, "explicitly refetch saved successes for the same window")
	validateOnly := flag.Bool("validate-only", false, "validate/catalog count without making provider requests")
	flag.Parse()
	if *catalogPath == "" {
		return fmt.Errorf("-catalog is required; no hardcoded list is presented as complete IDX")
	}
	if *interval < 500*time.Millisecond || *interval > time.Minute || *limit < 0 {
		return fmt.Errorf("delay must be 500ms..1m and limit must be nonnegative")
	}
	to, err := time.ParseInLocation("2006-01-02", *asOf, jakarta)
	if err != nil {
		return fmt.Errorf("invalid as-of date")
	}
	if to.After(latestEnd) {
		return fmt.Errorf("as-of exceeds closed-day cutoff; current date is eligible only after 18:00 WIB")
	}
	from := to.AddDate(-1, 0, 0)
	if *fromDate != "" {
		from, err = time.ParseInLocation("2006-01-02", *fromDate, jakarta)
		if err != nil {
			return fmt.Errorf("invalid from date")
		}
	}
	if !from.Before(to) || to.Sub(from) > 6*366*24*time.Hour {
		return fmt.Errorf("window must be positive and at most six years")
	}
	if !strings.HasPrefix(*source, "https://") {
		return fmt.Errorf("source-url must identify an HTTPS source")
	}
	catalog, err := collection.ReadCatalog(*catalogPath, *source, now)
	if err != nil {
		return err
	}
	fmt.Printf("Catalog: %d unique tickers; daily window [%s, %s) Asia/Jakarta\n", len(catalog.Items), from.Format("2006-01-02"), to.Format("2006-01-02"))
	if *validateOnly {
		fmt.Println("Validation only; no price download, no database write.")
		return nil
	}
	baseURL := os.Getenv("YAHOO_FINANCE_BASE_URL")
	if baseURL == "" {
		baseURL = "https://query1.finance.yahoo.com"
	}
	if !strings.HasPrefix(baseURL, "https://") {
		return fmt.Errorf("live Yahoo provider must use HTTPS")
	}
	provider, err := marketdata.NewYahooFinance(baseURL, nil)
	if err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	report, err := collection.Run(ctx, catalog, provider, collection.Options{Directory: *output, From: from, To: to, Interval: *interval, Limit: *limit, RetryFailed: *retryFailed, Refresh: *refresh}, func(entry collection.Entry) {
		fmt.Printf("%s: %s; candles=%d; %s\n", entry.Code, entry.Status, entry.Candles, entry.Error)
	})
	if err != nil && len(report.Entries) == 0 {
		return err
	}
	counts := map[string]int{"success": 0, "failed": 0, "pending": 0}
	for _, entry := range report.Entries {
		counts[entry.Status]++
	}
	fmt.Printf("Saved report: %s; success=%d failed=%d pending=%d; stop=%s\n", filepath.Join(*output, "report.json"), counts["success"], counts["failed"], counts["pending"], report.StoppedReason)
	if err != nil {
		return err
	}
	if counts["failed"] > 0 || counts["pending"] > 0 {
		return fmt.Errorf("collection is incomplete; review report and resume/retry explicitly")
	}
	return nil
}

// A conservative wall-clock cutoff excludes the in-progress local trading day.
// This is not an exchange-calendar or auction-status service: 18:00 WIB gives
// a buffer after ordinary IDX sessions; provider corrections remain possible.
func closedDayBoundary(now time.Time, location *time.Location) time.Time {
	local := now.In(location)
	boundary := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
	if local.Hour() >= 18 {
		boundary = boundary.AddDate(0, 0, 1)
	}
	return boundary
}
