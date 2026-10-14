package universe

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

type importExecutor struct {
	calls int
	args  []any
	err   error
}

func (fake *importExecutor) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	fake.calls++
	fake.args = args
	if query != catalogInsert || !strings.Contains(query, "on conflict(symbol) do nothing") {
		return pgconn.CommandTag{}, errors.New("unexpected import query")
	}
	return pgconn.NewCommandTag("INSERT 0 1"), fake.err
}

func TestCatalogImportValidatesBeforeOneParameterizedWrite(t *testing.T) {
	item := Instrument{Symbol: "ASII.JK", ProviderSymbol: "ASII.JK", Name: "Astra 'quoted' name", Exchange: "XIDX", Currency: "IDR"}
	fake := &importExecutor{}
	count, err := ImportCatalog(context.Background(), fake, []Instrument{item})
	if err != nil || count != 1 || fake.calls != 1 || fake.args[1].([]string)[0] != item.Name {
		t.Fatalf("count=%d calls=%d error=%v", count, fake.calls, err)
	}
	for _, mutation := range []string{"duplicate", "symbol", "provider", "name", "exchange", "currency"} {
		copy := item
		switch mutation {
		case "symbol":
			copy.Symbol = "../ASII"
		case "provider":
			copy.ProviderSymbol = "OTHER.JK"
		case "name":
			copy.Name = " "
		case "exchange":
			copy.Exchange = "OTHER"
		case "currency":
			copy.Currency = "USD"
		}
		items := []Instrument{copy}
		if mutation == "duplicate" {
			items = append(items, copy)
		}
		before := fake.calls
		if _, err := ImportCatalog(context.Background(), fake, items); err == nil || fake.calls != before {
			t.Fatalf("invalid %s reached database", mutation)
		}
	}
	fake.err = errors.New("database failed")
	if _, err := ImportCatalog(context.Background(), fake, []Instrument{item}); !errors.Is(err, fake.err) {
		t.Fatal("database error lost")
	}
}
