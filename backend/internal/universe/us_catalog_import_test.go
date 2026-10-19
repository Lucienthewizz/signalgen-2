package universe

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

type usImportExecutor struct {
	calls int
	args  []any
}

func (fake *usImportExecutor) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	fake.calls++
	fake.args = args
	if query != usCatalogInsert || !strings.Contains(query, "on conflict(symbol) do nothing") {
		return pgconn.CommandTag{}, errors.New("unexpected SQL")
	}
	return pgconn.NewCommandTag("INSERT 0 2"), nil
}

func TestUSCatalogImportIsParameterizedAddOnlyAndIndependentOfUniverseLimit(t *testing.T) {
	items := []Instrument{
		{Symbol: "AAPL", ProviderSymbol: "AAPL", Name: "Apple 'quoted' name", Exchange: "XNAS", Currency: "USD"},
		{Symbol: "BRK-B", ProviderSymbol: "BRK-B", Name: "Berkshire", Exchange: "XNYS", Currency: "USD"},
	}
	fake := &usImportExecutor{}
	count, err := ImportUSCatalog(context.Background(), fake, items)
	if err != nil || count != 2 || fake.calls != 1 || fake.args[1].([]string)[0] != items[0].Name || fake.args[2].([]string)[1] != "XNYS" {
		t.Fatalf("parameterized import failed: %v", err)
	}
	for _, mutation := range []string{"duplicate", "symbol", "provider", "currency", "exchange", "name"} {
		copy := items[0]
		switch mutation {
		case "symbol":
			copy.Symbol = "../AAPL"
		case "provider":
			copy.ProviderSymbol = "AAPL.JK"
		case "currency":
			copy.Currency = "IDR"
		case "exchange":
			copy.Exchange = "XIDX"
		case "name":
			copy.Name = " "
		}
		bad := []Instrument{copy}
		if mutation == "duplicate" {
			bad = append(bad, copy)
		}
		if _, err := ImportUSCatalog(context.Background(), fake, bad); err == nil || fake.calls != 1 {
			t.Fatalf("invalid %s reached DB", mutation)
		}
	}
	if _, err := ImportUSCatalog(context.Background(), nil, items); err == nil {
		t.Fatal("nil DB accepted")
	}
	if MaxSymbols != 10 {
		t.Fatal("screening limit changed")
	}
}
