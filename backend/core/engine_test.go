package core

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"testing"
)

func TestBaselineRuleDefinitionMatchesFrozenHash(t *testing.T) {
	definition := GetBaselineRuleDefinition()
	raw, err := json.Marshal(definition)
	if err != nil {
		t.Fatal(err)
	}
	var canonical interface{}
	if err := json.Unmarshal(raw, &canonical); err != nil {
		t.Fatal(err)
	}
	var canonicalBuffer bytes.Buffer
	encoder := json.NewEncoder(&canonicalBuffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(canonical); err != nil {
		t.Fatal(err)
	}
	canonicalRaw := bytes.TrimSpace(canonicalBuffer.Bytes())
	hash := sha256.Sum256(canonicalRaw)
	if actual := fmt.Sprintf("sha256:%x", hash); actual != BaselineRuleHash {
		t.Fatalf("definition hash = %q, want %q; canonical = %s", actual, BaselineRuleHash, canonicalRaw)
	}
	if definition.Type != "system" || len(definition.Conditions) != 4 {
		t.Fatalf("definition = %+v", definition)
	}
}

func TestValidateRuleAcceptsOnlyAdvertisedSubset(t *testing.T) {
	valid := RuleSnapshot{
		Name: "User rule", Logic: "AND", SignalType: "BUY", CooldownSec: 60,
		Conditions: []Condition{{Left: "EMA9", Op: ">", Right: "EMA20"}},
	}
	if err := ValidateRule(valid); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*RuleSnapshot){
		"logic":           func(rule *RuleSnapshot) { rule.Logic = "XOR" },
		"signal":          func(rule *RuleSnapshot) { rule.SignalType = "HOLD" },
		"left":            func(rule *RuleSnapshot) { rule.Conditions[0].Left = "MACD" },
		"operator":        func(rule *RuleSnapshot) { rule.Conditions[0].Op = "==" },
		"right type":      func(rule *RuleSnapshot) { rule.Conditions[0].Right = true },
		"self comparison": func(rule *RuleSnapshot) { rule.Conditions[0].Right = "EMA9" },
		"rsi over 100":    func(rule *RuleSnapshot) { rule.Conditions[0] = Condition{Left: "RSI14", Op: ">", Right: 105} },
		"rsi negative":    func(rule *RuleSnapshot) { rule.Conditions[0] = Condition{Left: "RSI14", Op: "<", Right: -5} },
		"price non-pos":   func(rule *RuleSnapshot) { rule.Conditions[0] = Condition{Left: "PRICE", Op: ">", Right: 0} },
		"price negative":  func(rule *RuleSnapshot) { rule.Conditions[0] = Condition{Left: "PRICE", Op: ">", Right: -10} },
		"ema non-pos":     func(rule *RuleSnapshot) { rule.Conditions[0] = Condition{Left: "EMA9", Op: ">", Right: 0} },
		"whitespace name": func(rule *RuleSnapshot) { rule.Name = "   " },
		"empty name":      func(rule *RuleSnapshot) { rule.Name = "" },
	} {
		t.Run(name, func(t *testing.T) {
			candidate := valid
			candidate.Conditions = append([]Condition(nil), valid.Conditions...)
			mutate(&candidate)
			if err := ValidateRule(candidate); err == nil {
				t.Fatalf("invalid rule accepted: %+v", candidate)
			}
		})
	}
}

type baselineFixture struct {
	Request  RunRequest `json:"request"`
	Expected struct {
		Signals []Signal `json:"signals"`
	} `json:"expected"`
}

func loadFixture(t testing.TB) baselineFixture {
	t.Helper()
	raw, err := os.ReadFile("testdata/default_scalping_v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture baselineFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}

func TestDefaultScalpingGoldenSignals(t *testing.T) {
	fixture := loadFixture(t)
	result, err := RunSignals(fixture.Request)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Signals) != len(fixture.Expected.Signals) {
		t.Fatalf("signal count = %d, want %d", len(result.Signals), len(fixture.Expected.Signals))
	}
	for i, signal := range result.Signals {
		expected := fixture.Expected.Signals[i]
		if signal.Timestamp != expected.Timestamp {
			t.Errorf("signal %d timestamp = %s, want %s", i, signal.Timestamp, expected.Timestamp)
		}
		if math.Abs(signal.Price-expected.Price) > 1e-9 {
			t.Errorf("signal %d price = %.12f, want %.12f", i, signal.Price, expected.Price)
		}
		assertClose(t, "EMA9", signal.Indicators.EMA9, expected.Indicators.EMA9)
		assertClose(t, "EMA20", signal.Indicators.EMA20, expected.Indicators.EMA20)
		assertClose(t, "RSI14", signal.Indicators.RSI14, expected.Indicators.RSI14)
	}
}

func TestHybridSplitMatchesFrozenGoldenSignals(t *testing.T) {
	fixture := loadFixture(t)
	features, err := ComputeFeatures(FeatureRequest{
		Purpose: fixture.Request.Purpose,
		Symbol:  fixture.Request.Symbol,
		Candles: fixture.Request.Candles,
	})
	if err != nil {
		t.Fatal(err)
	}
	if features.FeatureSchemaVersion != FeatureSchemaVersion {
		t.Fatalf("feature schema = %q, want %q", features.FeatureSchemaVersion, FeatureSchemaVersion)
	}
	if features.CandleCount != len(fixture.Request.Candles) || len(features.Candidates) == 0 {
		t.Fatalf("feature result = %+v", features)
	}
	encoded, err := json.Marshal(features)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encoded, []byte(`"conditions"`)) || bytes.Contains(encoded, []byte(`"rule"`)) {
		t.Fatalf("client feature payload leaked a rule: %s", encoded)
	}

	decision, err := EvaluateDecision(DecisionRequest{
		Rule:       fixture.Request.Rule,
		Candidates: features.Candidates,
	})
	if err != nil {
		t.Fatal(err)
	}
	if decision.DecisionVersion != DecisionVersion {
		t.Fatalf("decision version = %q, want %q", decision.DecisionVersion, DecisionVersion)
	}
	if len(decision.Signals) != len(fixture.Expected.Signals) {
		t.Fatalf("signal count = %d, want %d", len(decision.Signals), len(fixture.Expected.Signals))
	}
	for i, signal := range decision.Signals {
		expected := fixture.Expected.Signals[i]
		if signal.Symbol != expected.Symbol || signal.Timestamp != expected.Timestamp || signal.SignalType != expected.SignalType {
			t.Errorf("signal %d identity = %+v, want %+v", i, signal, expected)
		}
		assertClose(t, "PRICE", signal.Price, expected.Price)
		assertClose(t, "EMA9", signal.Indicators.EMA9, expected.Indicators.EMA9)
		assertClose(t, "EMA20", signal.Indicators.EMA20, expected.Indicators.EMA20)
		assertClose(t, "RSI14", signal.Indicators.RSI14, expected.Indicators.RSI14)
	}
}

func TestEvaluateDecisionRejectsUntrustedFeaturePayloads(t *testing.T) {
	fixture := loadFixture(t)
	features, err := ComputeFeatures(FeatureRequest{
		Purpose: fixture.Request.Purpose,
		Symbol:  fixture.Request.Symbol,
		Candles: fixture.Request.Candles,
	})
	if err != nil {
		t.Fatal(err)
	}

	for name, mutate := range map[string]func([]FeatureCandidate){
		"mixed symbol": func(candidates []FeatureCandidate) {
			candidates[len(candidates)-1].Symbol = "TLKM.JK"
		},
		"unordered timestamp": func(candidates []FeatureCandidate) {
			candidates[1].Timestamp = candidates[0].Timestamp
		},
		"invalid RSI": func(candidates []FeatureCandidate) {
			candidates[0].Features.RSI14 = 101
		},
		"non-finite value": func(candidates []FeatureCandidate) {
			candidates[0].Features.EMA9 = math.NaN()
		},
	} {
		t.Run(name, func(t *testing.T) {
			candidates := append([]FeatureCandidate(nil), features.Candidates...)
			mutate(candidates)
			if _, err := EvaluateDecision(DecisionRequest{Rule: fixture.Request.Rule, Candidates: candidates}); err == nil {
				t.Fatalf("invalid candidates accepted: %+v", candidates)
			}
		})
	}
}

func TestCapabilitiesDescribeImplementedSubset(t *testing.T) {
	capabilities := GetCapabilities()
	if capabilities.EngineVersion != EngineVersion {
		t.Fatalf("engine version = %q, want %q", capabilities.EngineVersion, EngineVersion)
	}
	if len(capabilities.Purposes) != 1 || capabilities.Purposes[0] != "screen" {
		t.Fatalf("purposes = %v, want [screen]", capabilities.Purposes)
	}
	if capabilities.MaxCandlesPerRun != 100000 {
		t.Fatalf("max candles = %d, want 100000", capabilities.MaxCandlesPerRun)
	}
	if len(capabilities.Markets) != 2 || capabilities.Markets[0] != "IDX" || capabilities.Markets[1] != "US" {
		t.Fatalf("markets = %v, want [IDX US]", capabilities.Markets)
	}
	if len(capabilities.Timeframes) != 1 || capabilities.Timeframes[0] != "1d" {
		t.Fatalf("timeframes = %v, want [1d]", capabilities.Timeframes)
	}
}

func assertClose(t *testing.T, name string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-9 {
		t.Errorf("%s = %.12f, want %.12f", name, got, want)
	}
}

func TestRunSignalsRejectsUnsupportedOperand(t *testing.T) {
	fixture := loadFixture(t)
	fixture.Request.Rule.Conditions[0].Left = "MACD"
	if _, err := RunSignals(fixture.Request); err == nil {
		t.Fatal("expected unsupported operand error")
	}
}

func TestRunSignalsRejectsBacktestUntilTradePolicyExists(t *testing.T) {
	fixture := loadFixture(t)
	fixture.Request.Purpose = "backtest"
	if _, err := RunSignals(fixture.Request); err == nil {
		t.Fatal("expected unsupported backtest purpose error")
	}
}

func TestRunSignalsRejectsUnorderedCandles(t *testing.T) {
	fixture := loadFixture(t)
	fixture.Request.Candles[1].Timestamp = fixture.Request.Candles[0].Timestamp
	if _, err := RunSignals(fixture.Request); err == nil {
		t.Fatal("expected chronological validation error")
	}
}

func TestValidateRuleAcceptsORLogic(t *testing.T) {
	rule := RuleSnapshot{
		Name: "OR Strategy", Logic: "OR", SignalType: "BUY", CooldownSec: 60,
		Conditions: []Condition{
			{Left: "PRICE", Op: ">", Right: 100},
			{Left: "RSI14", Op: "<", Right: 30},
		},
	}
	if err := ValidateRule(rule); err != nil {
		t.Fatalf("expected OR logic to be accepted, got error: %v", err)
	}
}

func TestEvaluateDecisionSupportsORLogic(t *testing.T) {
	rule := RuleSnapshot{
		Name: "OR Strategy", Logic: "OR", SignalType: "BUY", CooldownSec: 0,
		Conditions: []Condition{
			{Left: "PRICE", Op: ">", Right: 150},
			{Left: "RSI14", Op: "<", Right: 30},
		},
	}
	candidates := []FeatureCandidate{
		// Candidate 1: price > 150 (true), RSI < 30 (false) -> should match because OR
		{Symbol: "BBCA.JK", Timestamp: "2026-01-01T00:00:00Z", Features: FeatureVector{Price: 160, EMA9: 100, EMA20: 100, RSI14: 50}},
		// Candidate 2: price > 150 (false), RSI < 30 (true) -> should match because OR
		{Symbol: "BBCA.JK", Timestamp: "2026-01-02T00:00:00Z", Features: FeatureVector{Price: 120, EMA9: 100, EMA20: 100, RSI14: 25}},
		// Candidate 3: price > 150 (false), RSI < 30 (false) -> should NOT match
		{Symbol: "BBCA.JK", Timestamp: "2026-01-03T00:00:00Z", Features: FeatureVector{Price: 120, EMA9: 100, EMA20: 100, RSI14: 55}},
	}
	decision, err := EvaluateDecision(DecisionRequest{Rule: rule, Candidates: candidates})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(decision.Signals) != 2 {
		t.Fatalf("expected 2 signals, got %d", len(decision.Signals))
	}
	if len(decision.Evaluations) != 3 {
		t.Fatalf("expected 3 evaluations, got %d", len(decision.Evaluations))
	}
	if !decision.Evaluations[0].Matched || decision.Evaluations[0].ReasonCodes[0] != "RULE_MATCHED" {
		t.Fatalf("eval 0 want RULE_MATCHED, got %+v", decision.Evaluations[0])
	}
	if !decision.Evaluations[1].Matched || decision.Evaluations[1].ReasonCodes[0] != "RULE_MATCHED" {
		t.Fatalf("eval 1 want RULE_MATCHED, got %+v", decision.Evaluations[1])
	}
	if decision.Evaluations[2].Matched || decision.Evaluations[2].ReasonCodes[0] != "CONDITIONS_NOT_MET" {
		t.Fatalf("eval 2 want CONDITIONS_NOT_MET, got %+v", decision.Evaluations[2])
	}
}

func TestEvaluateDecisionMarksCooldownActive(t *testing.T) {
	rule := RuleSnapshot{
		Name: "Price Rule", Logic: "AND", SignalType: "BUY", CooldownSec: 60,
		Conditions: []Condition{
			{Left: "PRICE", Op: ">", Right: 100},
		},
	}
	candidates := []FeatureCandidate{
		// Candidate 1: price 150 -> matches rule and fires signal (lastSignal = 00:00)
		{Symbol: "BBCA.JK", Timestamp: "2026-01-01T00:00:00Z", Features: FeatureVector{Price: 150, EMA9: 100, EMA20: 100, RSI14: 50}},
		// Candidate 2: price 160 at 00:30 (30s later) -> conditions met, but in 60s cooldown -> COOLDOWN_ACTIVE
		{Symbol: "BBCA.JK", Timestamp: "2026-01-01T00:00:30Z", Features: FeatureVector{Price: 160, EMA9: 100, EMA20: 100, RSI14: 50}},
		// Candidate 3: price 80 at 00:45 -> conditions not met -> CONDITIONS_NOT_MET
		{Symbol: "BBCA.JK", Timestamp: "2026-01-01T00:00:45Z", Features: FeatureVector{Price: 80, EMA9: 100, EMA20: 100, RSI14: 50}},
		// Candidate 4: price 170 at 01:10 (70s after Candidate 1) -> cooldown expired -> RULE_MATCHED
		{Symbol: "BBCA.JK", Timestamp: "2026-01-01T00:01:10Z", Features: FeatureVector{Price: 170, EMA9: 100, EMA20: 100, RSI14: 50}},
	}
	decision, err := EvaluateDecision(DecisionRequest{Rule: rule, Candidates: candidates})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(decision.Signals) != 2 {
		t.Fatalf("expected 2 signals, got %d", len(decision.Signals))
	}
	if len(decision.Evaluations) != 4 {
		t.Fatalf("expected 4 evaluations, got %d", len(decision.Evaluations))
	}
	// Candidate 1
	if !decision.Evaluations[0].Matched || decision.Evaluations[0].ReasonCodes[0] != "RULE_MATCHED" {
		t.Fatalf("eval 0: want RULE_MATCHED, got %+v", decision.Evaluations[0])
	}
	// Candidate 2
	if decision.Evaluations[1].Matched || decision.Evaluations[1].ReasonCodes[0] != "COOLDOWN_ACTIVE" {
		t.Fatalf("eval 1: want COOLDOWN_ACTIVE, got %+v", decision.Evaluations[1])
	}
	// Candidate 3
	if decision.Evaluations[2].Matched || decision.Evaluations[2].ReasonCodes[0] != "CONDITIONS_NOT_MET" {
		t.Fatalf("eval 2: want CONDITIONS_NOT_MET, got %+v", decision.Evaluations[2])
	}
	// Candidate 4
	if !decision.Evaluations[3].Matched || decision.Evaluations[3].ReasonCodes[0] != "RULE_MATCHED" {
		t.Fatalf("eval 3: want RULE_MATCHED, got %+v", decision.Evaluations[3])
	}
}

func TestValidateRuleAndEvaluateAcceptsWideNumericTypes(t *testing.T) {
	candidates := []FeatureCandidate{
		{Symbol: "BBCA.JK", Timestamp: "2026-01-01T00:00:00Z", Features: FeatureVector{Price: 150, EMA9: 100, EMA20: 100, RSI14: 65}},
	}

	testCases := []struct {
		name  string
		right interface{}
	}{
		{"float64", float64(50)},
		{"float32", float32(50)},
		{"int", int(50)},
		{"int32", int32(50)},
		{"int64", int64(50)},
		{"uint", uint(50)},
		{"uint32", uint32(50)},
		{"uint64", uint64(50)},
		{"json.Number", json.Number("50")},
		{"numeric string", "50"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			rule := RuleSnapshot{
				Name: "Numeric Rule", Logic: "AND", SignalType: "BUY", CooldownSec: 0,
				Conditions: []Condition{
					{Left: "RSI14", Op: ">", Right: tc.right},
				},
			}
			if err := ValidateRule(rule); err != nil {
				t.Fatalf("ValidateRule rejected valid numeric type %s: %v", tc.name, err)
			}
			res, err := EvaluateDecision(DecisionRequest{Rule: rule, Candidates: candidates})
			if err != nil {
				t.Fatalf("EvaluateDecision failed with %s: %v", tc.name, err)
			}
			if len(res.Signals) != 1 {
				t.Fatalf("expected 1 signal with %s, got %d", tc.name, len(res.Signals))
			}
		})
	}
}

func TestValidateRuleBoundaries(t *testing.T) {
	// RSI14 exactly at boundaries 0, 50, and 100 should be accepted
	for _, boundary := range []float64{0, 50, 100} {
		rule := RuleSnapshot{
			Name: "RSI Boundary", Logic: "AND", SignalType: "BUY", CooldownSec: 0,
			Conditions: []Condition{{Left: "RSI14", Op: ">=", Right: boundary}},
		}
		if err := ValidateRule(rule); err != nil {
			t.Fatalf("expected RSI14 with right=%v to be valid, got: %v", boundary, err)
		}
	}
	// PRICE and EMA exactly above 0 should be accepted
	rulePrice := RuleSnapshot{
		Name: "Price Valid", Logic: "AND", SignalType: "BUY", CooldownSec: 0,
		Conditions: []Condition{{Left: "PRICE", Op: ">", Right: 0.01}},
	}
	if err := ValidateRule(rulePrice); err != nil {
		t.Fatalf("expected PRICE with right=0.01 to be valid, got: %v", err)
	}
}

func TestValidateRuleAcceptsSELLSignalType(t *testing.T) {
	ruleSell := RuleSnapshot{
		Name: "Overbought Exit Rule", Logic: "AND", SignalType: "SELL", CooldownSec: 60,
		Conditions: []Condition{{Left: "RSI14", Op: ">", Right: 70}},
	}
	if err := ValidateRule(ruleSell); err != nil {
		t.Fatalf("expected SELL rule to be valid, got error: %v", err)
	}

	candidates := []FeatureCandidate{
		{Symbol: "BBCA.JK", Timestamp: "2026-01-01T00:00:00Z", Features: FeatureVector{Price: 150, EMA9: 100, EMA20: 100, RSI14: 75}},
	}
	res, err := EvaluateDecision(DecisionRequest{Rule: ruleSell, Candidates: candidates})
	if err != nil {
		t.Fatalf("EvaluateDecision failed for SELL rule: %v", err)
	}
	if len(res.Signals) != 1 {
		t.Fatalf("expected 1 SELL signal, got %d", len(res.Signals))
	}
	if res.Signals[0].SignalType != "SELL" {
		t.Fatalf("expected SignalType == 'SELL', got %q", res.Signals[0].SignalType)
	}
	if len(res.Evaluations) != 1 || res.Evaluations[0].SignalType != "SELL" {
		t.Fatalf("expected evaluation SignalType == 'SELL', got %+v", res.Evaluations)
	}
}


