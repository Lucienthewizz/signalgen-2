package marketdata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

func TestDailyProviderRejectsMismatchedSymbolCurrencyAndInterval(t *testing.T) {
	for _, field := range []string{"symbol", "currency", "dataGranularity"} {
		t.Run(field, func(t *testing.T) {
			var payload map[string]any
			_ = json.Unmarshal(dailyFixture(t, -1), &payload)
			chart := payload["chart"].(map[string]any)["result"].([]any)[0].(map[string]any)
			meta := chart["meta"].(map[string]any)
			meta[field] = map[string]string{"symbol": "OTHER", "currency": "IDR", "dataGranularity": "1wk"}[field]
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _ = json.NewEncoder(w).Encode(payload) }))
			defer server.Close()
			provider, _ := NewYahooFinance(server.URL, server.Client())
			instrument := universe.Instrument{Symbol: "AAPL", ProviderSymbol: "AAPL", Currency: "USD"}
			_, err := provider.Daily(context.Background(), []universe.Instrument{instrument}, 100)
			_, historyErr := provider.DailyHistory(context.Background(), instrument, utcStamp("2026-09-01T00:00:00Z"), utcStamp("2026-11-01T00:00:00Z"))
			expected := ErrInvalidData
			if field == "dataGranularity" {
				expected = ErrIntervalUnavailable
			}
			if !errors.Is(err, expected) || !errors.Is(historyErr, expected) {
				t.Fatal("mismatched provider metadata was silently accepted")
			}
		})
	}
}

func TestHistoryDisclosesCorporateActionsAndLongGapsWithoutChangingPrices(t *testing.T) {
	var payload map[string]any
	_ = json.Unmarshal(dailyFixture(t, -1), &payload)
	chart := payload["chart"].(map[string]any)["result"].([]any)[0].(map[string]any)
	stamp := utcStamp("2026-10-01T13:30:00Z").Unix()
	chart["events"] = map[string]any{"splits": map[string]any{"fixture": map[string]any{"date": stamp}}, "dividends": map[string]any{"fixture": map[string]any{"date": stamp}}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("events") != "div,splits" {
			t.Error("corporate-action evidence not requested")
		}
		_ = json.NewEncoder(w).Encode(payload)
	}))
	defer server.Close()
	provider, _ := NewYahooFinance(server.URL, server.Client())
	provider.now = func() time.Time { return utcStamp("2026-10-21T00:00:00Z") }
	history, err := provider.DailyHistory(context.Background(), universe.Instrument{Symbol: "AAPL", ProviderSymbol: "AAPL"}, utcStamp("2026-09-01T00:00:00Z"), utcStamp("2026-11-01T00:00:00Z"))
	if err != nil {
		t.Fatal(err)
	}
	if history.Series.Candles[0].Close != 101 || !strings.Contains(strings.Join(history.Series.QualityWarnings, " "), "1 split(s) and 1 dividend(s)") {
		t.Fatal("action evidence missing or prices silently adjusted")
	}
	series := history.Series.Candles
	boundary := yahooEvents{}
	_ = json.Unmarshal([]byte(fmt.Sprintf(`{"splits":{"first":{"date":%d}}}`, utcStamp(series[0].Timestamp[:10]+"T00:00:00Z").Unix())), &boundary)
	if !strings.Contains(strings.Join(historicalQualityWarnings("AAPL", series, boundary), " "), "1 split(s)") {
		t.Fatal("event at midnight on first candle date was lost")
	}
	series[1].Timestamp = utcStamp("2026-10-10T13:30:00Z").Format(time.RFC3339)
	warnings := historicalQualityWarnings("AAPL", series[:2], yahooEvents{})
	if len(warnings) != 1 || !strings.Contains(warnings[0], "coverage requires review") {
		t.Fatal("long gap was silently treated as complete trading history")
	}
}
