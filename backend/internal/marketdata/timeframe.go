package marketdata

import (
	"context"
	"errors"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

var (
	ErrIntervalUnavailable = errors.New("market data interval unavailable")
	ErrInsufficientCandles = errors.New("insufficient closed candles")
)

// TimeframePolicy is the single server-side definition of automatic lookback.
// Days are calendar days, not a promise of that many trading sessions.
type TimeframePolicy struct {
	Duration     time.Duration
	LookbackDays []int
	CacheTTL     time.Duration
}

func Policy(timeframe string) (TimeframePolicy, error) {
	switch timeframe {
	case "", "1d":
		return TimeframePolicy{Duration: 24 * time.Hour, CacheTTL: 5 * time.Minute}, nil
	case "1m":
		return TimeframePolicy{time.Minute, []int{3, 7}, 30 * time.Second}, nil
	case "5m":
		return TimeframePolicy{5 * time.Minute, []int{3, 7, 30}, time.Minute}, nil
	case "15m":
		return TimeframePolicy{15 * time.Minute, []int{3, 7, 30}, 3 * time.Minute}, nil
	case "1h":
		return TimeframePolicy{time.Hour, []int{3, 7, 30}, 5 * time.Minute}, nil
	default:
		return TimeframePolicy{}, ErrIntervalUnavailable
	}
}

// CandleProvider is optional so daily archives and research collectors retain
// their existing interface. An archive can never silently serve daily as intraday.
type CandleProvider interface {
	Candles(context.Context, []universe.Instrument, int, string) ([]Series, error)
}

func ReadCandles(ctx context.Context, provider Provider, instruments []universe.Instrument, size int, timeframe string) ([]Series, error) {
	if timeframe == "" {
		timeframe = "1d"
	}
	if _, err := Policy(timeframe); err != nil {
		return nil, err
	}
	if flexible, ok := provider.(CandleProvider); ok {
		return flexible.Candles(ctx, instruments, size, timeframe)
	}
	if timeframe != "1d" {
		return nil, ErrIntervalUnavailable
	}
	return provider.Daily(ctx, instruments, size)
}
