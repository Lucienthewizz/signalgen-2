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
		CapabilitiesVersion: CapabilitiesVersion,
		EngineVersion:       EngineVersion,
		SchemaVersion:       SchemaVersion,
		WorkerProtocol:      WorkerProtocol,
		Purposes:            []string{"screen"},
		Markets:             []string{"IDX"},
		Timeframes:          []string{"1d"},
		Indicators:          []string{"PRICE", "EMA9", "EMA20", "RSI14"},
		Operators:           []string{"<", "<=", ">", ">="},
		RuleLogic:           []string{"AND"},
		MaxCandlesPerRun:    MaxCandlesPerRun,
		MaxSymbolsPerRun:    1,
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
	if err := validateRequest(request); err != nil {
		return RunResult{}, err
	}

	closes := make([]float64, len(request.Candles))
	times := make([]time.Time, len(request.Candles))
	for i, candle := range request.Candles {
		closes[i] = candle.Close
		parsed, _ := time.Parse(time.RFC3339, candle.Timestamp)
		times[i] = parsed
	}

	ema9, _ := emaSeries(closes, 9)
	ema20, _ := emaSeries(closes, 20)
	rsi14, _ := rsiSeries(closes, 14)

	signals := make([]Signal, 0)
	var lastSignal time.Time
	for i, candle := range request.Candles {
		// The Python IndicatorEngine deliberately requires period+1 candles for
		// RSI14, while EMA20 is available from candle 20.
		if i+1 < 15 || math.IsNaN(ema9[i]) || math.IsNaN(ema20[i]) || math.IsNaN(rsi14[i]) {
			continue
		}
		if !lastSignal.IsZero() && times[i].Sub(lastSignal) < time.Duration(request.Rule.CooldownSec)*time.Second {
			continue
		}

		values := map[string]float64{
			"PRICE": candle.Close,
			"EMA9":  ema9[i],
			"EMA20": ema20[i],
			"RSI14": rsi14[i],
		}
		matched, err := evaluateRule(request.Rule, values)
		if err != nil {
			return RunResult{}, err
		}
		if !matched {
			continue
		}

		signals = append(signals, Signal{
			Symbol:     request.Symbol,
			Timestamp:  candle.Timestamp,
			SignalType: request.Rule.SignalType,
			Price:      candle.Close,
			Indicators: IndicatorValues{
				Price: candle.Close,
				EMA9:  ema9[i],
				EMA20: ema20[i],
				RSI14: rsi14[i],
			},
		})
		lastSignal = times[i]
	}

	return RunResult{
		EngineVersion: EngineVersion,
		SchemaVersion: SchemaVersion,
		Execution:     "portable_go",
		Signals:       signals,
		CandleCount:   len(request.Candles),
		Warnings:      []string{"signal-only baseline; trade fills and P&L are not defined"},
	}, nil
}

func validateRequest(request RunRequest) error {
	if request.Purpose != "screen" {
		return fmt.Errorf("unsupported purpose %q; supported purposes: screen", request.Purpose)
	}
	if request.Symbol == "" {
		return fmt.Errorf("symbol is required")
	}
	if err := ValidateRule(request.Rule); err != nil {
		return err
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
