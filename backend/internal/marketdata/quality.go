package marketdata

import (
	"fmt"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type yahooEvents struct {
	Splits map[string]struct {
		Date int64 `json:"date"`
	} `json:"splits"`
	Dividends map[string]struct {
		Date int64 `json:"date"`
	} `json:"dividends"`
}

func validateChartMetadata(meta yahooMarketMeta, instrument universe.Instrument, timeframe string) error {
	if meta.Symbol != "" && meta.Symbol != instrument.ProviderSymbol {
		return ErrInvalidData
	}
	if meta.Currency != "" && instrument.Currency != "" && meta.Currency != instrument.Currency {
		return ErrInvalidData
	}
	if meta.DataGranularity != "" && meta.DataGranularity != timeframe && !(timeframe == "1h" && meta.DataGranularity == "60m") {
		return ErrIntervalUnavailable
	}
	return nil
}

// Report evidence without inventing an exchange calendar or silently changing
// historical prices. Weekends/holidays/suspensions are not filled with fake bars.
func historicalQualityWarnings(symbol string, candles []core.Candle, events yahooEvents) []string {
	warnings := []string{}
	if len(candles) == 0 {
		return warnings
	}
	first, _ := time.Parse(time.RFC3339, candles[0].Timestamp)
	last, _ := time.Parse(time.RFC3339, candles[len(candles)-1].Timestamp)
	firstDate, lastDate := first.UTC().Format("2006-01-02"), last.UTC().Format("2006-01-02")
	inRange := func(stamp int64) bool {
		date := time.Unix(stamp, 0).UTC().Format("2006-01-02")
		return stamp > 0 && date >= firstDate && date <= lastDate
	}
	splits, dividends := 0, 0
	for _, event := range events.Splits {
		if inRange(event.Date) {
			splits++
		}
	}
	for _, event := range events.Dividends {
		if inRange(event.Date) {
			dividends++
		}
	}
	if splits+dividends > 0 {
		warnings = append(warnings, fmt.Sprintf("%s: provider reports %d split(s) and %d dividend(s) in retained history; provider OHLCV used without additional adjustment; not a total-return series", symbol, splits, dividends))
	}
	longGaps := 0
	for i := 1; i < len(candles); i++ {
		previous, _ := time.Parse(time.RFC3339, candles[i-1].Timestamp)
		current, _ := time.Parse(time.RFC3339, candles[i].Timestamp)
		if current.Sub(previous) > 4*24*time.Hour {
			longGaps++
		}
	}
	if longGaps > 0 {
		warnings = append(warnings, fmt.Sprintf("%s: %d gap(s) exceed four calendar days; holiday/suspension/provider coverage requires review, no candles fabricated", symbol, longGaps))
	}
	return warnings
}
