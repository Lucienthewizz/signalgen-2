package marketdata

import (
	"context"
	"encoding/json"
	"math"
	"net/url"
	"strconv"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

// HTTPError exposes only a provider status, never a URL, credential or body.
// Existing callers can still use errors.Is(err, ErrUnavailable).
type HTTPError struct {
	Status     int
	RetryAfter time.Duration
}

func (err *HTTPError) Error() string { return "market data provider HTTP " + strconv.Itoa(err.Status) }
func (err *HTTPError) Unwrap() error { return ErrUnavailable }

type History struct {
	Series           Series `json:"series"`
	SkippedNullRows  int    `json:"skipped_null_rows"`
	ExcludedOpenRows int    `json:"excluded_open_rows,omitempty"`
}

// DailyHistory collects one instrument in an explicit [from, to) window.
// It does not inherit the three-symbol UI universe limit or truncate to 100
// candles. Short histories from recent listings are retained, not fabricated.
func (provider *YahooFinance) DailyHistory(ctx context.Context, instrument universe.Instrument, from, to time.Time) (History, error) {
	if instrument.Symbol == "" || instrument.ProviderSymbol == "" || !from.Before(to) || to.Sub(from) > 10*366*24*time.Hour {
		return History{}, ErrInvalidData
	}
	endpoint, err := url.Parse(provider.baseURL + "/v8/finance/chart/" + url.PathEscape(instrument.ProviderSymbol))
	if err != nil {
		return History{}, ErrUnavailable
	}
	query := endpoint.Query()
	query.Set("period1", strconv.FormatInt(from.Unix(), 10))
	query.Set("period2", strconv.FormatInt(to.Unix(), 10))
	query.Set("interval", "1d")
	query.Set("events", "history")
	query.Set("includeAdjustedClose", "true")
	endpoint.RawQuery = query.Encode()
	raw, err := provider.fetchChart(ctx, endpoint.String())
	if err != nil {
		return History{}, err
	}
	var payload yahooChartResponse
	if err := json.Unmarshal(raw, &payload); err != nil || payload.Chart.Error != nil || len(payload.Chart.Result) != 1 || len(payload.Chart.Result[0].Indicators.Quote) != 1 {
		return History{}, ErrInvalidData
	}
	chart := payload.Chart.Result[0]
	quote := chart.Indicators.Quote[0]
	n := len(chart.Timestamp)
	if n == 0 || n > 2500 || n != len(quote.Open) || n != len(quote.High) || n != len(quote.Low) || n != len(quote.Close) || n != len(quote.Volume) {
		return History{}, ErrInvalidData
	}
	result := History{Series: Series{Symbol: instrument.Symbol, Timezone: "UTC", Candles: make([]core.Candle, 0, n)}}
	finality := newDailyFinality(chart.Meta, provider.now().UTC())
	for index, timestamp := range chart.Timestamp {
		stamp := time.Unix(timestamp, 0).UTC()
		if stamp.Before(from) || !stamp.Before(to) {
			continue
		}
		if !finality.closed(timestamp) {
			result.ExcludedOpenRows++
			continue
		}
		if quote.Open[index] == nil || quote.High[index] == nil || quote.Low[index] == nil || quote.Close[index] == nil || quote.Volume[index] == nil {
			result.SkippedNullRows++
			continue
		}
		result.Series.Candles = append(result.Series.Candles, core.Candle{
			Timestamp: stamp.Format(time.RFC3339), Open: *quote.Open[index], High: *quote.High[index],
			Low: *quote.Low[index], Close: *quote.Close[index], Volume: *quote.Volume[index],
		})
	}
	result.Series.QualityWarnings = dailyQualityWarnings(instrument.Symbol, result.SkippedNullRows, result.ExcludedOpenRows, finality.fallback)
	if err := ValidateHistory(result.Series, instrument.Symbol, from, to); err != nil {
		return History{}, err
	}
	return result, nil
}

// Validation rejects corrupt chronology/OHLCV; it does not claim that every
// exchange trading date exists. That needs a calendar and suspension metadata.
func ValidateHistory(series Series, symbol string, from, to time.Time) error {
	if series.Symbol != symbol || series.Timezone != "UTC" || len(series.Candles) == 0 || len(series.Candles) > 2500 {
		return ErrInvalidData
	}
	var previous time.Time
	for _, candle := range series.Candles {
		stamp, err := time.Parse(time.RFC3339, candle.Timestamp)
		if err != nil || stamp.Before(from) || !stamp.Before(to) || (!previous.IsZero() && !stamp.After(previous)) {
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
	return nil
}
