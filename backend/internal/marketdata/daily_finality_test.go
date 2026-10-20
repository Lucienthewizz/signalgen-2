package marketdata

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

func utcStamp(value string) time.Time {
	stamp, err := time.Parse(time.RFC3339, value)
	if err != nil {
		panic(err)
	}
	return stamp
}

func TestDailyFinalityAcrossMarketsAndMetadata(t *testing.T) {
	for _, tc := range []struct {
		name, zone, now, candle, start, end string
		closed                              bool
	}{
		{"US open", "America/New_York", "2026-10-19T17:00:00Z", "2026-10-19T13:30:00Z", "2026-10-19T13:30:00Z", "2026-10-19T20:00:00Z", false},
		{"US exactly closed", "America/New_York", "2026-10-19T20:00:00Z", "2026-10-19T13:30:00Z", "2026-10-19T13:30:00Z", "2026-10-19T20:00:00Z", true},
		{"US still same local day after UTC midnight", "America/New_York", "2026-10-20T00:30:00Z", "2026-10-19T13:30:00Z", "2026-10-19T13:30:00Z", "2026-10-19T20:00:00Z", true},
		{"US winter DST offset", "America/New_York", "2026-12-01T20:30:00Z", "2026-12-01T14:30:00Z", "2026-12-01T14:30:00Z", "2026-12-01T21:00:00Z", false},
		{"IDX open", "Asia/Jakarta", "2026-10-19T06:00:00Z", "2026-10-19T02:00:00Z", "2026-10-19T02:00:00Z", "2026-10-19T09:00:00Z", false},
		{"IDX after close", "Asia/Jakarta", "2026-10-19T10:00:00Z", "2026-10-19T02:00:00Z", "2026-10-19T02:00:00Z", "2026-10-19T09:00:00Z", true},
		{"missing session excludes today", "Asia/Jakarta", "2026-10-19T10:00:00Z", "2026-10-19T02:00:00Z", "", "", false},
		{"missing session retains yesterday", "Asia/Jakarta", "2026-10-19T06:00:00Z", "2026-10-18T02:00:00Z", "", "", true},
		{"unknown timezone excludes today", "invalid/zone", "2026-10-19T17:00:00Z", "2026-10-19T13:30:00Z", "", "", false},
		{"stale session cannot confirm today", "America/New_York", "2026-10-19T21:00:00Z", "2026-10-19T13:30:00Z", "2026-10-16T13:30:00Z", "2026-10-16T20:00:00Z", false},
		{"invalid session cannot confirm today", "America/New_York", "2026-10-19T21:00:00Z", "2026-10-19T13:30:00Z", "2026-10-19T20:00:00Z", "2026-10-19T13:30:00Z", false},
		{"future candle rejected", "Asia/Jakarta", "2026-10-19T01:00:00Z", "2026-10-19T02:00:00Z", "2026-10-19T02:00:00Z", "2026-10-19T09:00:00Z", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			meta := yahooMarketMeta{ExchangeTimezoneName: tc.zone}
			if tc.start != "" {
				meta.CurrentTradingPeriod.Regular.Start = utcStamp(tc.start).Unix()
			}
			if tc.end != "" {
				meta.CurrentTradingPeriod.Regular.End = utcStamp(tc.end).Unix()
			}
			if got := newDailyFinality(meta, utcStamp(tc.now)).closed(utcStamp(tc.candle).Unix()); got != tc.closed {
				t.Fatalf("closed=%t want=%t", got, tc.closed)
			}
		})
	}
	meta := yahooMarketMeta{}
	offset := 7 * 3600
	meta.GMTOffset = &offset
	policy := newDailyFinality(meta, utcStamp("2026-10-19T01:00:00Z"))
	if policy.closed(utcStamp("2026-10-18T23:00:00Z").Unix()) {
		t.Fatal("UTC yesterday is still today's market day at GMT+7")
	}
}

// A deterministic fake Yahoo response keeps these tests independent from live
// quotes, weekends and machine time. The last row is the current US market day.
func dailyFixture(t *testing.T, nullIndex int) []byte {
	t.Helper()
	latest := utcStamp("2026-10-19T13:30:00Z")
	stamps := make([]int64, 22)
	open, high, low, closes, volumes := make([]any, 22), make([]any, 22), make([]any, 22), make([]any, 22), make([]any, 22)
	for i := range stamps {
		stamps[i] = latest.AddDate(0, 0, i-21).Unix()
		open[i], high[i], low[i], closes[i], volumes[i] = 100, 102, 99, 101, 1000
	}
	if nullIndex >= 0 {
		open[nullIndex] = nil
	}
	data, err := json.Marshal(map[string]any{"chart": map[string]any{"result": []any{map[string]any{
		"meta":       map[string]any{"exchangeTimezoneName": "America/New_York", "currentTradingPeriod": map[string]any{"regular": map[string]any{"start": latest.Unix(), "end": utcStamp("2026-10-19T20:00:00Z").Unix()}}},
		"timestamp":  stamps,
		"indicators": map[string]any{"quote": []any{map[string]any{"open": open, "high": high, "low": low, "close": closes, "volume": volumes}}},
	}}}})
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestYahooDailyFiltersOpenCandlesAndReportsNullRows(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(dailyFixture(t, 5)) }))
	defer server.Close()
	provider, _ := NewYahooFinance(server.URL, server.Client())
	provider.now = func() time.Time { return utcStamp("2026-10-19T17:00:00Z") }
	instrument := universe.Instrument{Symbol: "AAPL", ProviderSymbol: "AAPL"}
	series, err := provider.Daily(context.Background(), []universe.Instrument{instrument}, 100)
	if err != nil || len(series) != 1 || len(series[0].Candles) != 20 {
		t.Fatalf("series=%+v error=%v", series, err)
	}
	warnings := strings.Join(series[0].QualityWarnings, "\n")
	if !strings.Contains(warnings, "1 null OHLCV") || !strings.Contains(warnings, "1 unfinished or unconfirmed") {
		t.Fatalf("warnings=%s", warnings)
	}
	if series[0].Candles[19].Timestamp != "2026-10-18T13:30:00Z" {
		t.Fatal("unfinished candle reached screening")
	}
	// Filtering happens before truncation: a 20-candle request still gets the
	// 20 usable closes, not 19 plus a partial current-day bar.
	trimmed, err := provider.Daily(context.Background(), []universe.Instrument{instrument}, 20)
	if err != nil || len(trimmed[0].Candles) != 20 {
		t.Fatalf("trim error=%v", err)
	}
	history, err := provider.DailyHistory(context.Background(), instrument, utcStamp("2026-09-01T00:00:00Z"), utcStamp("2026-10-20T00:00:00Z"))
	if err != nil || history.SkippedNullRows != 1 || history.ExcludedOpenRows != 1 || len(history.Series.Candles) != 20 {
		t.Fatalf("history=%+v error=%v", history, err)
	}
	encoded, _ := json.Marshal(history.Series)
	if strings.Contains(string(encoded), "QualityWarnings") || strings.Contains(string(encoded), "null OHLCV") {
		t.Fatal("private transport notes changed OHLCV schema")
	}
}

func TestYahooDailyRejectsInsufficientClosedWarmup(t *testing.T) {
	var body map[string]any
	if err := json.Unmarshal(dailyFixture(t, -1), &body); err != nil {
		t.Fatal(err)
	}
	chart := body["chart"].(map[string]any)["result"].([]any)[0].(map[string]any)
	chart["timestamp"] = chart["timestamp"].([]any)[2:] // 20 rows, only 19 closed.
	quote := chart["indicators"].(map[string]any)["quote"].([]any)[0].(map[string]any)
	for key, value := range quote {
		quote[key] = value.([]any)[2:]
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _ = json.NewEncoder(w).Encode(body) }))
	defer server.Close()
	provider, _ := NewYahooFinance(server.URL, server.Client())
	provider.now = func() time.Time { return utcStamp("2026-10-19T17:00:00Z") }
	if _, err := provider.Daily(context.Background(), []universe.Instrument{{Symbol: "AAPL", ProviderSymbol: "AAPL"}}, 20); !errors.Is(err, ErrInvalidData) {
		t.Fatalf("error=%v", err)
	}
}
