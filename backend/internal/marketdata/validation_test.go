package marketdata

import (
	"math"
	"testing"
)

func TestValidateSeriesRejectsCorruptCandles(t *testing.T) {
	for _, kind := range []string{"nan", "infinity", "ohlc", "negative-volume", "duplicate-time", "wrong-symbol", "wrong-timezone"} {
		t.Run(kind, func(t *testing.T) {
			item := validSeries("BBCA.JK")
			switch kind {
			case "nan":
				item.Candles[0].Close = math.NaN()
			case "infinity":
				item.Candles[0].Open = math.Inf(1)
			case "ohlc":
				item.Candles[0].High = 98
			case "negative-volume":
				item.Candles[0].Volume = -1
			case "duplicate-time":
				item.Candles[1].Timestamp = item.Candles[0].Timestamp
			case "wrong-symbol":
				item.Symbol = "BBRI.JK"
			case "wrong-timezone":
				item.Timezone = "Asia/Jakarta"
			}
			if err := ValidateSeries([]Series{item}, cacheInstruments, 20); err != ErrInvalidData {
				t.Fatalf("error = %v", err)
			}
		})
	}
}
