package marketdata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

var (
	ErrUnavailable = errors.New("market data provider unavailable")
	ErrInvalidData = errors.New("market data provider returned invalid data")
)

// YahooFinance reads the same public Yahoo Finance chart data commonly used
// by yfinance, but keeps SignalGen's active backend entirely in Go.
type YahooFinance struct {
	baseURL string
	client  *http.Client
}

func NewYahooFinance(baseURL string, client *http.Client) (*YahooFinance, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return nil, fmt.Errorf("Yahoo Finance base URL is required")
	}
	if client == nil {
		client = &http.Client{Timeout: 12 * time.Second}
	}
	return &YahooFinance{baseURL: baseURL, client: client}, nil
}

func (provider *YahooFinance) Daily(ctx context.Context, instruments []universe.Instrument, outputSize int) ([]Series, error) {
	if len(instruments) < 1 || len(instruments) > universe.MaxSymbols || outputSize < 20 || outputSize > 5000 {
		return nil, ErrInvalidData
	}
	result := make([]Series, 0, len(instruments))
	for _, instrument := range instruments {
		series, err := provider.dailyOne(ctx, instrument, outputSize)
		if err != nil {
			return nil, err
		}
		result = append(result, series)
	}
	return result, nil
}

func (provider *YahooFinance) dailyOne(ctx context.Context, instrument universe.Instrument, outputSize int) (Series, error) {
	endpoint, err := url.Parse(provider.baseURL + "/v8/finance/chart/" + url.PathEscape(instrument.ProviderSymbol))
	if err != nil {
		return Series{}, ErrUnavailable
	}
	query := endpoint.Query()
	query.Set("range", yahooRange(outputSize))
	query.Set("interval", "1d")
	query.Set("events", "history")
	query.Set("includeAdjustedClose", "true")
	endpoint.RawQuery = query.Encode()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return Series{}, ErrUnavailable
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "SignalGen/2.0 academic-market-data-client")
	response, err := provider.client.Do(request)
	if err != nil {
		return Series{}, fmt.Errorf("%w: request failed", ErrUnavailable)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return Series{}, fmt.Errorf("%w: status %d", ErrUnavailable, response.StatusCode)
	}

	var payload yahooChartResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return Series{}, ErrInvalidData
	}
	if payload.Chart.Error != nil || len(payload.Chart.Result) != 1 || len(payload.Chart.Result[0].Indicators.Quote) != 1 {
		return Series{}, ErrInvalidData
	}
	chart := payload.Chart.Result[0]
	quote := chart.Indicators.Quote[0]
	length := minimumLength(len(chart.Timestamp), len(quote.Open), len(quote.High), len(quote.Low), len(quote.Close), len(quote.Volume))
	candles := make([]core.Candle, 0, length)
	for index := 0; index < length; index++ {
		if quote.Open[index] == nil || quote.High[index] == nil || quote.Low[index] == nil || quote.Close[index] == nil || quote.Volume[index] == nil {
			continue
		}
		candles = append(candles, core.Candle{
			Timestamp: time.Unix(chart.Timestamp[index], 0).UTC().Format(time.RFC3339),
			Open:      *quote.Open[index],
			High:      *quote.High[index],
			Low:       *quote.Low[index],
			Close:     *quote.Close[index],
			Volume:    *quote.Volume[index],
		})
	}
	if len(candles) < 20 {
		return Series{}, ErrInvalidData
	}
	if len(candles) > outputSize {
		candles = candles[len(candles)-outputSize:]
	}
	return Series{Symbol: instrument.Symbol, Candles: candles, Timezone: "UTC"}, nil
}

func yahooRange(outputSize int) string {
	switch {
	case outputSize <= 60:
		return "3mo"
	case outputSize <= 130:
		return "6mo"
	case outputSize <= 260:
		return "1y"
	case outputSize <= 1300:
		return "5y"
	default:
		return "max"
	}
}

func minimumLength(values ...int) int {
	minimum := values[0]
	for _, value := range values[1:] {
		if value < minimum {
			minimum = value
		}
	}
	return minimum
}

type yahooChartResponse struct {
	Chart struct {
		Result []struct {
			Timestamp  []int64 `json:"timestamp"`
			Indicators struct {
				Quote []struct {
					Open   []*float64 `json:"open"`
					High   []*float64 `json:"high"`
					Low    []*float64 `json:"low"`
					Close  []*float64 `json:"close"`
					Volume []*int64   `json:"volume"`
				} `json:"quote"`
			} `json:"indicators"`
		} `json:"result"`
		Error *struct {
			Code        string `json:"code"`
			Description string `json:"description"`
		} `json:"error"`
	} `json:"chart"`
}
