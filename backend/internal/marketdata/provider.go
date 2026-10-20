// Package marketdata isolates external OHLCV providers from screener logic.
package marketdata

import (
	"context"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type Series struct {
	RequestedFrom string        `json:"-"`
	RequestedTo   string        `json:"-"`
	Symbol        string        `json:"symbol"`
	Candles       []core.Candle `json:"candles"`
	Timezone      string        `json:"timezone"`
	// QualityWarnings travels with the fetched series through the shared cache.
	// It is published in manifest.quality.warnings, not in the OHLCV payload.
	QualityWarnings []string `json:"-"`
}

type Provider interface {
	Daily(ctx context.Context, instruments []universe.Instrument, outputSize int) ([]Series, error)
}
