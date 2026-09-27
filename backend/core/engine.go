package core

import (
	"fmt"
	"math"
	"strconv"
	"time"
)

var supportedOperands = map[string]bool{
	"PRICE": true,
	"EMA9":  true,
	"EMA20": true,
	"RSI14": true,
}

var supportedOperators = map[string]bool{
	">":  true,
	"<":  true,
	">=": true,
	"<=": true,
}

// GetCapabilities returns a fresh value so callers cannot mutate shared
// slices and accidentally change the advertised contract.
func GetCapabilities() Capabilities {
	return Capabilities{
		CapabilitiesVersion:  CapabilitiesVersion,
		EngineVersion:        EngineVersion,
		SchemaVersion:        SchemaVersion,
		FeatureSchemaVersion: FeatureSchemaVersion,
		DecisionVersion:      DecisionVersion,
		PrivateProtocol:      PrivateProtocol,
		WorkerProtocol:       WorkerProtocol,
		Purposes:             []string{"screen"},
		Markets:              []string{"IDX"},
		Timeframes:           []string{"1d"},
		Indicators:           []string{"PRICE", "EMA9", "EMA20", "RSI14"},
		Operators:            []string{"<", "<=", ">", ">="},
		RuleLogic:            []string{"AND"},
		MaxCandlesPerRun:     MaxCandlesPerRun,
		MaxSymbolsPerRun:     1,
	}
}

// GetBaselineRuleDefinition returns a fresh definition so API or WASM callers
// cannot mutate the frozen system rule shared by later requests.
func GetBaselineRuleDefinition() BaselineRuleDefinition {
	return BaselineRuleDefinition{
		ID: 1, Name: "Default Scalping", Type: "system", Logic: "AND", SignalType: "BUY", CooldownSec: 60,
		Conditions: []Condition{
			{Left: "EMA9", Op: ">", Right: "EMA20"},
			{Left: "PRICE", Op: ">", Right: "EMA9"},
			{Left: "RSI14", Op: ">", Right: 45},
			{Left: "RSI14", Op: "<", Right: 75},
		},
	}
}

// RunSignals executes the frozen M0 subset. It intentionally produces signals
// only; trade fills and P&L remain outside this baseline until their policy is
// selected and frozen separately.
func RunSignals(request RunRequest) (RunResult, error) {
	features, err := ComputeFeatures(FeatureRequest{
		Purpose: request.Purpose,
		Symbol:  request.Symbol,
		Candles: request.Candles,
	})
	if err != nil {
		return RunResult{}, err
	}
	decision, err := EvaluateDecision(DecisionRequest{
		Rule:       request.Rule,
		Candidates: features.Candidates,
	})
	if err != nil {
		return RunResult{}, err
	}

	return RunResult{
		EngineVersion: EngineVersion,
		SchemaVersion: SchemaVersion,
		Execution:     "portable_go",
		Signals:       decision.Signals,
		CandleCount:   len(request.Candles),
		Warnings:      []string{"signal-only baseline; trade fills and P&L are not defined"},
	}, nil
}

// ComputeFeatures performs the expensive indicator calculation intended for
// the client/WASM stage. It does not receive or evaluate a rule.
func ComputeFeatures(request FeatureRequest) (FeatureResult, error) {
	if err := validateFeatureRequest(request); err != nil {
		return FeatureResult{}, err
	}

	closes := make([]float64, len(request.Candles))
	for i, candle := range request.Candles {
		closes[i] = candle.Close
	}

	ema9, _ := emaSeries(closes, 9)
	ema20, _ := emaSeries(closes, 20)
	rsi14, _ := rsiSeries(closes, 14)

	candidates := make([]FeatureCandidate, 0, len(request.Candles))
	for i, candle := range request.Candles {
		// The Python IndicatorEngine deliberately requires period+1 candles for
		// RSI14, while EMA20 is available from candle 20.
		if i+1 < 15 || math.IsNaN(ema9[i]) || math.IsNaN(ema20[i]) || math.IsNaN(rsi14[i]) {
			continue
		}
		candidates = append(candidates, FeatureCandidate{
			Symbol:    request.Symbol,
			Timestamp: candle.Timestamp,
			Features: FeatureVector{
				Price: candle.Close,
				EMA9:  ema9[i],
				EMA20: ema20[i],
				RSI14: rsi14[i],
			},
		})
	}

	return FeatureResult{
		EngineVersion:        EngineVersion,
		FeatureSchemaVersion: FeatureSchemaVersion,
		Execution:            "client_go_features",
		Candidates:           candidates,
		CandleCount:          len(request.Candles),
		Warnings:             []string{},
	}, nil
}

// EvaluateDecision applies the rule and cooldown to compact feature candidates.
// This is the small stage proposed to remain private on the server.
func EvaluateDecision(request DecisionRequest) (DecisionResult, error) {
	if err := ValidateRule(request.Rule); err != nil {
		return DecisionResult{}, err
	}
	if err := validateCandidates(request.Candidates); err != nil {
		return DecisionResult{}, err
	}

	signals := make([]Signal, 0)
	var lastSignal time.Time
	for _, candidate := range request.Candidates {
		parsed, _ := time.Parse(time.RFC3339, candidate.Timestamp)
		if !lastSignal.IsZero() && parsed.Sub(lastSignal) < time.Duration(request.Rule.CooldownSec)*time.Second {
			continue
		}
		values := map[string]float64{
			"PRICE": candidate.Features.Price,
			"EMA9":  candidate.Features.EMA9,
			"EMA20": candidate.Features.EMA20,
			"RSI14": candidate.Features.RSI14,
		}
		matched, err := evaluateRule(request.Rule, values)
		if err != nil {
			return DecisionResult{}, err
		}
		if !matched {
			continue
		}
		signals = append(signals, Signal{
			Symbol:     candidate.Symbol,
			Timestamp:  candidate.Timestamp,
			SignalType: request.Rule.SignalType,
			Price:      candidate.Features.Price,
			Indicators: IndicatorValues{
				Price: candidate.Features.Price,
				EMA9:  candidate.Features.EMA9,
				EMA20: candidate.Features.EMA20,
				RSI14: candidate.Features.RSI14,
			},
		})
		lastSignal = parsed
	}

	return DecisionResult{
		DecisionVersion: DecisionVersion,
		Signals:         signals,
		CandidateCount:  len(request.Candidates),
	}, nil
}

func validateFeatureRequest(request FeatureRequest) error {
	if request.Purpose != "screen" {
		return fmt.Errorf("unsupported purpose %q; supported purposes: screen", request.Purpose)
	}
	if request.Symbol == "" {
		return fmt.Errorf("symbol is required")
	}
	if len(request.Candles) < 20 {
		return fmt.Errorf("at least 20 completed candles are required")
	}
	if len(request.Candles) > MaxCandlesPerRun {
		return fmt.Errorf("candle count exceeds limit of %d", MaxCandlesPerRun)
	}

	var previous time.Time
	for i, candle := range request.Candles {
		parsed, err := time.Parse(time.RFC3339, candle.Timestamp)
		if err != nil {
			return fmt.Errorf("candle %d has invalid RFC3339 timestamp: %w", i, err)
		}
		if i > 0 && !parsed.After(previous) {
			return fmt.Errorf("candles must be strictly chronological")
		}
		previous = parsed
		if candle.Open <= 0 || candle.High <= 0 || candle.Low <= 0 || candle.Close <= 0 {
			return fmt.Errorf("candle %d contains a non-positive price", i)
		}
		if candle.High < candle.Open || candle.High < candle.Close || candle.Low > candle.Open || candle.Low > candle.Close {
			return fmt.Errorf("candle %d has inconsistent OHLC values", i)
		}
	}

	return nil
}

func validateCandidates(candidates []FeatureCandidate) error {
	if len(candidates) == 0 {
		return fmt.Errorf("at least one feature candidate is required")
	}
	if len(candidates) > MaxCandlesPerRun {
		return fmt.Errorf("candidate count exceeds limit of %d", MaxCandlesPerRun)
	}
	var previous time.Time
	var symbol string
	for i, candidate := range candidates {
		if candidate.Symbol == "" {
			return fmt.Errorf("candidate %d symbol is required", i)
		}
		if i == 0 {
			symbol = candidate.Symbol
		} else if candidate.Symbol != symbol {
			return fmt.Errorf("candidate %d symbol %q does not match %q", i, candidate.Symbol, symbol)
		}
		parsed, err := time.Parse(time.RFC3339, candidate.Timestamp)
		if err != nil {
			return fmt.Errorf("candidate %d has invalid RFC3339 timestamp: %w", i, err)
		}
		if i > 0 && !parsed.After(previous) {
			return fmt.Errorf("feature candidates must be strictly chronological")
		}
		previous = parsed
		values := []float64{
			candidate.Features.Price,
			candidate.Features.EMA9,
			candidate.Features.EMA20,
			candidate.Features.RSI14,
		}
		for _, value := range values {
			if math.IsNaN(value) || math.IsInf(value, 0) {
				return fmt.Errorf("candidate %d contains a non-finite feature", i)
			}
		}
		if candidate.Features.Price <= 0 || candidate.Features.EMA9 <= 0 || candidate.Features.EMA20 <= 0 {
			return fmt.Errorf("candidate %d contains a non-positive price feature", i)
		}
		if candidate.Features.RSI14 < 0 || candidate.Features.RSI14 > 100 {
			return fmt.Errorf("candidate %d RSI14 must be between 0 and 100", i)
		}
	}
	return nil
}

// ValidateRule is the shared validation boundary for persisted user rules and
// portable execution. It accepts only the subset advertised by capabilities.
func ValidateRule(rule RuleSnapshot) error {
	if len(rule.Name) == 0 || len(rule.Name) > 100 {
		return fmt.Errorf("rule name must contain 1 to 100 characters")
	}
	if rule.Logic != "AND" {
		return fmt.Errorf("unsupported rule logic %q", rule.Logic)
	}
	if rule.SignalType != "BUY" {
		return fmt.Errorf("unsupported signal_type %q", rule.SignalType)
	}
	if rule.CooldownSec < 0 || rule.CooldownSec > 86400 {
		return fmt.Errorf("cooldown_sec must be between 0 and 86400")
	}
	if len(rule.Conditions) == 0 || len(rule.Conditions) > 20 {
		return fmt.Errorf("rule must contain 1 to 20 conditions")
	}
	for _, condition := range rule.Conditions {
		if !supportedOperands[condition.Left] {
			return fmt.Errorf("unsupported left operand %q", condition.Left)
		}
		if !supportedOperators[condition.Op] {
			return fmt.Errorf("unsupported operator %q", condition.Op)
		}
		switch right := condition.Right.(type) {
		case string:
			if !supportedOperands[right] {
				parsed, err := strconv.ParseFloat(right, 64)
				if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
					return fmt.Errorf("unsupported right operand %q", right)
				}
			}
		case float64:
			if math.IsNaN(right) || math.IsInf(right, 0) {
				return fmt.Errorf("right operand must be finite")
			}
		case int:
			// Programmatic callers may use int; JSON numbers decode as float64.
		default:
			return fmt.Errorf("unsupported right value type %T", condition.Right)
		}
	}
	return nil
}

func evaluateRule(rule RuleSnapshot, values map[string]float64) (bool, error) {
	for _, condition := range rule.Conditions {
		left := values[condition.Left]
		right, err := resolveValue(condition.Right, values)
		if err != nil {
			return false, err
		}
		matched := false
		switch condition.Op {
		case ">":
			matched = left > right
		case "<":
			matched = left < right
		case ">=":
			matched = left >= right
		case "<=":
			matched = left <= right
		default:
			return false, fmt.Errorf("unsupported operator %q", condition.Op)
		}
		if !matched {
			return false, nil
		}
	}
	return true, nil
}

func resolveValue(raw interface{}, values map[string]float64) (float64, error) {
	switch value := raw.(type) {
	case float64:
		return value, nil
	case int:
		return float64(value), nil
	case string:
		if resolved, ok := values[value]; ok {
			return resolved, nil
		}
		parsed, err := strconv.ParseFloat(value, 64)
		if err != nil {
			return 0, fmt.Errorf("unsupported right operand %q", value)
		}
		return parsed, nil
	default:
		return 0, fmt.Errorf("unsupported right value type %T", raw)
	}
}
