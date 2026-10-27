package marketdata

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

// Candles leaves the tested daily path unchanged and adds bounded intraday
// requests. Only insufficient history expands the window, never a network error.
func (provider *YahooFinance) Candles(ctx context.Context, instruments []universe.Instrument, size int, timeframe string) ([]Series, error) {
	if timeframe == "1d" || timeframe == "" {
		return provider.Daily(ctx, instruments, size)
	}
	policy, err := Policy(timeframe)
	if err != nil {
		return nil, err
	}
	if len(instruments) < 1 || len(instruments) > universe.MaxSymbols || size < 20 || size > 5000 {
		return nil, ErrInvalidData
	}
	result := make([]Series, 0, len(instruments))
	for _, instrument := range instruments {
		item, err := provider.intradayOne(ctx, instrument, size, timeframe, policy)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, nil
}

func (provider *YahooFinance) intradayOne(ctx context.Context, instrument universe.Instrument, size int, timeframe string, policy TimeframePolicy) (Series, error) {
	now := provider.now().UTC()
	for _, days := range policy.LookbackDays {
		if err := ctx.Err(); err != nil {
			return Series{}, err
		}
		from := now.AddDate(0, 0, -days)
		endpoint, err := url.Parse(provider.baseURL + "/v8/finance/chart/" + url.PathEscape(instrument.ProviderSymbol))
		if err != nil {
			return Series{}, ErrUnavailable
		}
		query := endpoint.Query()
		query.Set("period1", strconv.FormatInt(from.Unix(), 10))
		query.Set("period2", strconv.FormatInt(now.Unix(), 10))
		query.Set("interval", timeframe)
		query.Set("includePrePost", "false")
		query.Set("events", "history")
		query.Set("includeAdjustedClose", "true")
		endpoint.RawQuery = query.Encode()
		raw, err := provider.fetchChart(ctx, endpoint.String())
		if err != nil {
			return Series{}, err
		}
		var payload yahooChartResponse
		if json.Unmarshal(raw, &payload) != nil {
			return Series{}, ErrInvalidData
		}
		if payload.Chart.Error != nil || len(payload.Chart.Result) != 1 {
			return Series{}, ErrIntervalUnavailable
		}
		chart := payload.Chart.Result[0]
		if chart.Meta.ExchangeTimezoneName == "" {
			return Series{}, ErrIntervalUnavailable
		}
		if _, err := time.LoadLocation(chart.Meta.ExchangeTimezoneName); err != nil {
			return Series{}, ErrIntervalUnavailable
		}
		granularity := chart.Meta.DataGranularity
		if granularity != timeframe && !(timeframe == "1h" && granularity == "60m") {
			return Series{}, ErrIntervalUnavailable
		}
		if len(chart.Indicators.Quote) != 1 {
			return Series{}, ErrInvalidData
		}
		quote := chart.Indicators.Quote[0]
		n := len(chart.Timestamp)
		if n != minimumLength(n, len(quote.Open), len(quote.High), len(quote.Low), len(quote.Close), len(quote.Volume)) ||
			n != len(quote.Open) || n != len(quote.High) || n != len(quote.Low) || n != len(quote.Close) || n != len(quote.Volume) {
			return Series{}, ErrInvalidData
		}
		// Yahoo supplies regular sessions for every returned trading day. Refuse
		// unknown sessions rather than inventing IDX/US hours (including DST).
		sessions := regularSessions(chart.Meta)
		if len(sessions) == 0 {
			return Series{}, ErrIntervalUnavailable
		}
		candles := make([]core.Candle, 0, n)
		nulls, unfinished := 0, 0
		for i, timestamp := range chart.Timestamp {
			stamp := time.Unix(timestamp, 0).UTC()
			if timestamp <= 0 || stamp.Before(from) || !stamp.Before(now) || !closedIntraday(stamp, now, policy.Duration, sessions) {
				unfinished++
				continue
			}
			if quote.Open[i] == nil || quote.High[i] == nil || quote.Low[i] == nil || quote.Close[i] == nil || quote.Volume[i] == nil {
				nulls++
				continue
			}
			candles = append(candles, core.Candle{Timestamp: stamp.Format(time.RFC3339), Open: *quote.Open[i], High: *quote.High[i], Low: *quote.Low[i], Close: *quote.Close[i], Volume: *quote.Volume[i]})
		}
		minimum := 20
		if size > 100 {
			minimum = size - 80
		}
		if len(candles) < minimum {
			continue
		}
		if len(candles) > size {
			candles = candles[len(candles)-size:]
		}
		item := Series{Symbol: instrument.Symbol, Timezone: "UTC", Candles: candles, RequestedFrom: from.Format(time.RFC3339), RequestedTo: now.Format(time.RFC3339), QualityWarnings: []string{fmt.Sprintf("%s: %s regular-session closed candles; requested %d calendar days; %d null and %d unfinished/out-of-session rows excluded", instrument.Symbol, timeframe, days, nulls, unfinished)}}
		if err := ValidateSeries([]Series{item}, []universe.Instrument{instrument}, size); err != nil {
			return Series{}, err
		}
		return item, nil
	}
	return Series{}, ErrInsufficientCandles
}

type tradingSession struct {
	Start int64 `json:"start"`
	End   int64 `json:"end"`
}

func regularSessions(meta yahooMarketMeta) []tradingSession {
	var days [][]tradingSession
	if json.Unmarshal(meta.TradingPeriods, &days) != nil {
		var periods struct {
			Regular [][]tradingSession `json:"regular"`
		}
		if json.Unmarshal(meta.TradingPeriods, &periods) == nil {
			days = periods.Regular
		}
	}
	result := []tradingSession{}
	for _, day := range days {
		for _, session := range day {
			if session.Start > 0 && session.End > session.Start && session.End-session.Start <= 24*3600 {
				result = append(result, session)
			}
		}
	}
	regular := meta.CurrentTradingPeriod.Regular
	if regular.Start > 0 && regular.End > regular.Start && regular.End-regular.Start <= 24*3600 {
		result = append(result, tradingSession{regular.Start, regular.End})
	}
	return result
}

func closedIntraday(stamp, now time.Time, duration time.Duration, sessions []tradingSession) bool {
	for _, session := range sessions {
		start, end := time.Unix(session.Start, 0), time.Unix(session.End, 0)
		if stamp.Before(start) || !stamp.Before(end) {
			continue
		}
		closeAt := stamp.Add(duration)
		if closeAt.After(end) {
			closeAt = end
		}
		return !now.Before(closeAt.Add(10 * time.Second))
	}
	return false
}
