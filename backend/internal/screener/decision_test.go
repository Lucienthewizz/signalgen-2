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
