package screener

import (
	"fmt"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

// DatasetScope is derived from the server's owner-scoped dataset manifest.
// Client features are not proof of honest computation; this only restricts the
// private decision request to the authorized symbols and historical interval.
type DatasetScope struct {
	Symbols []string
	From    string
	To      string
}

// EvaluateBatch runs the frozen single-symbol core separately for each symbol.
// Cooldown state must never leak from one stock into another stock's decision.
func EvaluateBatch(rule core.RuleSnapshot, candidates []core.FeatureCandidate, scope DatasetScope) (core.DecisionResult, error) {
	if len(scope.Symbols) < 1 || len(scope.Symbols) > universe.MaxSymbols || len(candidates) == 0 || len(candidates) > MaxCandidates {
		return core.DecisionResult{}, fmt.Errorf("invalid screening batch scope")
	}
	from, fromErr := time.Parse("2006-01-02", scope.From)
	to, toErr := time.Parse("2006-01-02", scope.To)
	if fromErr != nil || toErr != nil || to.Before(from) {
		return core.DecisionResult{}, fmt.Errorf("invalid dataset interval")
	}
	end := to.AddDate(0, 0, 1)
	groups := make(map[string][]core.FeatureCandidate, len(scope.Symbols))
	for _, symbol := range scope.Symbols {
		if symbol == "" {
			return core.DecisionResult{}, fmt.Errorf("invalid dataset symbol")
		}
		if _, exists := groups[symbol]; exists {
			return core.DecisionResult{}, fmt.Errorf("duplicate dataset symbol")
		}
		groups[symbol] = nil
	}
	for _, candidate := range candidates {
		group, allowed := groups[candidate.Symbol]
		stamp, err := time.Parse(time.RFC3339, candidate.Timestamp)
		if !allowed || err != nil || stamp.Before(from) || !stamp.Before(end) {
			return core.DecisionResult{}, fmt.Errorf("candidate is outside the authorized dataset scope")
		}
		groups[candidate.Symbol] = append(group, candidate)
	}
	result := core.DecisionResult{DecisionVersion: core.DecisionVersion, CandidateCount: len(candidates), Signals: []core.Signal{}}
	for _, symbol := range scope.Symbols {
		if len(groups[symbol]) == 0 {
			continue
		}
		decision, err := core.EvaluateDecision(core.DecisionRequest{Rule: rule, Candidates: groups[symbol]})
		if err != nil {
			return core.DecisionResult{}, err
		}
		result.Signals = append(result.Signals, decision.Signals...)
	}
	return result, nil
}
