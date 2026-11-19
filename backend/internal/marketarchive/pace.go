package marketarchive

import (
	"context"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
	"sync"
	"time"
)

// One wrapper per market run spaces actual source calls, including retries.
// Delays are cancellation-aware; a slow DB naturally consumes this interval.
type pacedHistory struct {
	source HistorySource
	delay  time.Duration
	mu     sync.Mutex
	last   time.Time
}

func (p *pacedHistory) DailyHistory(ctx context.Context, item universe.Instrument, from, to time.Time) (marketdata.History, error) {
	p.mu.Lock()
	if pause := p.delay - time.Since(p.last); pause > 0 {
		if err := wait(ctx, pause); err != nil {
			p.mu.Unlock()
			return marketdata.History{}, err
		}
	}
	if err := ctx.Err(); err != nil {
		p.mu.Unlock()
		return marketdata.History{}, err
	}
	p.last = time.Now()
	p.mu.Unlock()
	return p.source.DailyHistory(ctx, item, from, to)
}
