// Local synthetic compute/admission experiment. Never connects to a provider,
// auth service or database. It does NOT establish production user capacity.
package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"math"
	"os"
	"runtime"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

type sample struct{ Total, Features, Decision float64 }
type quantile struct {
	P50 float64 `json:"p50_ms"`
	P95 float64 `json:"p95_ms"`
}

func stats(values []float64) quantile {
	if len(values) == 0 {
		return quantile{}
	}
	sort.Float64s(values)
	return quantile{values[int(math.Ceil(float64(len(values))*.5))-1], values[int(math.Ceil(float64(len(values))*.95))-1]}
}
func main() {
	const symbols, candleCount, capacity, trials = 10, 300, 32, 10
	requests := make([]core.FeatureRequest, symbols)
	precomputed := make([]core.FeatureResult, symbols)
	rule := core.RuleSnapshot{Name: "Frozen experiment", Logic: "AND", SignalType: "BUY", Conditions: []core.Condition{{Left: "PRICE", Op: ">", Right: "EMA20"}, {Left: "RSI14", Op: "<", Right: 80}}}
	for s := range requests {
		candles := make([]core.Candle, candleCount)
		for i := range candles {
			price := 100. + float64((i*37+s*11)%601)/10
			candles[i] = core.Candle{Timestamp: time.Date(2026, 1, 1+i, 0, 0, 0, 0, time.UTC).Format(time.RFC3339), Open: price, High: price + 3, Low: price - 3, Close: price + 1, Volume: int64(1000 + i)}
		}
		requests[s] = core.FeatureRequest{Purpose: "backtest", Symbol: fmt.Sprintf("TEST%02d", s), Candles: candles, Operands: core.RequiredOperands(rule)}
		var err error
		precomputed[s], err = core.ComputeBacktestFeatures(requests[s])
		if err != nil {
			panic(err)
		}
	}
	run := func(heavy bool) (sample, error) {
		start := time.Now()
		var result sample
		for i, r := range requests {
			features := precomputed[i]
			if heavy {
				t := time.Now()
				var err error
				features, err = core.ComputeBacktestFeatures(r)
				if err != nil {
					return result, err
				}
				result.Features += float64(time.Since(t).Nanoseconds()) / 1e6
			}
			t := time.Now()
			_, err := core.EvaluateBacktestDecision(core.DecisionRequest{Rule: rule, Candidates: features.Candidates}, "2026-09-01", "2026-09-30")
			if err != nil {
				return result, err
			}
			result.Decision += float64(time.Since(t).Nanoseconds()) / 1e6
		}
		result.Total = float64(time.Since(start).Nanoseconds()) / 1e6
		return result, nil
	}
	// Verify the two inputs produce identical private decisions before measuring.
	var signals int
	for i, r := range requests {
		f, _ := core.ComputeBacktestFeatures(r)
		a, e := core.EvaluateBacktestDecision(core.DecisionRequest{Rule: rule, Candidates: f.Candidates}, "2026-09-01", "2026-09-30")
		if e != nil {
			panic(e)
		}
		b, _ := core.EvaluateBacktestDecision(core.DecisionRequest{Rule: rule, Candidates: precomputed[i].Candidates}, "2026-09-01", "2026-09-30")
		aj, _ := json.Marshal(a)
		bj, _ := json.Marshal(b)
		if string(aj) != string(bj) {
			panic("different decisions")
		}
		signals += len(a.Signals)
	}
	raw, _ := json.Marshal(requests)
	featuresRaw, _ := json.Marshal(precomputed)
	ruleRaw, _ := json.Marshal(rule)
	inputHash := sha256.Sum256(raw)
	report := map[string]any{"kind": "local_synthetic_compute_admission", "timestamp": time.Now().UTC(), "go": runtime.Version(), "os": runtime.GOOS, "arch": runtime.GOARCH, "cpus": runtime.NumCPU(), "gomaxprocs": runtime.GOMAXPROCS(0), "symbols_per_request": symbols, "candles_per_symbol": candleCount, "input_sha256": fmt.Sprintf("%x", inputHash), "rule": json.RawMessage(ruleRaw), "matching_signals": signals, "raw_json_bytes_per_request": len(raw), "feature_json_bytes_per_request": len(featuresRaw), "admission_limit": capacity, "excluded": []string{"real auth/database/provider latency", "HTTP/JSON parse", "browser startup/compute/render", "physical devices", "production capacity"}}
	rows := []map[string]any{}
	for _, heavy := range []bool{true, false} {
		mode := "rule_only"
		if heavy {
			mode = "indicators_and_rule"
		}
		for i := 0; i < 5; i++ {
			if _, err := run(heavy); err != nil {
				panic(err)
			}
		}
		for _, clients := range []int{1, 10, 30, 100, 1000} {
			runtime.GC()
			var before, after runtime.MemStats
			runtime.ReadMemStats(&before)
			peak := atomic.Uint64{}
			peak.Store(before.HeapAlloc)
			done := make(chan struct{})
			var sampler sync.WaitGroup
			sampler.Add(1)
			go func() {
				defer sampler.Done()
				ticker := time.NewTicker(time.Millisecond)
				defer ticker.Stop()
				for {
					select {
					case <-done:
						return
					case <-ticker.C:
						var m runtime.MemStats
						runtime.ReadMemStats(&m)
						for old := peak.Load(); m.HeapAlloc > old && !peak.CompareAndSwap(old, m.HeapAlloc); old = peak.Load() {
						}
					}
				}
			}()
			slots := make(chan struct{}, capacity)
			results := make(chan sample, clients*trials)
			var rejected, failed atomic.Int64
			var work sync.WaitGroup
			wall := time.Now()
			for trial := 0; trial < trials; trial++ {
				start := make(chan struct{})
				for i := 0; i < clients; i++ {
					work.Add(1)
					go func() {
						defer work.Done()
						<-start
						select {
						case slots <- struct{}{}:
							defer func() { <-slots }()
						default:
							rejected.Add(1)
							return
						}
						s, err := run(heavy)
						if err != nil {
							failed.Add(1)
							return
						}
						results <- s
					}()
				}
				close(start)
				work.Wait()
			}
			close(results)
			close(done)
			sampler.Wait()
			runtime.ReadMemStats(&after)
			total, featureTime, decisionTime := []float64{}, []float64{}, []float64{}
			for s := range results {
				total = append(total, s.Total)
				featureTime = append(featureTime, s.Features)
				decisionTime = append(decisionTime, s.Decision)
			}
			rows = append(rows, map[string]any{"mode": mode, "logical_clients": clients, "trials": trials, "attempted": clients * trials, "accepted": len(total), "capacity_rejected": rejected.Load(), "errors": failed.Load(), "elapsed_ms": float64(time.Since(wall).Nanoseconds()) / 1e6, "latency": stats(total), "features": stats(featureTime), "decision": stats(decisionTime), "process_alloc_bytes": after.TotalAlloc - before.TotalAlloc, "process_alloc_count": after.Mallocs - before.Mallocs, "sampled_peak_go_heap_bytes": max(peak.Load(), after.HeapAlloc), "heap_before_bytes": before.HeapAlloc, "sample_interval_ms": 1})
		}
	}
	report["runs"] = rows
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(report); err != nil {
		panic(err)
	}
}
