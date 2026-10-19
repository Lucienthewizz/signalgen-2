package marketdata

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

// Explicit network smoke test only; normal CI/unit tests never fetch live prices.
func TestYahooUSLive(t *testing.T) {
	if os.Getenv("SIGNALGEN_TEST_YAHOO_LIVE") != "1" {
		t.Skip("opt-in live Yahoo check")
	}
	provider, err := NewYahooFinance("https://query1.finance.yahoo.com", &http.Client{Timeout: 15 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	items := []universe.Instrument{
		{Symbol: "AAPL", ProviderSymbol: "AAPL", Exchange: "XNAS", Currency: "USD"},
		{Symbol: "MSFT", ProviderSymbol: "MSFT", Exchange: "XNAS", Currency: "USD"},
		{Symbol: "BRK-B", ProviderSymbol: "BRK-B", Exchange: "XNYS", Currency: "USD"},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	series, err := provider.Daily(ctx, items, 100)
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateSeries(series, items, 100); err != nil {
		t.Fatal(err)
	}
	for _, item := range series {
		t.Logf("%s: %d daily candles, %s to %s (UTC)", item.Symbol, len(item.Candles), item.Candles[0].Timestamp, item.Candles[len(item.Candles)-1].Timestamp)
	}
}
