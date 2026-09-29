package core

import (
	"encoding/json"
	"math"
	"strconv"
	"sync"
	"testing"
)

type modelBPayload struct {
	Closes     []float64                `json:"closes"`
	Candidates []modelBFeatureCandidate `json:"candidates"`
}

type modelBFeatureCandidate struct {
	Symbol    string              `json:"symbol"`
	Timestamp string              `json:"timestamp"`
	Features  modelBFeatureVector `json:"features"`
}

type modelBFeatureVector struct {
	Price float64 `json:"price"`
	EMA9  float64 `json:"ema9"`
	EMA20 float64 `json:"ema20"`
}

func TestSplitModelsMatchFrozenBaseline(t *testing.T) {
	fixture := loadFixture(t)
	features, err := ComputeFeatures(FeatureRequest{
		Purpose: fixture.Request.Purpose, Symbol: fixture.Request.Symbol, Candles: fixture.Request.Candles,
	})
	if err != nil {
		t.Fatal(err)
	}
	modelA, err := EvaluateDecision(DecisionRequest{Rule: fixture.Request.Rule, Candidates: features.Candidates})
	if err != nil {
		t.Fatal(err)
	}
	closes := candleCloses(fixture.Request.Candles)
	withoutRSI := candidatesWithoutRSI(features.Candidates)
	modelB, err := evaluateModelBServerRSI(closes, withoutRSI, fixture.Request.Rule)
	if err != nil {
		t.Fatal(err)
	}
	if len(modelA.Signals) != len(modelB.Signals) || len(modelA.Signals) != len(fixture.Expected.Signals) {
		t.Fatalf("signal counts: model A=%d model B=%d expected=%d", len(modelA.Signals), len(modelB.Signals), len(fixture.Expected.Signals))
	}
	for i := range modelA.Signals {
		if modelA.Signals[i].Timestamp != modelB.Signals[i].Timestamp ||
			math.Abs(modelA.Signals[i].Indicators.RSI14-modelB.Signals[i].Indicators.RSI14) > 1e-9 {
			t.Fatalf("signal %d mismatch: model A=%+v model B=%+v", i, modelA.Signals[i], modelB.Signals[i])
		}
	}

	modelAJSON, err := json.Marshal(features.Candidates)
	if err != nil {
		t.Fatal(err)
	}
	modelBJSON, err := json.Marshal(modelBPayload{Closes: closes, Candidates: withoutRSI})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("wire bytes: model_A=%d model_B=%d", len(modelAJSON), len(modelBJSON))
}

func BenchmarkSplitModelADecisionKernel(b *testing.B) {
	fixture := loadFixture(b)
	features, err := ComputeFeatures(FeatureRequest{
		Purpose: fixture.Request.Purpose, Symbol: fixture.Request.Symbol, Candles: fixture.Request.Candles,
	})
	if err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		if _, err := EvaluateDecision(DecisionRequest{Rule: fixture.Request.Rule, Candidates: features.Candidates}); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkSplitModelBServerRSI(b *testing.B) {
	fixture := loadFixture(b)
	features, err := ComputeFeatures(FeatureRequest{
		Purpose: fixture.Request.Purpose, Symbol: fixture.Request.Symbol, Candles: fixture.Request.Candles,
	})
	if err != nil {
		b.Fatal(err)
	}
	closes := candleCloses(fixture.Request.Candles)
	withoutRSI := candidatesWithoutRSI(features.Candidates)
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		if _, err := evaluateModelBServerRSI(closes, withoutRSI, fixture.Request.Rule); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkSplitModelAConcurrentBatches measures only the private decision
// kernel plus goroutine scheduling. It is not an HTTP/WebSocket capacity claim.
func BenchmarkSplitModelAConcurrentBatches(b *testing.B) {
	fixture := loadFixture(b)
	features, err := ComputeFeatures(FeatureRequest{
		Purpose: fixture.Request.Purpose, Symbol: fixture.Request.Symbol, Candles: fixture.Request.Candles,
	})
	if err != nil {
		b.Fatal(err)
	}
	for _, sessions := range []int{1, 10, 30} {
		b.Run("sessions_"+strconv.Itoa(sessions), func(b *testing.B) {
			b.ReportMetric(float64(sessions), "sessions/batch")
			b.ResetTimer()
			for range b.N {
				var wait sync.WaitGroup
				wait.Add(sessions)
				for range sessions {
					go func() {
						defer wait.Done()
						if _, decisionErr := EvaluateDecision(DecisionRequest{
							Rule: fixture.Request.Rule, Candidates: features.Candidates,
						}); decisionErr != nil {
							panic(decisionErr)
						}
					}()
				}
				wait.Wait()
			}
		})
	}
}

func evaluateModelBServerRSI(closes []float64, candidates []modelBFeatureCandidate, rule RuleSnapshot) (DecisionResult, error) {
	rsi, err := rsiSeries(closes, 14)
	if err != nil {
		return DecisionResult{}, err
	}
	if len(candidates) > len(rsi) {
		return DecisionResult{}, errInvalidExperimentInput
	}
	start := len(rsi) - len(candidates)
	withRSI := make([]FeatureCandidate, len(candidates))
	for i, candidate := range candidates {
		withRSI[i] = FeatureCandidate{
			Symbol: candidate.Symbol, Timestamp: candidate.Timestamp,
			Features: FeatureVector{
				Price: candidate.Features.Price, EMA9: candidate.Features.EMA9,
				EMA20: candidate.Features.EMA20, RSI14: rsi[start+i],
			},
		}
	}
	return EvaluateDecision(DecisionRequest{Rule: rule, Candidates: withRSI})
}

var errInvalidExperimentInput = &splitExperimentError{}

type splitExperimentError struct{}

func (*splitExperimentError) Error() string { return "invalid split experiment input" }

func candleCloses(candles []Candle) []float64 {
	closes := make([]float64, len(candles))
	for i, candle := range candles {
		closes[i] = candle.Close
	}
	return closes
}

func candidatesWithoutRSI(candidates []FeatureCandidate) []modelBFeatureCandidate {
	result := make([]modelBFeatureCandidate, len(candidates))
	for i, candidate := range candidates {
		result[i] = modelBFeatureCandidate{
			Symbol: candidate.Symbol, Timestamp: candidate.Timestamp,
			Features: modelBFeatureVector{
				Price: candidate.Features.Price, EMA9: candidate.Features.EMA9, EMA20: candidate.Features.EMA20,
			},
		}
	}
	return result
}
