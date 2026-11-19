package marketarchive

import (
	"context"
	"errors"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"testing"
	"time"
)

func TestWindowCalendarMonthsAndExchangeZones(t *testing.T) {
	for _, tc := range []struct{ now, market, from, to string }{
		{"2026-11-19T12:17:00Z", "IDX", "2026-08-19T17:00:00Z", "2026-11-19T17:00:00Z"},
		{"2026-11-19T02:37:00Z", "US", "2026-08-19T04:00:00Z", "2026-11-19T05:00:00Z"},
		{"2026-05-31T12:17:00Z", "IDX", "2026-02-28T17:00:00Z", "2026-05-31T17:00:00Z"},
		{"2026-08-31T01:00:00Z", "IDX", "2026-05-30T17:00:00Z", "2026-08-30T17:00:00Z"},
	} {
		now, _ := time.Parse(time.RFC3339, tc.now)
		from, to, err := Window(now, tc.market)
		if err != nil || from.Format(time.RFC3339) != tc.from || to.Format(time.RFC3339) != tc.to {
			t.Fatalf("%+v got %s %s %v", tc, from, to, err)
		}
	}
}

func TestRetryClassificationAndCancellation(t *testing.T) {
	for _, code := range []int{429, 500, 503} {
		if !transient(&marketdata.HTTPError{Status: code}) {
			t.Fatal(code)
		}
	}
	for _, err := range []error{&marketdata.HTTPError{Status: 404}, marketdata.ErrInvalidData, context.Canceled} {
		if transient(err) {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if !errors.Is(wait(ctx, time.Hour), context.Canceled) {
		t.Fatal("wait ignored cancellation")
	}
}
