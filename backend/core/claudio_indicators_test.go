package core

import (
	"encoding/json"
	"math"
	"os"
	"reflect"
	"testing"
)

type claudioFixture struct {
	Request  FeatureRequest `json:"request"`
	Operands []string       `json:"operands"`
	Expected []struct {
		Index  int                 `json:"index"`
		Values map[string]*float64 `json:"values"`
	} `json:"expected"`
	FlatCandles []Candle            `json:"flat_candles"`
	FlatValues  map[string]*float64 `json:"flat_values"`
}

func claudioIndicators(t *testing.T) claudioFixture {
	t.Helper()
	raw, err := os.ReadFile("testdata/claudio_indicators_v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture claudioFixture
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}

func TestClaudioIndicatorGoldenParity(t *testing.T) {
	f := claudioIndicators(t)
	c := newIndicatorComputer(f.Request.Candles)
	for _, name := range f.Operands {
		t.Run(name, func(t *testing.T) {
			if !IsIndicatorOperand(name) {
				t.Fatal("missing catalog operand")
			}
			series := c.series(name)
			for _, point := range f.Expected {
				want := point.Values[name]
				got := series[point.Index]
				if want == nil {
					if !math.IsNaN(got) {
						t.Errorf("index %d: got %v; Claudio has no value", point.Index, got)
					}
					continue
				}
				if math.IsNaN(got) || math.Abs(got-*want) > 1e-8+1e-12*math.Abs(*want) {
					t.Errorf("index %d got %.14g, want %.14g", point.Index, got, *want)
				}
			}
		})
	}
	flat := newIndicatorComputer(f.FlatCandles)
	for name, want := range f.FlatValues {
		series := flat.series(name)
		got := series[len(series)-1]
		if want == nil {
			if !math.IsNaN(got) {
				t.Errorf("flat %s: got %v, want unavailable", name, got)
			}
		} else if math.IsNaN(got) || math.Abs(got-*want) > 1e-8 {
			t.Errorf("flat %s: got %v want %v", name, got, *want)
		}
	}
}

func TestIndicatorsAreCausalAndDefaultFeaturesCompatible(t *testing.T) {
	f := claudioIndicators(t)
	for start := 0; start < len(f.Operands); start += MaxIndicatorOperands {
		request := f.Request
		request.Operands = f.Operands[start:min(start+MaxIndicatorOperands, len(f.Operands))]
		full, err := ComputeFeatures(request)
		if err != nil {
			t.Fatal(err)
		}
		for _, n := range []int{20, 35, 52, 200, 251, 500, 750} {
			request.Candles = f.Request.Candles[:n]
			prefix, err := ComputeFeatures(request)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(prefix.Candidates[len(prefix.Candidates)-1], full.Candidates[n-20]) {
				t.Fatalf("future candles changed values at %d", n)
			}
		}
	}
	base, err := ComputeFeatures(f.Request)
	if err != nil {
		t.Fatal(err)
	}
	if len(base.Candidates) != len(f.Request.Candles)-19 || len(base.Candidates[0].Features.Values) != 0 {
		t.Fatal("baseline contract changed")
	}
}

func TestClaudioOperandValidationAndMissingValues(t *testing.T) {
	for _, name := range []string{"EMA0", "EMA251", "EMA01", "ADX250_PREV_251", "EMA20_PREV_2_PREV_2", "EMA20_PREV_PREV_2", "unknown", "__proto__"} {
		if IsIndicatorOperand(name) {
			t.Errorf("accepted %q", name)
		}
	}
	for _, name := range indicatorCatalog.Operands {
		if !IsIndicatorOperand(name) {
			t.Errorf("catalog missing %s", name)
		}
	}
	for _, name := range []string{"MACD", "BB_LOWER", "PATTERN_CDLDOJI", "EMA250_PREV_250", "ADX250", "REL_VOLUME_20"} {
		rule := RuleSnapshot{Name: "Claudio", Logic: "AND", SignalType: "BUY", Conditions: []Condition{{Left: name, Op: ">=", Right: 0.0}}}
		if name == "EMA250_PREV_250" {
			rule.Conditions[0].Right = 1.0
		}
		if err := ValidateRule(rule); err != nil {
			t.Error(err)
		}
	}
	if IndicatorWarmup([]string{"ADX250_PREV_250"}) != 750 {
		t.Fatal("insufficient high-period warmup")
	}
	condition := Condition{Left: "MACD", Op: "<=", Right: 0.0}
	if match, err := evaluateCondition(condition, map[string]float64{}, nil); err != nil || match {
		t.Fatal("missing indicator treated as zero")
	}
	for _, raw := range []string{`{"price":1,"ema9":1,"ema20":1,"rsi14":50,"values":{"MACD":null}}`, `{"price":1,"ema9":1,"ema20":1,"rsi14":50,"values":{"PRICE":999}}`} {
		var f FeatureVector
		if json.Unmarshal([]byte(raw), &f) == nil {
			t.Fatal("accepted null or overridden baseline feature")
		}
	}
}

func TestClaudioLongHistoryRuleRunsThroughPublicFeaturesAndPrivateDecision(t *testing.T) {
	f := claudioIndicators(t)
	rule := RuleSnapshot{Name: "Long history", Logic: "AND", SignalType: "BUY", Conditions: []Condition{{Left: "EMA250_PREV_250", Op: ">", Right: 1.0}}}
	result, err := RunSignals(RunRequest{Purpose: "screen", Symbol: "TEST", Candles: f.Request.Candles, Rule: rule})
	if err != nil || len(result.Signals) != len(f.Request.Candles)-499 || result.Signals[0].Timestamp != f.Request.Candles[499].Timestamp {
		t.Fatalf("long-history rule: %d signals, err %v", len(result.Signals), err)
	}
}
