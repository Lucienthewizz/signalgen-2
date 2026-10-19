package core

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// supportedOperands mendaftarkan seluruh variabel indikator teknikal yang didukung oleh engine M0.
// Nilai indikator ini dihasilkan pada tahap ComputeFeatures (client/WASM).
var supportedOperands = map[string]bool{
	"PRICE": true,
	"EMA9":  true,
	"EMA20": true,
	"RSI14": true,
}

// supportedOperators mendaftarkan seluruh operator pembanding matematis dan persilangan (crossover) yang sah.
// Operator kesetaraan persis (==) sengaja ditiadakan untuk menghindari galat floating-point IEEE 754.
var supportedOperators = map[string]bool{
	">":          true,
	"<":          true,
	">=":         true,
	"<=":         true,
	"CROSS_UP":   true,
	"CROSS_DOWN": true,
}

// GetCapabilities mengembalikan salinan baru profil kapabilitas engine.
// Mengembalikan nilai baru (bukan referensi) agar pemanggil tidak dapat memutasi slice bersama secara tidak sengaja.
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
		Markets:              []string{"IDX", "US"},
		Timeframes:           []string{"1d"},
		Indicators:           []string{"PRICE", "EMA9", "EMA20", "RSI14"},
		Operators:            []string{"<", "<=", ">", ">=", "CROSS_UP", "CROSS_DOWN"},
		RuleLogic:            []string{"AND", "OR"},
		SignalTypes:          []string{"BUY", "SELL"},
		MaxCandlesPerRun:     MaxCandlesPerRun,
		MaxSymbolsPerRun:     1,
	}
}

// GetBaselineRuleDefinition mengembalikan salinan aturan bawaan ("Default Scalping") yang dibekukan untuk baseline sistem.
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

// RunSignals mengeksekusi pipeline sinyal lengkap untuk pengujian baseline M0.
// Fungsi ini hanya menghasilkan sinyal masuk (BUY); eksekusi trade fill dan P&L
// berada di luar baseline ini hingga kebijakan eksekusi dibekukan terpisah.
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

// ComputeFeatures melakukan kalkulasi indikator teknikal (EMA9, EMA20, RSI14).
// Fungsi ini dirancang untuk berjalan di sisi client/WASM sehingga server tidak perlu
// mengolah data candle mentah yang berat. Fungsi ini tidak menerima aturan pengguna.
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
		// Mengikuti Python IndicatorEngine: RSI14 membutuhkan periode+1 (15) candle,
		// sedangkan EMA20 mulai tersedia sejak candle ke-20.
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

// EvaluateDecision mengevaluasi aturan screening pengguna dan status jeda waktu (cooldown)
// terhadap kandidat fitur ringkas. Tahap ini dijalankan secara privat di server agar
// logika strategi pengguna tidak pernah bocor ke publik atau client lain.
func EvaluateDecision(request DecisionRequest) (DecisionResult, error) {
	if err := ValidateRule(request.Rule); err != nil {
		return DecisionResult{}, err
	}
	if err := validateCandidates(request.Candidates); err != nil {
		return DecisionResult{}, err
	}

	signals := make([]Signal, 0)
	evaluations := make([]CandidateEvaluation, 0, len(request.Candidates))
	var lastSignal time.Time
	var prevValues map[string]float64
	for _, candidate := range request.Candidates {
		parsed, _ := time.Parse(time.RFC3339, candidate.Timestamp)
		values := map[string]float64{
			"PRICE": candidate.Features.Price,
			"EMA9":  candidate.Features.EMA9,
			"EMA20": candidate.Features.EMA20,
			"RSI14": candidate.Features.RSI14,
		}
		// Lolos kondisi belum menentukan arah transaksi: BUY/SELL berasal dari rule.
		// Cooldown masih dapat menahan sinyal meskipun kondisi matematika terpenuhi.
		matched, err := evaluateRule(request.Rule, values, prevValues)
		if err != nil {
			return DecisionResult{}, err
		}
		prevValues = values
		if !matched {
			evaluations = append(evaluations, CandidateEvaluation{
				Symbol:      candidate.Symbol,
				Timestamp:   candidate.Timestamp,
				Matched:     false,
				ReasonCodes: []string{"CONDITIONS_NOT_MET"},
			})
			continue
		}
		if !lastSignal.IsZero() && parsed.Sub(lastSignal) < time.Duration(request.Rule.CooldownSec)*time.Second {
			evaluations = append(evaluations, CandidateEvaluation{
				Symbol:      candidate.Symbol,
				Timestamp:   candidate.Timestamp,
				Matched:     false,
				ReasonCodes: []string{"COOLDOWN_ACTIVE"},
			})
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
		evaluations = append(evaluations, CandidateEvaluation{
			Symbol:      candidate.Symbol,
			Timestamp:   candidate.Timestamp,
			Matched:     true,
			SignalType:  request.Rule.SignalType,
			ReasonCodes: []string{"RULE_MATCHED"},
		})
		lastSignal = parsed
	}

	return DecisionResult{
		DecisionVersion: DecisionVersion,
		Signals:         signals,
		CandidateCount:  len(request.Candidates),
		Evaluations:     evaluations,
	}, nil
}

// validateFeatureRequest memvalidasi integritas candle mentah yang diterima untuk penghitungan fitur:
// minimal 20 candle, kronologis strictly ascending, harga OHLC positif, dan hubungan High >= Low konsisten.
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

// validateCandidates memverifikasi validitas data kandidat fitur sebelum dievaluasi oleh aturan:
// memastikan simbol konsisten, nilai indikator finite (bukan NaN/Inf), harga/EMA positif, dan RSI 0-100.
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

// ValidateRule adalah gerbang validasi bersama untuk penyimpanan aturan kustom dan eksekusi screening.
// Menjamin aturan sesuai spesifikasi kontrak kapabilitas: nama valid, logika AND/OR, cooldown sah,
// batas nilai indikator (RSI 0-100, harga > 0), serta mencegah perbandingan kontradiktif dengan diri sendiri.
func ValidateRule(rule RuleSnapshot) error {
	trimmedName := strings.TrimSpace(rule.Name)
	if len(trimmedName) == 0 || len(rule.Name) > 100 {
		return fmt.Errorf("rule name must contain 1 to 100 characters")
	}
	if rule.Logic != "AND" && rule.Logic != "OR" {
		return fmt.Errorf("unsupported rule logic %q; supported: AND, OR", rule.Logic)
	}
	if rule.SignalType != "BUY" && rule.SignalType != "SELL" {
		return fmt.Errorf("unsupported signal_type %q; supported: BUY, SELL", rule.SignalType)
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

		numericVal, isNumeric, err := extractNumericThreshold(condition.Right)
		if err != nil {
			return err
		}

		if isNumeric {
			if condition.Left == "RSI14" {
				if numericVal < 0 || numericVal > 100 {
					return fmt.Errorf("RSI14 threshold must be between 0 and 100; got %v", numericVal)
				}
			} else {
				// Ambang batas harga dan rata-rata bergerak (PRICE, EMA9, EMA20) wajib bernilai positif (> 0)
				if numericVal <= 0 {
					return fmt.Errorf("%s threshold must be greater than 0; got %v", condition.Left, numericVal)
				}
			}
		} else {
			// Operand kanan berupa indikator lain: tolak perbandingan variabel dengan dirinya sendiri
			rightOperand, _ := condition.Right.(string)
			if condition.Left == rightOperand {
				return fmt.Errorf("condition cannot compare operand %q with itself", condition.Left)
			}
		}
	}
	return nil
}

// extractNumericThreshold mengekstrak dan memvalidasi nilai angka dari berbagai tipe data Go
// (float64, float32, int, int32, int64, uint, uint32, uint64, json.Number, string).
func extractNumericThreshold(raw interface{}) (float64, bool, error) {
	switch right := raw.(type) {
	case string:
		if supportedOperands[right] {
			return 0, false, nil
		}
		parsed, err := strconv.ParseFloat(right, 64)
		if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
			return 0, false, fmt.Errorf("unsupported right operand %q", right)
		}
		return parsed, true, nil
	case float64:
		if math.IsNaN(right) || math.IsInf(right, 0) {
			return 0, false, fmt.Errorf("right operand must be finite")
		}
		return right, true, nil
	case float32:
		val := float64(right)
		if math.IsNaN(val) || math.IsInf(val, 0) {
			return 0, false, fmt.Errorf("right operand must be finite")
		}
		return val, true, nil
	case int:
		return float64(right), true, nil
	case int32:
		return float64(right), true, nil
	case int64:
		return float64(right), true, nil
	case uint:
		return float64(right), true, nil
	case uint32:
		return float64(right), true, nil
	case uint64:
		return float64(right), true, nil
	case json.Number:
		parsed, err := right.Float64()
		if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
			return 0, false, fmt.Errorf("right operand must be finite")
		}
		return parsed, true, nil
	default:
		return 0, false, fmt.Errorf("unsupported right value type %T", raw)
	}
}

// evaluateRule mengevaluasi seluruh kondisi dalam aturan terhadap nilai kandidat saat ini dan sebelumnya:
// - Logika "OR": Mengembalikan true jika ada MINIMAL SATU kondisi yang cocok (short-circuit).
// - Logika "AND": Mengembalikan true HANYA JIKA SEMUA kondisi cocok (gagal jika ada satu kondisi false).
func evaluateRule(rule RuleSnapshot, values map[string]float64, prevValues map[string]float64) (bool, error) {
	if len(rule.Conditions) == 0 {
		return false, fmt.Errorf("rule must contain at least one condition")
	}
	if rule.Logic == "OR" {
		for _, condition := range rule.Conditions {
			matched, err := evaluateCondition(condition, values, prevValues)
			if err != nil {
				return false, err
			}
			if matched {
				return true, nil
			}
		}
		return false, nil
	}
	for _, condition := range rule.Conditions {
		matched, err := evaluateCondition(condition, values, prevValues)
		if err != nil {
			return false, err
		}
		if !matched {
			return false, nil
		}
	}
	return true, nil
}

// evaluateCondition mengevaluasi perbandingan satu kondisi individual (misal: PRICE > EMA9 atau EMA9 CROSS_UP EMA20).
// Untuk operator persilangan (CROSS_UP dan CROSS_DOWN), fungsi membandingkan posisi relatif pada candle saat ini
// terhadap candle sebelumnya (prevValues). Jika candle sebelumnya tidak ada (misal candle pertama),
// kondisi persilangan akan mengembalikan false karena belum ada data riwayat persilangan.
func evaluateCondition(condition Condition, values map[string]float64, prevValues map[string]float64) (bool, error) {
	left := values[condition.Left]
	right, err := resolveValue(condition.Right, values)
	if err != nil {
		return false, err
	}
	switch condition.Op {
	case ">":
		return left > right, nil
	case "<":
		return left < right, nil
	case ">=":
		return left >= right, nil
	case "<=":
		return left <= right, nil
	case "CROSS_UP":
		if prevValues == nil {
			return false, nil
		}
		prevLeft := prevValues[condition.Left]
		prevRight, err := resolveValue(condition.Right, prevValues)
		if err != nil {
			return false, err
		}
		return prevLeft <= prevRight && left > right, nil
	case "CROSS_DOWN":
		if prevValues == nil {
			return false, nil
		}
		prevLeft := prevValues[condition.Left]
		prevRight, err := resolveValue(condition.Right, prevValues)
		if err != nil {
			return false, err
		}
		return prevLeft >= prevRight && left < right, nil
	default:
		return false, fmt.Errorf("unsupported operator %q", condition.Op)
	}
}

// resolveValue mengambil nilai aktual dari operand kanan:
// baik dengan mencari nilai variabel indikator dari map kandidat, maupun mengonversi konstanta numerik.
func resolveValue(raw interface{}, values map[string]float64) (float64, error) {
	switch value := raw.(type) {
	case float64:
		return value, nil
	case float32:
		return float64(value), nil
	case int:
		return float64(value), nil
	case int32:
		return float64(value), nil
	case int64:
		return float64(value), nil
	case uint:
		return float64(value), nil
	case uint32:
		return float64(value), nil
	case uint64:
		return float64(value), nil
	case json.Number:
		parsed, err := value.Float64()
		if err != nil {
			return 0, fmt.Errorf("unsupported right operand %q", value)
		}
		return parsed, nil
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
