// auditcatalog checks public catalog/provider data, never user rules or grants.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/collection"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	platformdb "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/database"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	market := flag.String("market", "IDX", "IDX or US; uses frozen active application catalog")
	fromText := flag.String("from", "", "inclusive UTC date; default 120 calendar days before to")
	toText := flag.String("to", time.Now().UTC().Format("2006-01-02"), "exclusive UTC date; excludes current day")
	out := flag.String("out", "", "private report directory; same catalog/window resumes")
	budget := flag.Duration("budget", 5*time.Minute, "run budget; 0 runs until complete or provider stop")
	delay := flag.Duration("delay", time.Second, "serial request delay, at least 500ms")
	retry := flag.Bool("retry-failed", false, "retry failed/short histories instead of pending only")
	flag.Parse()
	if *out == "" || (*market != "IDX" && *market != "US") || *budget < 0 || *delay < 500*time.Millisecond || *delay > time.Minute || len(flag.Args()) != 0 {
		return fmt.Errorf("invalid audit options; specify market and private -out")
	}
	to, err := time.Parse("2006-01-02", *toText)
	if err != nil || to.After(time.Now().UTC()) {
		return fmt.Errorf("invalid exclusive end date")
	}
	from := to.AddDate(0, 0, -120)
	if *fromText != "" {
		from, err = time.Parse("2006-01-02", *fromText)
		if err != nil {
			return fmt.Errorf("invalid start date")
		}
	}
	if !from.Before(to) || to.Sub(from) > 366*24*time.Hour {
		return fmt.Errorf("audit window must be 1..366 days")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if *budget > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, *budget)
		defer cancel()
	}
	pool, err := platformdb.OpenPostgres(ctx, os.Getenv("SUPABASE_DB_URL"))
	if err != nil {
		return fmt.Errorf("catalog database unavailable; inspect configuration privately")
	}
	items, err := universe.NewPostgresRepository(pool).Catalog(ctx)
	pool.Close()
	if err != nil {
		return fmt.Errorf("catalog read failed")
	}
	base := os.Getenv("YAHOO_FINANCE_BASE_URL")
	if base == "" {
		base = "https://query1.finance.yahoo.com"
	}
	provider, err := marketdata.NewYahooFinance(base, nil)
	if err != nil {
		return fmt.Errorf("provider configuration invalid")
	}
	report, err := collection.AuditCatalog(ctx, items, *market, *out, from, to, *delay, *retry, provider, func(row collection.AuditEntry) { fmt.Printf("%s %s candles=%d\n", row.Symbol, row.Status, row.Candles) })
	if err != nil {
		return err
	}
	fmt.Printf("market=%s catalog=%d valid=%d insufficient=%d failed=%d pending=%d coverage_complete=%t stop=%s\n", report.Market, report.Counts["total"], report.Counts["valid"], report.Counts["insufficient"], report.Counts["failed"], report.Counts["pending"], report.CoverageComplete, report.StoppedReason)
	if !report.AllUsable {
		return fmt.Errorf("catalog data is not fully usable; inspect report and resume explicitly")
	}
	return nil
}
