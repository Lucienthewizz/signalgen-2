// Package backtest authorizes lightweight private rule decisions. Financial
// simulation and indicator computation stay in the portable client core.
package backtest

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/entitlement"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
)

var (
	ErrInvalid     = errors.New("invalid backtest feature scope")
	ErrVersion     = errors.New("backtest binding mismatch")
	ErrUnsupported = errors.New("unsupported backtest policy or direction")
)

type Failure struct {
	Stage string
	Err   error
}

func (err *Failure) Error() string { return "backtest authorization failed at " + err.Stage }
func (err *Failure) Unwrap() error { return err.Err }

type SignalInput struct {
	ComputeGrantID       string                  `json:"compute_grant_id"`
	FeatureSchemaVersion string                  `json:"feature_schema_version"`
	PolicyVersion        string                  `json:"policy_version"`
	Candidates           []core.FeatureCandidate `json:"candidates"`
}

type SignalResult struct {
	core.DecisionResult
	PolicyVersion string               `json:"policy_version"`
	Entries       []core.BacktestEntry `json:"entries"`
}

type Service struct {
	Features dataset.FeatureAuthorizer
	Datasets dataset.Repository
	Compute  compute.Repository
	Rules    compute.RuleReader
}

func (service Service) Signals(ctx context.Context, owner, sessionID string, input SignalInput) (SignalResult, error) {
	if input.ComputeGrantID == "" || len(input.Candidates) < 1 || len(input.Candidates) > core.MaxBacktestCandles {
		return SignalResult{}, ErrInvalid
	}
	if input.PolicyVersion != core.BacktestPolicyVersion || input.FeatureSchemaVersion != core.FeatureSchemaVersion {
		return SignalResult{}, ErrUnsupported
	}
	if err := service.Features.RequireFeature(ctx, owner, entitlement.FeatureBacktest); err != nil {
		return SignalResult{}, &Failure{"access", err}
	}
	grant, err := service.Compute.Verify(ctx, owner, sessionID, input.ComputeGrantID)
	if err != nil {
		return SignalResult{}, &Failure{"grant", err}
	}
	if grant.Purpose != "backtest" || grant.EngineVersion != core.EngineVersion || grant.SchemaVersion != core.SchemaVersion {
		return SignalResult{}, ErrVersion
	}
	content, manifest, err := service.Datasets.Content(ctx, owner, grant.DatasetID)
	if err != nil {
		return SignalResult{}, &Failure{"dataset", err}
	}
	if manifest.Purpose != "backtest" || manifest.DatasetID != grant.DatasetID || manifest.Version != grant.DatasetVersion || manifest.Checksum != grant.DatasetChecksum || manifest.Backtest == nil || manifest.Backtest.Mode != "rule" || manifest.Backtest.RuleID != grant.RuleID || manifest.Timeframe != "1d" {
		return SignalResult{}, ErrVersion
	}
	resolver := screener.AuthorizationService{Rules: service.Rules}
	rule, err := resolver.ResolveRule(ctx, screener.Binding{UserID: owner, RuleID: grant.RuleID, DefinitionHash: grant.DefinitionHash, EngineVersion: grant.EngineVersion, SchemaVersion: grant.SchemaVersion})
	if err != nil {
		return SignalResult{}, &Failure{"rule", err}
	}
	if rule.SignalType != "BUY" {
		return SignalResult{}, ErrUnsupported
	}
	var payload struct {
		Series []core.BacktestSeries `json:"series"`
	}
	if json.Unmarshal(content, &payload) != nil {
		return SignalResult{}, dataset.ErrIntegrity
	}
	symbol := input.Candidates[0].Symbol
	var candles []core.Candle
	for _, series := range payload.Series {
		if series.Symbol == symbol {
			candles = series.Candles
			break
		}
	}
	// Require every eligible timestamp, including warmup/exit buffers. Splitting a
	// symbol would reset crossover/cooldown and silently change the result.
	if len(candles) < 20 || len(candles) > core.MaxBacktestCandles || len(input.Candidates) != len(candles)-19 {
		return SignalResult{}, ErrInvalid
	}
	for i, candidate := range input.Candidates {
		got, e1 := time.Parse(time.RFC3339, candidate.Timestamp)
		want, e2 := time.Parse(time.RFC3339, candles[i+19].Timestamp)
		if candidate.Symbol != symbol || e1 != nil || e2 != nil || !got.Equal(want) {
			return SignalResult{}, ErrInvalid
		}
	}
	decision, err := core.EvaluateBacktestDecision(core.DecisionRequest{Rule: rule, Candidates: input.Candidates}, manifest.Backtest.From, manifest.Backtest.To)
	if err != nil {
		return SignalResult{}, ErrInvalid
	}
	if err := ctx.Err(); err != nil {
		return SignalResult{}, err
	}
	result := SignalResult{DecisionResult: decision, PolicyVersion: core.BacktestPolicyVersion, Entries: []core.BacktestEntry{}}
	for _, signal := range decision.Signals {
		result.Entries = append(result.Entries, core.BacktestEntry{Symbol: signal.Symbol, Timestamp: signal.Timestamp, SignalType: "BUY"})
	}
	return result, nil
}
