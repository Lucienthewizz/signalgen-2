package core

import (
	"encoding/json"
	"testing"
)

func mixedRule(logic string) RuleSnapshot {
	return RuleSnapshot{Name: "Mixed rule", Logic: logic, SignalType: "BUY", Conditions: []Condition{
		{Left: "PRICE", Op: ">", Right: 100.0, NextLogic: "OR"},
		{Left: "EMA9", Op: ">", Right: 100.0, NextLogic: "AND"},
		{Left: "RSI14", Op: ">", Right: 50.0},
	}}
}
func TestMixedRulePrecedenceAndLegacyTruthTables(t *testing.T) {
	for mask := 0; mask < 8; mask++ {
		a, b, c := mask&1 != 0, mask&2 != 0, mask&4 != 0
		values := map[string]float64{"PRICE": 90, "EMA9": 90, "RSI14": 40}
		if a {
			values["PRICE"] = 110
		}
		if b {
			values["EMA9"] = 110
		}
		if c {
			values["RSI14"] = 60
		}
		for _, logic := range []string{"AND", "OR"} {
			rule := mixedRule(logic)
			if err := ValidateRule(rule); err != nil {
				t.Fatal(err)
			}
			got, err := evaluateRule(rule, values, nil)
			if err != nil || got != (a || (b && c)) {
				t.Fatalf("A OR B AND C mask %d: %v %v", mask, got, err)
			}
			rule.Conditions[0].NextLogic = "AND"
			rule.Conditions[1].NextLogic = "OR"
			got, err = evaluateRule(rule, values, nil)
			if err != nil || got != ((a && b) || c) {
				t.Fatalf("A AND B OR C mask %d: %v %v", mask, got, err)
			}
			rule.Conditions[0].NextLogic = ""
			rule.Conditions[1].NextLogic = ""
			want := a && b && c
			if logic == "OR" {
				want = a || b || c
			}
			got, err = evaluateRule(rule, values, nil)
			if err != nil || got != want {
				t.Fatalf("legacy %s mask %d: %v %v", logic, mask, got, err)
			}
		}
	}
}
func TestMixedLogicRoundtripValidationAndShortCircuit(t *testing.T) {
	rule := mixedRule("AND")
	raw, err := json.Marshal(rule)
	if err != nil {
		t.Fatal(err)
	}
	var decoded RuleSnapshot
	if err = json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Conditions[0].NextLogic != "OR" || decoded.Conditions[1].NextLogic != "AND" {
		t.Fatal("connectors lost")
	}
	decoded.Conditions[0].NextLogic = "XOR"
	if ValidateRule(decoded) == nil {
		t.Fatal("invalid connector accepted")
	}
	decoded = mixedRule("AND")
	decoded.Conditions[2].NextLogic = "AND"
	if ValidateRule(decoded) == nil {
		t.Fatal("dangling connector accepted")
	}
	got, err := evaluateRule(rule, map[string]float64{"PRICE": 110}, nil)
	if err != nil || !got {
		t.Fatalf("OR short circuit: %v %v", got, err)
	}
	rule.Conditions[0].NextLogic = "AND"
	rule.Conditions[1].NextLogic = "OR"
	got, err = evaluateRule(rule, map[string]float64{"PRICE": 90, "RSI14": 60}, nil)
	if err != nil || !got {
		t.Fatalf("next OR group: %v %v", got, err)
	}
}
func TestMixedLogicPrivateScreenAndBacktestDecision(t *testing.T) {
	candidate := FeatureCandidate{Symbol: "BBCA.JK", Timestamp: "2026-10-01T08:00:00Z", Features: FeatureVector{Price: 90, EMA9: 110, EMA20: 95, RSI14: 60}}
	request := DecisionRequest{Rule: mixedRule("AND"), Candidates: []FeatureCandidate{candidate}}
	for _, rsi := range []float64{60, 40} {
		request.Candidates[0].Features.RSI14 = rsi
		want := 1
		if rsi == 40 {
			want = 0
		}
		screen, err := EvaluateDecision(request)
		if err != nil || len(screen.Signals) != want {
			t.Fatalf("screen RSI %v: %+v %v", rsi, screen, err)
		}
		backtest, err := EvaluateBacktestDecision(request, "2026-10-01", "2026-10-01")
		if err != nil || len(backtest.Signals) != want {
			t.Fatalf("backtest RSI %v: %+v %v", rsi, backtest, err)
		}
	}
}
