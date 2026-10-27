package core

import (
	"encoding/json"
	"math"
	"os"
	"reflect"
	"testing"
)

func backtestFixture(t *testing.T) BacktestRequest {
	t.Helper()
	raw, err := os.ReadFile("testdata/backtest_next_open_v1.json")
	if err != nil {
		t.Fatal(err)
	}
	request, err := DecodeBacktestRequest(raw)
	if err != nil {
		t.Fatal(err)
	}
	return request
}
func nearBacktest(t *testing.T, got, want float64) {
	t.Helper()
	if math.IsNaN(got) || math.IsInf(got, 0) || math.IsNaN(want) || math.IsInf(want, 0) || math.Abs(got-want) > 1e-8+math.Abs(want)*1e-12 {
		t.Fatalf("got %.12f want %.12f", got, want)
	}
}

func TestBacktestNextOpenAndIndependentHorizons(t *testing.T) {
	request := backtestFixture(t)
	result, err := RunBacktest(request)
	if err != nil {
		t.Fatal(err)
	}
	one, two := result.Horizons[0], result.Horizons[1]
	if one.Trades[0].EntryTime != "2026-01-21T00:00:00Z" || one.Trades[0].EntryPrice != 110 || *one.Trades[0].ExitPrice != 115 {
		t.Fatalf("next-open fill: %+v", one.Trades[0])
	}
	nearBacktest(t, one.Metrics.FinalEquity, 10000.0*115/110*100/120*125/120)
	if one.Metrics.ClosedTrades != 3 || one.Skipped[0].Reason != "NO_NEXT_CANDLE" {
		t.Fatalf("T+1=%+v", one)
	}
	nearBacktest(t, two.Metrics.FinalEquity, 10000.0*100/110*125/120)
	if two.Metrics.ClosedTrades != 1 || two.Metrics.OpenTrades != 1 || two.Trades[1].ExitPrice != nil || len(two.Skipped) != 2 {
		t.Fatalf("T+2=%+v", two)
	}
	nearBacktest(t, two.Metrics.NetPLCash+two.Metrics.UnrealizedPL, two.Metrics.FinalEquity-10000)
	nearBacktest(t, two.Metrics.MaxDrawdownPct, (115.0-100)/115*100)
}

func TestBacktestCostsSizingAndClaudioFormula(t *testing.T) {
	request := backtestFixture(t)
	request.Config.NSteps = 1
	request.Entries = request.Entries[:1]
	request.Config.CommissionPct = 1
	request.Config.SlippagePct = 1
	request.Config.PositionSizing = "fixed_amount"
	request.Config.PositionSize = 500
	result, err := RunBacktest(request)
	if err != nil {
		t.Fatal(err)
	}
	trade := result.Horizons[0].Trades[0]
	quantity := 500 / (110 * 1.01 * 1.01)
	nearBacktest(t, trade.Quantity, quantity)
	nearBacktest(t, result.Horizons[0].Metrics.FinalEquity, 9500+quantity*115*0.99*0.99)
	nearBacktest(t, result.Horizons[0].Metrics.TotalCommission, quantity*(110*1.01+115*0.99)*0.01)
	request.Config.PositionSize = 1e6
	capped, err := RunBacktest(request)
	if err != nil {
		t.Fatal(err)
	}
	nearBacktest(t, capped.Horizons[0].Trades[0].Quantity, 10000/(110*1.01*1.01))
	// Same prices/config as the frozen Python formula: 100 -> 110, zero costs.
	raw, _ := os.ReadFile("testdata/claudio_backtest_formula_v1.json")
	var legacy struct {
		EntryPrice     float64 `json:"entry_price"`
		ExitPrice      float64 `json:"exit_price"`
		InitialCapital float64 `json:"initial_capital"`
		Expected       struct {
			FinalEquity float64 `json:"final_equity"`
			NetPL       float64 `json:"net_pl_cash"`
		} `json:"expected"`
	}
	if err := json.Unmarshal(raw, &legacy); err != nil {
		t.Fatal(err)
	}
	request.Config.CommissionPct = 0
	request.Config.SlippagePct = 0
	request.Config.PositionSizing = "percent_equity"
	request.Config.PositionSize = 100
	request.Series[0].Candles[20] = Candle{Timestamp: "2026-01-21T00:00:00Z", Open: legacy.EntryPrice, High: 115, Low: 95, Close: legacy.ExitPrice, Volume: 1}
	matched, err := RunBacktest(request)
	if err != nil {
		t.Fatal(err)
	}
	nearBacktest(t, matched.Horizons[0].Metrics.FinalEquity, legacy.Expected.FinalEquity)
	nearBacktest(t, matched.Horizons[0].Metrics.NetPLCash, legacy.Expected.NetPL)
}

func TestBacktestGlobalPositionAndDeterministicTie(t *testing.T) {
	request := backtestFixture(t)
	other := request.Series[0]
	other.Symbol = "AAA"
	request.Series = append(request.Series, other)
	entry := request.Entries[0]
	entry.Symbol = "AAA"
	request.Entries = []BacktestEntry{request.Entries[0], entry}
	request.Config.NSteps = 2
	result, err := RunBacktest(request)
	if err != nil {
		t.Fatal(err)
	}
	for _, horizon := range result.Horizons {
		if len(horizon.Trades) != 1 || horizon.Trades[0].Symbol != "AAA" || horizon.Skipped[0].Reason != "POSITION_OPEN" {
			t.Fatalf("tie=%+v", horizon)
		}
	}
}

func TestBacktestNoSignalsAndFiniteNullRatios(t *testing.T) {
	request := backtestFixture(t)
	request.Entries = nil
	result, err := RunBacktest(request)
	if err != nil {
		t.Fatal(err)
	}
	for _, horizon := range result.Horizons {
		if horizon.Metrics.FinalEquity != 10000 || horizon.Metrics.ProfitFactor != nil || len(horizon.Trades) != 0 {
			t.Fatalf("empty=%+v", horizon)
		}
	}
	if _, err := json.Marshal(result); err != nil {
		t.Fatal(err)
	}
}

func TestBacktestRejectsUnsupportedAndCorruptInputs(t *testing.T) {
	cases := map[string]func(*BacktestRequest){
		"schema-1":         func(r *BacktestRequest) { r.SchemaVersion = "backtest-1" },
		"sell":             func(r *BacktestRequest) { r.Entries[0].SignalType = "SELL" },
		"intraday":         func(r *BacktestRequest) { r.Config.Timeframe = "5m" },
		"target-stop":      func(r *BacktestRequest) { r.Config.ExitStrategy = "target_stop" },
		"bad-period":       func(r *BacktestRequest) { r.Config.NSteps = 101 },
		"zero-capital":     func(r *BacktestRequest) { r.Config.InitialCapital = 0 },
		"nonfinite":        func(r *BacktestRequest) { r.Config.CommissionPct = math.NaN() },
		"leveraged":        func(r *BacktestRequest) { r.Config.PositionSize = 101 },
		"duplicate-candle": func(r *BacktestRequest) { r.Series[0].Candles[1] = r.Series[0].Candles[0] },
		"bad-ohlc":         func(r *BacktestRequest) { r.Series[0].Candles[0].High = 1 },
		"infinite-price":   func(r *BacktestRequest) { r.Series[0].Candles[0].Close = math.Inf(1) },
		"no-warmup":        func(r *BacktestRequest) { r.Entries[0].Timestamp = r.Series[0].Candles[0].Timestamp },
		"outside-range":    func(r *BacktestRequest) { r.Config.From = "2026-01-21" },
		"outside-series":   func(r *BacktestRequest) { r.Entries[0].Timestamp = "2026-01-20T01:00:00Z" },
		"duplicate-entry":  func(r *BacktestRequest) { r.Entries = append(r.Entries, r.Entries[0]) },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			r := backtestFixture(t)
			change(&r)
			if _, err := RunBacktest(r); err == nil {
				t.Fatal("accepted invalid request")
			}
		})
	}
	for _, raw := range []string{`{"config":{"entry_price_basis":"high"}}`, `{"schema_version":"backtest-2"} {}`, `{"config":{"initial_capital":null}}`} {
		if _, err := DecodeBacktestRequest([]byte(raw)); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}

func TestBacktestFeaturesWarmupAndNoFutureLeak(t *testing.T) {
	request := backtestFixture(t)
	features, err := ComputeBacktestFeatures(FeatureRequest{Purpose: "backtest", Symbol: "TEST", Candles: request.Series[0].Candles})
	if err != nil {
		t.Fatal(err)
	}
	prefix, err := ComputeBacktestFeatures(FeatureRequest{Purpose: "backtest", Symbol: "TEST", Candles: request.Series[0].Candles[:21]})
	if err != nil {
		t.Fatal(err)
	}
	for i, candidate := range prefix.Candidates {
		if !reflect.DeepEqual(features.Candidates[i], candidate) {
			t.Fatal("future candles changed prefix features")
		}
	}
	if _, err := ComputeFeatures(FeatureRequest{Purpose: "backtest", Symbol: "TEST", Candles: request.Series[0].Candles}); err == nil {
		t.Fatal("changed screener purpose contract")
	}
}

func TestBacktestDecisionWarmupPreservesCrossAndDoesNotConsumeCooldown(t *testing.T) {
	request := DecisionRequest{Rule: RuleSnapshot{Name: "test rule", Logic: "AND", SignalType: "BUY", CooldownSec: 86400, Conditions: []Condition{{Left: "PRICE", Op: "CROSS_UP", Right: "EMA9"}}}, Candidates: []FeatureCandidate{
		{Symbol: "TEST", Timestamp: "2026-01-19T00:00:00Z", Features: FeatureVector{Price: 99, EMA9: 100, EMA20: 100, RSI14: 50}},
		{Symbol: "TEST", Timestamp: "2026-01-20T00:00:00Z", Features: FeatureVector{Price: 101, EMA9: 100, EMA20: 100, RSI14: 50}},
	}}
	result, err := EvaluateBacktestDecision(request, "2026-01-20", "2026-01-20")
	if err != nil || len(result.Signals) != 1 {
		t.Fatalf("cross=%+v err=%v", result, err)
	}
	request.Rule.Conditions = []Condition{{Left: "PRICE", Op: ">", Right: 1}}
	result, err = EvaluateBacktestDecision(request, "2026-01-20", "2026-01-20")
	if err != nil || len(result.Signals) != 1 || result.Signals[0].Timestamp != "2026-01-20T00:00:00Z" {
		t.Fatalf("warmup consumed cooldown: %+v %v", result, err)
	}
	request.Candidates = append(request.Candidates, FeatureCandidate{Symbol: "TEST", Timestamp: "2026-01-20T12:00:00Z", Features: request.Candidates[1].Features})
	result, err = EvaluateBacktestDecision(request, "2026-01-20", "2026-01-21")
	if err != nil || len(result.Signals) != 1 || result.Evaluations[1].ReasonCodes[0] != "COOLDOWN_ACTIVE" {
		t.Fatalf("cooldown=%+v %v", result, err)
	}
}

func TestBacktestFrozenHorizonMetrics(t *testing.T) {
	raw, err := os.ReadFile("testdata/backtest_next_open_v1.expected.json")
	if err != nil {
		t.Fatal(err)
	}
	var expected []struct {
		Step    int                        `json:"step"`
		Metrics map[string]json.RawMessage `json:"metrics"`
	}
	if err := json.Unmarshal(raw, &expected); err != nil {
		t.Fatal(err)
	}
	actual, err := RunBacktest(backtestFixture(t))
	if err != nil {
		t.Fatal(err)
	}
	if len(actual.Horizons) != len(expected) {
		t.Fatal("horizon count changed")
	}
	for i, want := range expected {
		encoded, _ := json.Marshal(actual.Horizons[i].Metrics)
		var metrics map[string]json.RawMessage
		_ = json.Unmarshal(encoded, &metrics)
		if want.Step != actual.Horizons[i].Step || len(metrics) != len(want.Metrics) {
			t.Fatal("golden metric keys changed")
		}
		for key, value := range want.Metrics {
			if string(value) == "null" {
				if string(metrics[key]) != "null" {
					t.Fatalf("%s should be null", key)
				}
				continue
			}
			var gotNumber, wantNumber float64
			if json.Unmarshal(metrics[key], &gotNumber) != nil || json.Unmarshal(value, &wantNumber) != nil {
				t.Fatalf("metric %s missing or invalid", key)
			}
			nearBacktest(t, gotNumber, wantNumber)
		}
	}
}
