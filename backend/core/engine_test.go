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

type baselineFixture struct {
	Request  RunRequest `json:"request"`
	Expected struct {
		Signals []Signal `json:"signals"`
	} `json:"expected"`
}

func loadFixture(t *testing.T) baselineFixture {
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
	if len(capabilities.Markets) != 1 || capabilities.Markets[0] != "IDX" {
		t.Fatalf("markets = %v, want [IDX]", capabilities.Markets)
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
