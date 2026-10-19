// importus imports Nasdaq/NYSE equity metadata, never historical price data.
// Default is a validated dry-run. Only -apply opens the admin DB connection.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/collection"
	platformdb "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/database"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

func main() { os.Exit(run(os.Args[1:], os.Getenv, os.Stdout, os.Stderr)) }

func run(args []string, getenv func(string) string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("importus", flag.ContinueOnError)
	flags.SetOutput(stderr)
	nasdaq := flags.String("nasdaq", "", "local nasdaqlisted.txt; omitted downloads official HTTPS source")
	nyse := flags.String("nyse", "", "local otherlisted.txt; omitted downloads official HTTPS source")
	report := flags.String("report", "", "optional JSON metadata/provenance report (no credentials)")
	apply := flags.Bool("apply", false, "add missing rows using SUPABASE_ADMIN_DB_URL")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if len(flags.Args()) != 0 {
		fmt.Fprintln(stderr, "unexpected positional arguments")
		return 2
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	catalog, err := collection.LoadUSCatalog(ctx, *nasdaq, *nyse, time.Now())
	if err != nil {
		fmt.Fprintln(stderr, "US directory validation failed:", err)
		return 1
	}
	if *report != "" {
		data, err := json.MarshalIndent(catalog, "", "  ")
		if err != nil {
			fmt.Fprintln(stderr, "report encoding failed")
			return 1
		}
		// Refuse to overwrite an export, source file, or existing user report.
		file, err := os.OpenFile(*report, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			fmt.Fprintln(stderr, "report path must be a new writable file")
			return 1
		}
		_, writeErr := file.Write(append(data, '\n'))
		closeErr := file.Close()
		if writeErr != nil || closeErr != nil {
			fmt.Fprintln(stderr, "report write failed")
			return 1
		}
	}
	fmt.Fprintf(stdout, "Validated %d US instruments (Nasdaq %d, NYSE %d). Screening limit: %d.\n", len(catalog.Items), catalog.ByExchange["XNAS"], catalog.ByExchange["XNYS"], universe.MaxSymbols)
	for _, source := range catalog.Sources {
		fmt.Fprintf(stdout, "%s | creation %s | SHA-256 %s | accepted %d/%d | skipped %v\n", source.URL, source.CreationTime, source.SHA256, source.Accepted, source.Rows, source.Skipped)
	}
	if !*apply {
		fmt.Fprintln(stdout, "Dry-run: no database connection or price download")
		return 0
	}
	url := getenv("SUPABASE_ADMIN_DB_URL")
	if url == "" {
		fmt.Fprintln(stderr, "SUPABASE_ADMIN_DB_URL required; no runtime credential fallback")
		return 2
	}
	pool, err := platformdb.OpenPostgres(ctx, url)
	if err != nil {
		fmt.Fprintln(stderr, "admin database connection failed; check configuration privately")
		return 1
	}
	defer pool.Close()
	inserted, err := universe.ImportUSCatalog(ctx, pool, catalog.Items)
	if err != nil {
		fmt.Fprintln(stderr, "catalog import failed; statement rolled back")
		return 1
	}
	fmt.Fprintf(stdout, "Inserted %d; preserved %d existing rows. No ownership, schema, RLS or OHLCV changes.\n", inserted, int64(len(catalog.Items))-inserted)
	return 0
}
