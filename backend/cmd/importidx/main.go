// importidx adds official IDX catalog metadata, not OHLCV, to the existing DB.
// Dry-run is the default. It never uses the API runtime's database credentials.
package main

import (
	"context"
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
	flags := flag.NewFlagSet("importidx", flag.ContinueOnError)
	flags.SetOutput(stderr)
	path := flags.String("catalog", "", "official IDX XLSX or CSV export")
	apply := flags.Bool("apply", false, "add missing catalog rows to the configured admin database")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if *path == "" || len(flags.Args()) != 0 {
		fmt.Fprintln(stderr, "provide -catalog; -apply is optional and explicitly enables database writes")
		return 2
	}
	catalog, err := collection.ReadCatalog(*path, "https://www.idx.co.id/id/data-pasar/data-saham/daftar-saham/", time.Now())
	if err != nil {
		fmt.Fprintln(stderr, "catalog validation failed")
		return 1
	}
	items := make([]universe.Instrument, len(catalog.Items))
	for index, item := range catalog.Items {
		items[index] = universe.Instrument{Symbol: item.ProviderSymbol, ProviderSymbol: item.ProviderSymbol, Name: item.Name, Exchange: "XIDX", Currency: "IDR"}
	}
	if err := universe.ValidateCatalogImport(items); err != nil {
		fmt.Fprintln(stderr, "catalog instrument validation failed")
		return 1
	}
	fmt.Fprintf(stdout, "Validated %d IDX instruments; source SHA-256 %s\n", len(items), catalog.SourceSHA256)
	if !*apply {
		fmt.Fprintln(stdout, "Dry-run: no database connection or write")
		return 0
	}
	url := getenv("SUPABASE_ADMIN_DB_URL")
	if url == "" {
		fmt.Fprintln(stderr, "SUPABASE_ADMIN_DB_URL is required for -apply; runtime credentials are not used")
		return 2
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := platformdb.OpenPostgres(ctx, url)
	if err != nil {
		fmt.Fprintln(stderr, "catalog database connection failed; check admin configuration privately")
		return 1
	}
	defer pool.Close()
	inserted, err := universe.ImportCatalog(ctx, pool, items)
	if err != nil {
		fmt.Fprintln(stderr, "catalog import failed; no partial import statement was committed")
		return 1
	}
	fmt.Fprintf(stdout, "Inserted %d; preserved %d existing catalog records. No schema, ownership or OHLCV changes.\n", inserted, int64(len(items))-inserted)
	return 0
}
