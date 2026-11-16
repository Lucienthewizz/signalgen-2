package collection

import (
	"context"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type routedFixtureProvider struct {
	calls []string
}

func (p *routedFixtureProvider) Daily(_ context.Context, items []universe.Instrument, _ int) ([]marketdata.Series, error) {
	result := make([]marketdata.Series, 0, len(items))
	for _, item := range items {
		p.calls = append(p.calls, item.Symbol)
		result = append(result, marketdata.Series{Symbol: item.Symbol, Timezone: "UTC", Candles: routedCandles()})
	}
	return result, nil
}

func (p *routedFixtureProvider) DailyHistory(_ context.Context, item universe.Instrument, from, to time.Time) (marketdata.History, error) {
	p.calls = append(p.calls, item.Symbol)
	return marketdata.History{Series: marketdata.Series{Symbol: item.Symbol, RequestedFrom: from.Format(time.RFC3339), RequestedTo: to.Format(time.RFC3339), Candles: routedCandles()}}, nil
}

func routedCandles() []core.Candle {
	candles := make([]core.Candle, 20)
	for i := range candles {
		candles[i] = core.Candle{Timestamp: time.Date(2026, 1, i+1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339), Open: 10, High: 11, Low: 9, Close: 10, Volume: 100}
	}
	return candles
}

func TestRoutedViewPreservesUSLiveAndIDXArchiveRouting(t *testing.T) {
	archive, live := &routedFixtureProvider{}, &routedFixtureProvider{}
	view := &routedView{archive: archive, live: live}
	items := []universe.Instrument{
		{Symbol: "BBCA.JK", ProviderSymbol: "BBCA.JK", Exchange: "XIDX", Currency: "IDR"},
		{Symbol: "AAPL", ProviderSymbol: "AAPL", Exchange: "XNAS", Currency: "USD"},
	}
	result, err := view.Daily(context.Background(), items, 20)
	if err != nil || len(result) != len(items) || result[0].Symbol != "BBCA.JK" || result[1].Symbol != "AAPL" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	if len(archive.calls) != 1 || archive.calls[0] != "BBCA.JK" || len(live.calls) != 1 || live.calls[0] != "AAPL" {
		t.Fatalf("archive calls=%v live calls=%v", archive.calls, live.calls)
	}
}

func TestRoutedViewDoesNotFallbackMissingIDXHistoryToLive(t *testing.T) {
	archive, live := &routedFixtureProvider{}, &routedFixtureProvider{}
	view := &routedView{archive: archive, live: live}
	_, err := view.DailyHistory(context.Background(), universe.Instrument{Symbol: "BBCA.JK", ProviderSymbol: "BBCA.JK"}, time.Date(2021, 1, 1, 0, 0, 0, 0, time.UTC), time.Date(2022, 1, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if len(archive.calls) != 1 || len(live.calls) != 0 {
		t.Fatalf("archive calls=%v live calls=%v", archive.calls, live.calls)
	}
}
