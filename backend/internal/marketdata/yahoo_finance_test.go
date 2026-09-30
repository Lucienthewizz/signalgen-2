package marketdata

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

func TestYahooFinanceNormalizesDailyCandles(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v8/finance/chart/BBCA.JK" || request.URL.Query().Get("interval") != "1d" || request.URL.Query().Get("range") != "3mo" {
			t.Fatalf("request = %s?%s", request.URL.Path, request.URL.RawQuery)
		}
		if request.Header.Get("User-Agent") == "" {
			t.Fatal("User-Agent is required")
		}
		timestamps := make([]int64, 20)
		open, high, low, closeValues := make([]float64, 20), make([]float64, 20), make([]float64, 20), make([]float64, 20)
		volumes := make([]int64, 20)
		for index := range timestamps {
			timestamps[index] = time.Date(2026, 1, index+1, 0, 0, 0, 0, time.UTC).Unix()
			open[index], high[index], low[index], closeValues[index], volumes[index] = 100, 102, 99, 101, 1000
		}
		_ = json.NewEncoder(writer).Encode(map[string]any{"chart": map[string]any{
			"result": []any{map[string]any{"timestamp": timestamps, "indicators": map[string]any{"quote": []any{map[string]any{
				"open": open, "high": high, "low": low, "close": closeValues, "volume": volumes,
			}}}}}, "error": nil,
		}})
	}))
	defer server.Close()
	provider, err := NewYahooFinance(server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	series, err := provider.Daily(context.Background(), []universe.Instrument{{Symbol: "BBCA.JK", ProviderSymbol: "BBCA.JK"}}, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(series) != 1 || len(series[0].Candles) != 20 || series[0].Candles[0].Timestamp != "2026-01-01T00:00:00Z" {
		t.Fatalf("series = %+v", series)
	}
}

func TestYahooFinanceSkipsIncompleteCandles(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(writer).Encode(map[string]any{"chart": map[string]any{
			"result": []any{map[string]any{"timestamp": []int64{1}, "indicators": map[string]any{"quote": []any{map[string]any{
				"open": []any{nil}, "high": []any{nil}, "low": []any{nil}, "close": []any{nil}, "volume": []any{nil},
			}}}}}, "error": nil,
		}})
	}))
	defer server.Close()
	provider, _ := NewYahooFinance(server.URL, server.Client())
	if _, err := provider.Daily(context.Background(), []universe.Instrument{{Symbol: "BBCA.JK", ProviderSymbol: "BBCA.JK"}}, 20); err != ErrInvalidData {
		t.Fatalf("error = %v, want ErrInvalidData", err)
	}
}
