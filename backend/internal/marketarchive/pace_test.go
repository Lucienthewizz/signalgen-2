package marketarchive

import (
	"context"
	"errors"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
	"testing"
	"time"
)

type historyFunc func(context.Context, universe.Instrument, time.Time, time.Time) (marketdata.History, error)

func (f historyFunc) DailyHistory(ctx context.Context, item universe.Instrument, from, to time.Time) (marketdata.History, error) {
	return f(ctx, item, from, to)
}

func TestPacingAndRetryCancellation(t *testing.T) {
	var starts []time.Time
	p := &pacedHistory{delay: 15 * time.Millisecond, source: historyFunc(func(context.Context, universe.Instrument, time.Time, time.Time) (marketdata.History, error) {
		starts = append(starts, time.Now())
		return marketdata.History{}, nil
	})}
	for i := 0; i < 2; i++ {
		if _, err := p.DailyHistory(context.Background(), universe.Instrument{}, time.Time{}, time.Time{}); err != nil {
			t.Fatal(err)
		}
	}
	if starts[1].Sub(starts[0]) < p.delay {
		t.Fatal("source calls were not spaced")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := p.DailyHistory(ctx, universe.Instrument{}, time.Time{}, time.Time{}); !errors.Is(err, context.Canceled) || len(starts) != 2 {
		t.Fatal("cancelled pacing invoked provider", err)
	}
	calls := 0
	r := Runner{Source: historyFunc(func(context.Context, universe.Instrument, time.Time, time.Time) (marketdata.History, error) {
		calls++
		return marketdata.History{}, &marketdata.HTTPError{Status: 429, RetryAfter: time.Hour}
	})}
	deadline, done := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer done()
	_, attempts, err := r.fetch(deadline, universe.Instrument{}, time.Time{}, time.Time{}, time.Second)
	if !errors.Is(err, context.DeadlineExceeded) || calls != 1 || attempts != 1 {
		t.Fatal("Retry-After ignored caller deadline", calls, attempts, err)
	}
}
