package core

import (
	"encoding/json"
	"math"
	"testing"
)

func TestFeatureVectorJSONRequiresEveryNumberButAcceptsZeroRSI(t *testing.T) {
	for _, field := range []string{"price", "ema9", "ema20", "rsi14"} {
		for _, omit := range []bool{false, true} {
			input := map[string]any{"price": 100, "ema9": 99, "ema20": 98, "rsi14": 0}
			if omit {
				delete(input, field)
			} else {
				input[field] = nil
			}
			raw, _ := json.Marshal(input)
			var vector FeatureVector
			if err := json.Unmarshal(raw, &vector); err == nil {
				t.Fatalf("missing/null %s accepted: %s", field, raw)
			}
		}
	}
	var vector FeatureVector
	if err := json.Unmarshal([]byte(`{"price":100,"ema9":99,"ema20":98,"rsi14":0}`), &vector); err != nil || vector.RSI14 != 0 {
		t.Fatalf("legitimate zero RSI rejected: %+v %v", vector, err)
	}
}

func TestComputeFeaturesRejectsInvalidOHLCV(t *testing.T) {
	for name, mutate := range map[string]func(*Candle){
		"nan-open":        func(c *Candle) { c.Open = math.NaN() },
		"nan-high":        func(c *Candle) { c.High = math.NaN() },
		"nan-low":         func(c *Candle) { c.Low = math.NaN() },
		"nan-close":       func(c *Candle) { c.Close = math.NaN() },
		"infinite-high":   func(c *Candle) { c.High = math.Inf(1) },
		"infinite-low":    func(c *Candle) { c.Low = math.Inf(-1) },
		"negative-volume": func(c *Candle) { c.Volume = -1 },
	} {
		t.Run(name, func(t *testing.T) {
			input := loadFixture(t).Request
			mutate(&input.Candles[len(input.Candles)-1])
			if _, err := ComputeFeatures(FeatureRequest{Purpose: "screen", Symbol: input.Symbol, Candles: input.Candles}); err == nil {
				t.Fatal("invalid OHLCV returned successful features")
			}
		})
	}
	input := loadFixture(t).Request
	input.Candles[0].Volume = 0 // No trades is different from a negative volume.
	if _, err := ComputeFeatures(FeatureRequest{Purpose: "screen", Symbol: input.Symbol, Candles: input.Candles}); err != nil {
		t.Fatalf("zero volume rejected: %v", err)
	}
}
