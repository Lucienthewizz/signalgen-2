package marketdata

import (
	"fmt"
	"math"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
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

func TestValidateSeriesThreeTenAndElevenSymbols(t *testing.T) {
	for _, count := range []int{3, 10, 11} {
		series := make([]Series, count)
		instruments := make([]universe.Instrument, count)
		for i := range series {
			symbol := fmt.Sprintf("TEST%d.JK", i)
			series[i] = validSeries(symbol)
			instruments[i] = universe.Instrument{Symbol: symbol, ProviderSymbol: symbol}
		}
		if err := ValidateSeries(series, instruments, 20); (err == nil) != (count <= 10) {
			t.Fatalf("count=%d error=%v", count, err)
		}
	}
}
