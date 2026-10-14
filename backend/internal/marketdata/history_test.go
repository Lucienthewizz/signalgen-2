package marketdata

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

func TestHistoryUsesExactWindowAndRetainsShortListing(t *testing.T) {
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	to := from.Add(72 * time.Hour)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("period1") != strconv.FormatInt(from.Unix(), 10) || r.URL.Query().Get("period2") != strconv.FormatInt(to.Unix(), 10) || r.URL.Query().Get("range") != "" || r.URL.Query().Get("interval") != "1d" {
			t.Errorf("query: %s", r.URL.RawQuery)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"chart": map[string]any{"result": []any{map[string]any{"timestamp": []int64{from.Unix() - 1, from.Unix(), from.Unix() + 86400, to.Unix()}, "indicators": map[string]any{"quote": []any{map[string]any{"open": []any{100, 100, nil, 100}, "high": []any{102, 102, nil, 102}, "low": []any{99, 99, nil, 99}, "close": []any{101, 101, nil, 101}, "volume": []any{10, 10, nil, 10}}}}}}}})
	}))
	defer server.Close()
	provider, _ := NewYahooFinance(server.URL, server.Client())
	result, err := provider.DailyHistory(context.Background(), universe.Instrument{Symbol: "NEWB.JK", ProviderSymbol: "NEWB.JK"}, from, to)
	if err != nil || len(result.Series.Candles) != 1 || result.SkippedNullRows != 1 {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}

func TestHistoryRejectsCorruptAndDuplicateCandles(t *testing.T) {
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	to := from.Add(24 * time.Hour)
	valid := core.Candle{Timestamp: from.Format(time.RFC3339), Open: 100, High: 102, Low: 99, Close: 101, Volume: 10}
	for _, kind := range []string{"duplicate", "bad-price", "wrong-symbol", "exclusive-end", "empty"} {
		t.Run(kind, func(t *testing.T) {
			series := Series{Symbol: "BBCA.JK", Timezone: "UTC", Candles: []core.Candle{valid}}
			switch kind {
			case "duplicate":
				series.Candles = append(series.Candles, valid)
			case "bad-price":
				series.Candles[0].Close = 500
			case "wrong-symbol":
				series.Symbol = "OTHER.JK"
			case "exclusive-end":
				series.Candles[0].Timestamp = to.Format(time.RFC3339)
			case "empty":
				series.Candles = nil
			}
			if err := ValidateHistory(series, "BBCA.JK", from, to); !errors.Is(err, ErrInvalidData) {
				t.Fatalf("got %v", err)
			}
		})
	}
}

func TestHistoryRateLimitExposesStatusWithoutRetryingLongWait(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Retry-After", "60")
		w.WriteHeader(429)
	}))
	defer server.Close()
	provider, _ := NewYahooFinance(server.URL, server.Client())
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	_, err := provider.DailyHistory(context.Background(), universe.Instrument{Symbol: "BBCA.JK", ProviderSymbol: "BBCA.JK"}, from, from.Add(24*time.Hour))
	var providerError *HTTPError
	if !errors.As(err, &providerError) || !errors.Is(err, ErrUnavailable) || providerError.Status != 429 || calls != 1 {
		t.Fatalf("err=%v calls=%d", err, calls)
	}
}
