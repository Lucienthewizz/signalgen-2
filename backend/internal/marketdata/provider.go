// Package marketdata isolates external OHLCV providers from screener logic.
package marketdata

import (
	"context"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type Series struct {
	Symbol   string        `json:"symbol"`
	Candles  []core.Candle `json:"candles"`
	Timezone string        `json:"timezone"`
}

type Provider interface {
	Daily(ctx context.Context, instruments []universe.Instrument, outputSize int) ([]Series, error)
}
