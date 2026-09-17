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
		Indicators:          []string{"PRICE", "EMA9", "EMA20", "RSI14"},
		Operators:           []string{"<", "<=", ">", ">="},
		RuleLogic:           []string{"AND"},
		MaxCandlesPerRun:    MaxCandlesPerRun,
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
	if request.Rule.Logic != "AND" {
		return fmt.Errorf("unsupported rule logic %q", request.Rule.Logic)
	}
	if request.Rule.SignalType == "" {
		return fmt.Errorf("signal_type is required")
	}
	if len(request.Rule.Conditions) == 0 {
		return fmt.Errorf("at least one condition is required")
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

	for _, condition := range request.Rule.Conditions {
		if !supportedOperands[condition.Left] {
			return fmt.Errorf("unsupported left operand %q", condition.Left)
		}
		if !supportedOperators[condition.Op] {
			return fmt.Errorf("unsupported operator %q", condition.Op)
		}
		if right, ok := condition.Right.(string); ok && !supportedOperands[right] {
			if _, err := strconv.ParseFloat(right, 64); err != nil {
				return fmt.Errorf("unsupported right operand %q", right)
			}
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
