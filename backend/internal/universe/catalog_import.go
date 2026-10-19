package universe

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// Catalog imports are operator tooling, never an HTTP/user write capability.
// One parameterized statement is atomic and avoids one round trip per ticker.
const catalogInsert = `insert into signalgen.stock_catalog
  (symbol,provider,provider_symbol,name,exchange,currency)
select symbol,'yahoo_finance',symbol,name,'XIDX','IDR'
from unnest($1::text[],$2::text[]) as imported(symbol,name)
on conflict(symbol) do nothing`

type catalogExecutor interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

var idxSymbol = regexp.MustCompile(`^[A-Z]{4}\.JK$`)

// ValidateCatalogImport permits the full catalog, independently of the number
// of stocks in one user's screening universe. Existing rows are not reactivated,
// renamed or deleted: an import is add-only and safe to repeat.
func ValidateCatalogImport(items []Instrument) error {
	if len(items) < 1 || len(items) > 12000 {
		return fmt.Errorf("catalog import requires 1..12000 instruments")
	}
	seen := make(map[string]bool, len(items))
	for _, item := range items {
		if !idxSymbol.MatchString(item.Symbol) || item.ProviderSymbol != item.Symbol ||
			item.Exchange != "XIDX" || item.Currency != "IDR" || seen[item.Symbol] ||
			strings.TrimSpace(item.Name) == "" || len([]rune(item.Name)) > 300 {
			return fmt.Errorf("invalid or duplicate IDX catalog instrument")
		}
		seen[item.Symbol] = true
	}
	return nil
}

func ImportCatalog(ctx context.Context, db catalogExecutor, items []Instrument) (int64, error) {
	if err := ValidateCatalogImport(items); err != nil {
		return 0, err
	}
	if db == nil {
		return 0, fmt.Errorf("catalog database is required")
	}
	symbols, names := make([]string, len(items)), make([]string, len(items))
	for index, item := range items {
		symbols[index], names[index] = item.Symbol, strings.TrimSpace(item.Name)
	}
	command, err := db.Exec(ctx, catalogInsert, symbols, names)
	return command.RowsAffected(), err
}

// US catalog size is independent of MaxSymbols (ten stocks per screening).
// Importing metadata does not create a universe, grant access or fetch OHLCV.
func ValidateUSCatalogImport(items []Instrument) error {
	if len(items) < 1 || len(items) > 20000 {
		return fmt.Errorf("US catalog import requires 1..20000 instruments")
	}
	seen := make(map[string]bool, len(items))
	for _, item := range items {
		if SymbolMarket(item.Symbol) != "US" || item.ProviderSymbol != item.Symbol ||
			(item.Exchange != "XNAS" && item.Exchange != "XNYS") || item.Currency != "USD" ||
			seen[item.Symbol] || strings.TrimSpace(item.Name) == "" || len([]rune(item.Name)) > 300 {
			return fmt.Errorf("invalid or duplicate US catalog instrument")
		}
		seen[item.Symbol] = true
	}
	return nil
}

const usCatalogInsert = `insert into signalgen.stock_catalog
  (symbol,provider,provider_symbol,name,exchange,currency)
select symbol,'yahoo_finance',symbol,name,exchange,'USD'
from unnest($1::text[],$2::text[],$3::text[]) as imported(symbol,name,exchange)
on conflict(symbol) do nothing`

// ImportUSCatalog preserves existing rows, including inactive listings. This is
// additive ingestion, not a delisting/reactivation policy or a schema migration.
func ImportUSCatalog(ctx context.Context, db catalogExecutor, items []Instrument) (int64, error) {
	if err := ValidateUSCatalogImport(items); err != nil {
		return 0, err
	}
	if db == nil {
		return 0, fmt.Errorf("catalog database is required")
	}
	symbols, names, exchanges := make([]string, len(items)), make([]string, len(items)), make([]string, len(items))
	for index, item := range items {
		symbols[index], names[index], exchanges[index] = item.Symbol, strings.TrimSpace(item.Name), item.Exchange
	}
	command, err := db.Exec(ctx, usCatalogInsert, symbols, names, exchanges)
	return command.RowsAffected(), err
}
