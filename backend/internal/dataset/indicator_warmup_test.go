package dataset

import (
	"context"
	"errors"
	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
	"testing"
	"time"
)

type indicatorRuleReader struct{}

func (indicatorRuleReader) Get(context.Context, string, string) (rules.Rule, error) {
	return rules.Rule{Definition: core.RuleSnapshot{Name: "ADX", SignalType: "BUY", Logic: "AND", Conditions: []core.Condition{{Left: "ADX250_PREV_250", Op: ">", Right: 20}}}}, nil
}

type indicatorProvider struct{ requested int }

func (p *indicatorProvider) Daily(_ context.Context, instruments []universe.Instrument, size int) ([]marketdata.Series, error) {
	p.requested = size
	candles := make([]core.Candle, size)
	for i := range candles {
		candles[i] = core.Candle{Timestamp: time.Date(2020, 1, 1+i, 0, 0, 0, 0, time.UTC).Format(time.RFC3339), Open: 100, High: 102, Low: 99, Close: 101, Volume: 100}
	}
	return []marketdata.Series{{Symbol: instruments[0].Symbol, Timezone: "UTC", Candles: candles}}, nil
}
func TestIndicatorWarmupIsDerivedBeforeFetchAndOwnerScoped(t *testing.T) {
	provider := &indicatorProvider{}
	store, _ := NewDynamicStore(provider, fakeUniverseRepository{owner: "user-a"})
	access := &accessRecorder{}
	service := AccessService{Repository: store, Features: access, Rules: indicatorRuleReader{}}
	input := PrepareRequest{Purpose: "screen", RuleID: "rule", UniverseID: "univ-a", RequiredOperands: []string{"PRICE"}}
	manifest, err := service.Prepare(context.Background(), "user-a", input)
	if err != nil || provider.requested != 830 || manifest.WarmupCandles != 750 || len(manifest.RequiredOperands) != 1 || manifest.RequiredOperands[0] != "ADX250_PREV_250" {
		t.Fatalf("manifest=%+v requested=%d err=%v", manifest, provider.requested, err)
	}
	manifest.RequiredOperands[0] = "mutated"
	copy, err := store.Manifest(context.Background(), "user-a", manifest.DatasetID)
	if err != nil || copy.RequiredOperands[0] != "ADX250_PREV_250" {
		t.Fatal("caller mutated stored operand scope")
	}
	provider.requested = 0
	access.featureError = errors.New("denied")
	if _, err = service.Prepare(context.Background(), "user-a", input); err == nil || provider.requested != 0 {
		t.Fatal("denied access reached provider")
	}
	access.featureError = nil
	if _, err = service.Prepare(context.Background(), "user-b", input); err == nil || provider.requested != 0 {
		t.Fatal("foreign owner reached provider")
	}
}
func TestBacktestIncludesLargeIndicatorWarmup(t *testing.T) {
	store, _ := NewDynamicStore(&backtestProvider{}, fakeUniverseRepository{owner: "user-a"})
	input := backtestPrepare()
	input.Mode = "rule"
	input.RuleID = "custom"
	input.RequiredOperands = []string{"MA200_PREV_20"}
	manifest, err := store.Prepare(context.Background(), "user-a", input)
	if err != nil || manifest.WarmupCandles != 220 || manifest.CandleCount < 220 {
		t.Fatalf("manifest=%+v err=%v", manifest, err)
	}
}

func TestBacktestDoesNotReuseWrongIndicatorScopeWithIdenticalCandles(t *testing.T) {
	store, _ := NewDynamicStore(&backtestProvider{}, fakeUniverseRepository{owner: "user-a"})
	input := backtestPrepare()
	input.Mode = "rule"
	input.RuleID = "custom"
	input.RequiredOperands = []string{"MACD"}
	first, err := store.Prepare(context.Background(), "user-a", input)
	if err != nil {
		t.Fatal(err)
	}
	input.RequiredOperands = []string{"MACD_SIGNAL"}
	second, err := store.Prepare(context.Background(), "user-a", input)
	if err != nil {
		t.Fatal(err)
	}
	if first.DatasetID == second.DatasetID || first.Checksum != second.Checksum || second.RequiredOperands[0] != "MACD_SIGNAL" {
		t.Fatal("snapshot reused metadata from another indicator scope")
	}
}
