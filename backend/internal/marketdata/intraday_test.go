package marketdata

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

func intradayFixture(start time.Time, count int, interval string, duration time.Duration) []byte {
	stamps := make([]int64, count)
	values, high, low, volume := make([]float64, count), make([]float64, count), make([]float64, count), make([]int64, count)
	for i := range stamps {
		stamps[i] = start.Add(time.Duration(i) * duration).Unix()
		if duration == time.Hour {
			stamps[i] = start.AddDate(0, 0, i/7).Add(time.Duration(i%7) * duration).Unix()
		}
		values[i] = 100
		high[i] = 102
		low[i] = 99
		volume[i] = 1000
	}
	sessions := [][]tradingSession{}
	for day := 0; day <= count/7; day++ {
		sessionStart := start.AddDate(0, 0, day)
		sessions = append(sessions, []tradingSession{{Start: sessionStart.Unix(), End: sessionStart.Add(7 * time.Hour).Unix()}})
	}
	data, _ := json.Marshal(map[string]any{"chart": map[string]any{"result": []any{map[string]any{
		"meta":      map[string]any{"dataGranularity": interval, "exchangeTimezoneName": "America/New_York", "tradingPeriods": sessions},
		"timestamp": stamps, "indicators": map[string]any{"quote": []any{map[string]any{"open": values, "high": high, "low": low, "close": values, "volume": volume}}},
	}}}})
	return data
}

func TestIntradayExpandsCalendarLookbackOnlyForInsufficientCandles(t *testing.T) {
	// Monday just after the opening: the prior three calendar days include the
	// weekend. A seven-day window may legitimately recover Friday's warmup.
	now := utcStamp("2026-10-19T13:35:00Z")
	friday := utcStamp("2026-10-16T13:30:00Z")
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		days := 3
		if calls == 2 {
			days = 7
		}
		q := r.URL.Query()
		if q.Get("range") != "" || q.Get("interval") != "5m" || q.Get("includePrePost") != "false" || q.Get("period1") != strconv.FormatInt(now.AddDate(0, 0, -days).Unix(), 10) || q.Get("period2") != strconv.FormatInt(now.Unix(), 10) {
			t.Errorf("unexpected bounded query: %s", r.URL.RawQuery)
		}
		count := 5
		if calls == 2 {
			count = 30
		}
		_, _ = w.Write(intradayFixture(friday, count, "5m", 5*time.Minute))
	}))
	defer server.Close()
	provider, _ := NewYahooFinance(server.URL, server.Client())
	provider.now = func() time.Time { return now }
	items, err := provider.Candles(context.Background(), []universe.Instrument{{Symbol: "AAPL", ProviderSymbol: "AAPL"}}, 100, "5m")
	if err != nil || calls != 2 || len(items) != 1 || len(items[0].Candles) != 30 {
		t.Fatalf("calls=%d data=%+v err=%v", calls, items, err)
	}
	if items[0].RequestedFrom != now.AddDate(0, 0, -7).Format(time.RFC3339) {
		t.Fatal("expanded range was not disclosed")
	}
}

func TestIntradayIntervalsTrimAndRejectDailyFallback(t *testing.T) {
	for _, tf := range []string{"1m", "5m", "15m", "1h"} {
		t.Run(tf, func(t *testing.T) {
			policy, _ := Policy(tf)
			start := utcStamp("2026-10-19T13:30:00Z")
			// Hourly warmup crosses several regular sessions; short bars fit in one.
			duration := policy.Duration
			count := 25
			if tf == "1m" {
				count = 125
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write(intradayFixture(start, count, tf, duration))
			}))
			defer server.Close()
			provider, _ := NewYahooFinance(server.URL, server.Client())
			provider.now = func() time.Time {
				if tf == "1h" {
					return start.Add(6 * 24 * time.Hour)
				}
				return start.Add(48 * time.Hour)
			}
			items, err := provider.Candles(context.Background(), []universe.Instrument{{Symbol: "AAPL", ProviderSymbol: "AAPL"}}, 100, tf)
			if err != nil || len(items[0].Candles) != min(count, 100) {
				t.Fatalf("interval=%s err=%v", tf, err)
			}
		})
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(intradayFixture(utcStamp("2026-10-19T13:30:00Z"), 30, "1d", time.Minute))
	}))
	defer server.Close()
	provider, _ := NewYahooFinance(server.URL, server.Client())
	if _, err := provider.Candles(context.Background(), []universe.Instrument{{Symbol: "AAPL", ProviderSymbol: "AAPL"}}, 100, "1m"); !errors.Is(err, ErrIntervalUnavailable) {
		t.Fatalf("daily fallback accepted: %v", err)
	}
}

func TestInsufficientHistoryStopsAtTheSupportedLookback(t *testing.T) {
	for _, tf := range []string{"1m", "5m", "15m", "1h"} {
		t.Run(tf, func(t *testing.T) {
			policy, _ := Policy(tf)
			start := utcStamp("2026-10-19T13:30:00Z")
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				_, _ = w.Write(intradayFixture(start, 5, tf, policy.Duration))
			}))
			defer server.Close()
			provider, _ := NewYahooFinance(server.URL, server.Client())
			provider.now = func() time.Time { return start.Add(24 * time.Hour) }
			_, err := provider.Candles(context.Background(), []universe.Instrument{{Symbol: "AAPL", ProviderSymbol: "AAPL"}}, 100, tf)
			if !errors.Is(err, ErrInsufficientCandles) || calls != len(policy.LookbackDays) {
				t.Fatalf("unbounded or incorrect fallback: %s calls=%d err=%v", tf, calls, err)
			}
		})
	}
}

func TestIntradayFinalityUsesSessionEndBufferAndDST(t *testing.T) {
	for _, start := range []string{"2026-10-19T13:30:00Z", "2026-11-02T14:30:00Z"} {
		stamp := utcStamp(start)
		sessions := []tradingSession{{Start: stamp.Unix(), End: stamp.Add(30 * time.Minute).Unix()}}
		if closedIntraday(stamp, stamp.Add(5*time.Minute+9*time.Second), 5*time.Minute, sessions) {
			t.Fatal("unclosed/buffer candle accepted")
		}
		if !closedIntraday(stamp, stamp.Add(5*time.Minute+10*time.Second), 5*time.Minute, sessions) {
			t.Fatal("closed candle rejected")
		}
		if closedIntraday(stamp.Add(-time.Minute), stamp.Add(time.Hour), 5*time.Minute, sessions) {
			t.Fatal("extended-hours candle accepted")
		}
		if !closedIntraday(stamp.Add(25*time.Minute), stamp.Add(30*time.Minute+10*time.Second), time.Hour, sessions) {
			t.Fatal("short final session bar rejected")
		}
	}
	// An IDX lunchtime gap is outside both regular-session segments.
	start := utcStamp("2026-10-20T02:00:00Z")
	sessions := []tradingSession{{start.Unix(), start.Add(3 * time.Hour).Unix()}, {start.Add(4 * time.Hour).Unix(), start.Add(7 * time.Hour).Unix()}}
	if closedIntraday(start.Add(210*time.Minute), start.Add(8*time.Hour), 5*time.Minute, sessions) {
		t.Fatal("IDX lunch bar accepted")
	}
}

func TestIntradayNetworkFailureDoesNotExpandRange(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(503) }))
	defer server.Close()
	provider, _ := NewYahooFinance(server.URL, server.Client())
	_, err := provider.Candles(context.Background(), []universe.Instrument{{Symbol: "AAPL", ProviderSymbol: "AAPL"}}, 100, "1m")
	if err == nil || calls.Load() != 2 {
		t.Fatalf("network failure triggered lookback expansion: calls=%d err=%v", calls.Load(), err)
	}
}
