package collection

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type fakeHistory struct {
	calls   int
	failure error
}

func (provider *fakeHistory) DailyHistory(ctx context.Context, item universe.Instrument, from, to time.Time) (marketdata.History, error) {
	provider.calls++
	if provider.failure != nil {
		return marketdata.History{}, provider.failure
	}
	return marketdata.History{Series: marketdata.Series{Symbol: item.Symbol, Timezone: "UTC", Candles: []core.Candle{{Timestamp: from.Format(time.RFC3339), Open: 100, High: 102, Low: 99, Close: 101, Volume: 10}}}}, nil
}

func testRunOptions(t *testing.T) (Catalog, Options) {
	t.Helper()
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	return Catalog{SourceURL: "https://www.idx.co.id/", SourceSHA256: "test-source", Items: []Instrument{{Code: "BBCA", ProviderSymbol: "BBCA.JK", ListingDate: "2000-05-31"}, {Code: "TLKM", ProviderSymbol: "TLKM.JK", ListingDate: "1995-11-14"}}}, Options{Directory: t.TempDir(), From: from, To: from.Add(24 * time.Hour)}
}

func TestCollectionLimitResumeAndCorruption(t *testing.T) {
	catalog, options := testRunOptions(t)
	provider := &fakeHistory{}
	options.Limit = 1
	report, err := Run(context.Background(), catalog, provider, options, nil)
	if err != nil || report.Entries[0].Status != "success" || report.Entries[1].Status != "pending" || report.StoppedReason != "attempt_limit" {
		t.Fatalf("report=%+v err=%v", report, err)
	}
	options.Limit = 0
	report, err = Run(context.Background(), catalog, provider, options, nil)
	if err != nil || provider.calls != 2 || report.Entries[1].Status != "success" {
		t.Fatalf("report=%+v calls=%d err=%v", report, provider.calls, err)
	}
	if _, err := Run(context.Background(), catalog, provider, options, nil); err != nil || provider.calls != 2 {
		t.Fatalf("cached resume err=%v calls=%d", err, provider.calls)
	}
	_ = os.WriteFile(filepath.Join(options.Directory, "BBCA.json"), []byte(`{}`), 0600)
	if _, err := Run(context.Background(), catalog, provider, options, nil); err == nil {
		t.Fatal("corrupt snapshot accepted")
	}
}

func TestCollectionRateLimitStopsAndFailedRetryIsExplicit(t *testing.T) {
	catalog, options := testRunOptions(t)
	provider := &fakeHistory{failure: &marketdata.HTTPError{Status: 429}}
	report, err := Run(context.Background(), catalog, provider, options, nil)
	if err != nil || provider.calls != 1 || report.StoppedReason != "provider_rate_limited" || report.Entries[1].Status != "pending" {
		t.Fatalf("report=%+v err=%v", report, err)
	}
	provider.failure = nil
	report, err = Run(context.Background(), catalog, provider, options, nil)
	if err != nil || report.Entries[0].Status != "failed" || report.Entries[1].Status != "success" {
		t.Fatalf("report=%+v err=%v", report, err)
	}
	options.RetryFailed = true
	report, err = Run(context.Background(), catalog, provider, options, nil)
	if err != nil || report.Entries[0].Status != "success" {
		t.Fatalf("report=%+v err=%v", report, err)
	}
}

func TestCollectionRejectsDifferentWindowLocksAndUnrelatedFiles(t *testing.T) {
	for _, kind := range []string{"window", "lock", "unrelated", "cancelled"} {
		t.Run(kind, func(t *testing.T) {
			catalog, options := testRunOptions(t)
			provider := &fakeHistory{}
			ctx := context.Background()
			switch kind {
			case "window":
				if _, err := Run(ctx, catalog, provider, options, nil); err != nil {
					t.Fatal(err)
				}
				options.To = options.To.Add(time.Hour)
			case "lock":
				_ = os.WriteFile(filepath.Join(options.Directory, ".collect.lock"), []byte("another process"), 0600)
			case "unrelated":
				_ = os.WriteFile(filepath.Join(options.Directory, "BBCA.json"), []byte("user file"), 0600)
			case "cancelled":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			}
			_, err := Run(ctx, catalog, provider, options, nil)
			if err == nil {
				t.Fatalf("accepted %s", kind)
			}
			if kind == "cancelled" && !errors.Is(err, context.Canceled) {
				t.Fatalf("err=%v", err)
			}
		})
	}
}
