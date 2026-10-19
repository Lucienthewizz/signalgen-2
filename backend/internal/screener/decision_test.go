package screener

import (
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
)

func screeningRule() core.RuleSnapshot {
	return core.RuleSnapshot{Name: "price", Logic: "AND", SignalType: "BUY", CooldownSec: 60,
		Conditions: []core.Condition{{Left: "PRICE", Op: ">", Right: 100}}}
}

func screeningCandidate(symbol, stamp string) core.FeatureCandidate {
	return core.FeatureCandidate{Symbol: symbol, Timestamp: stamp, Features: core.FeatureVector{Price: 128, EMA9: 125, EMA20: 121, RSI14: 72}}
}

func TestEvaluateBatchKeepsCooldownPerSymbol(t *testing.T) {
	stamp := "2026-01-01T00:00:00Z"
	second := "2026-01-01T00:00:30Z"
	scope := DatasetScope{Symbols: []string{"BBCA.JK", "BBRI.JK", "TLKM.JK"}, From: "2026-01-01", To: "2026-01-01"}
	candidates := []core.FeatureCandidate{screeningCandidate("BBCA.JK", stamp), screeningCandidate("BBRI.JK", stamp), screeningCandidate("TLKM.JK", stamp), screeningCandidate("BBCA.JK", second)}
	result, err := EvaluateBatch(screeningRule(), candidates, scope)
	if err != nil || len(result.Signals) != 3 || result.CandidateCount != 4 {
		t.Fatalf("result=%+v error=%v", result, err)
	}
	for index, signal := range result.Signals {
		if signal.Symbol != scope.Symbols[index] {
			t.Fatalf("unexpected signal=%+v", signal)
		}
	}
	if len(result.Evaluations) != 4 {
		t.Fatalf("evaluations count = %d, want 4", len(result.Evaluations))
	}
	// The 4th evaluation is BBCA.JK at 00:30, which must be marked as COOLDOWN_ACTIVE
	cooldownEvalFound := false
	for _, eval := range result.Evaluations {
		if eval.Symbol == "BBCA.JK" && eval.Timestamp == second {
			cooldownEvalFound = true
			if eval.Matched || len(eval.ReasonCodes) == 0 || eval.ReasonCodes[0] != "COOLDOWN_ACTIVE" {
				t.Fatalf("expected COOLDOWN_ACTIVE for BBCA.JK at second, got %+v", eval)
			}
		}
	}
	if !cooldownEvalFound {
		t.Fatal("cooldown evaluation for BBCA.JK at second not found")
	}
}

func TestEvaluateBatchSupportsORLogic(t *testing.T) {
	orRule := core.RuleSnapshot{
		Name: "OR Strategy", Logic: "OR", SignalType: "BUY", CooldownSec: 0,
		Conditions: []core.Condition{
			{Left: "PRICE", Op: ">", Right: 150},
			{Left: "RSI14", Op: "<", Right: 30},
		},
	}
	scope := DatasetScope{Symbols: []string{"BBCA.JK", "BBRI.JK"}, From: "2026-01-01", To: "2026-01-01"}
	candidates := []core.FeatureCandidate{
		// BBCA: Price 160 > 150 -> matches OR condition 1
		{Symbol: "BBCA.JK", Timestamp: "2026-01-01T00:00:00Z", Features: core.FeatureVector{Price: 160, EMA9: 100, EMA20: 100, RSI14: 60}},
		// BBRI: Price 120 (not > 150), RSI 25 (< 30) -> matches OR condition 2
		{Symbol: "BBRI.JK", Timestamp: "2026-01-01T00:00:00Z", Features: core.FeatureVector{Price: 120, EMA9: 100, EMA20: 100, RSI14: 25}},
	}
	result, err := EvaluateBatch(orRule, candidates, scope)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(result.Signals) != 2 {
		t.Fatalf("expected 2 signals with OR logic, got %d", len(result.Signals))
	}
	for _, eval := range result.Evaluations {
		if !eval.Matched || eval.ReasonCodes[0] != "RULE_MATCHED" {
			t.Fatalf("expected RULE_MATCHED, got %+v", eval)
		}
	}
}

func TestUSEvaluationKeepsCatalogScopeIncludingShareClasses(t *testing.T) {
	scope := DatasetScope{Symbols: []string{"AAPL", "MSFT", "BRK-B"}, From: "2026-01-01", To: "2026-01-01"}
	candidates := []core.FeatureCandidate{}
	for _, symbol := range scope.Symbols {
		candidates = append(candidates, screeningCandidate(symbol, "2026-01-01T14:30:00Z"))
	}
	result, err := EvaluateBatch(screeningRule(), candidates, scope)
	if err != nil || len(result.Signals) != 3 {
		t.Fatalf("US decisions: %+v %v", result, err)
	}
	candidates[0].Symbol = "BBCA.JK"
	if _, err := EvaluateBatch(screeningRule(), candidates, scope); err == nil {
		t.Fatal("IDX candidate accepted in US scope")
	}
}

func TestEvaluateBatchRejectsInvalidScopeAndChronology(t *testing.T) {
	scope := DatasetScope{Symbols: []string{"BBCA.JK"}, From: "2026-01-01", To: "2026-01-02"}
	for _, candidates := range [][]core.FeatureCandidate{
		{screeningCandidate("BBRI.JK", "2026-01-01T00:00:00Z")},
		{screeningCandidate("BBCA.JK", "2025-12-31T23:59:59Z")},
		{screeningCandidate("BBCA.JK", "2026-01-03T00:00:00Z")},
		{screeningCandidate("BBCA.JK", "2026-01-02T00:00:00Z"), screeningCandidate("BBCA.JK", "2026-01-01T00:00:00Z")},
	} {
		if _, err := EvaluateBatch(screeningRule(), candidates, scope); err == nil {
			t.Fatalf("invalid candidates accepted: %+v", candidates)
		}
	}
}
