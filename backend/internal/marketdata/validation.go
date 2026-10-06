package marketdata

import (
	"math"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

// ValidateSeries checks the provider boundary before data enters a shared
// cache or a private dataset. A provider must return exactly the authorized
// symbols, in the requested order, with valid chronological OHLCV values.
func ValidateSeries(series []Series, instruments []universe.Instrument, outputSize int) error {
	if len(series) != len(instruments) || len(series) == 0 || len(series) > universe.MaxSymbols {
		return ErrInvalidData
	}
	seen := make(map[string]bool, len(series))
	for index, item := range series {
		if item.Symbol == "" || item.Symbol != instruments[index].Symbol || seen[item.Symbol] || item.Timezone != "UTC" || len(item.Candles) < 20 || len(item.Candles) > outputSize {
			return ErrInvalidData
		}
		seen[item.Symbol] = true
		var previous time.Time
		for _, candle := range item.Candles {
			stamp, err := time.Parse(time.RFC3339, candle.Timestamp)
			if err != nil || (!previous.IsZero() && !stamp.After(previous)) {
				return ErrInvalidData
			}
			previous = stamp
			for _, price := range []float64{candle.Open, candle.High, candle.Low, candle.Close} {
				if price <= 0 || math.IsNaN(price) || math.IsInf(price, 0) {
					return ErrInvalidData
				}
			}
			if candle.Volume < 0 || candle.High < candle.Low || candle.High < candle.Open || candle.High < candle.Close || candle.Low > candle.Open || candle.Low > candle.Close {
				return ErrInvalidData
			}
		}
	}
	return nil
}
