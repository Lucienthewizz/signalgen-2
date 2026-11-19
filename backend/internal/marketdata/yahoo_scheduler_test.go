package marketdata

import (
	"context"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestSchedulerOwnsYahooRetries(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(503) }))
	defer server.Close()
	source, err := NewYahooFinance(server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	item := universe.Instrument{Symbol: "BBCA.JK", ProviderSymbol: "BBCA.JK", Exchange: "XIDX", Currency: "IDR"}
	from := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	if _, err = source.WithoutRetry().DailyHistory(context.Background(), item, from, from.AddDate(0, 3, 0)); err == nil {
		t.Fatal("expected provider failure")
	}
	if calls.Load() != 1 {
		t.Fatal("nested provider retry escaped scheduler pacing", calls.Load())
	}
}
