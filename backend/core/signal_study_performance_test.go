package core

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"os"
	"runtime"
	"sort"
	"testing"
	"time"
)

type studyPerfCase struct {
	ID      string             `json:"id"`
	Request SignalStudyRequest `json:"request"`
}
type studyPerfGolden struct {
	ID           string `json:"id"`
	InputSHA256  string `json:"input_sha256"`
	OutputSHA256 string `json:"output_sha256,omitempty"`
	Error        string `json:"error,omitempty"`
}

func studyPerfRequest(symbols, candles, stride, steps, seed, year int, targets bool) SignalStudyRequest {
	rng := rand.New(rand.NewSource(int64(seed)))
	r := SignalStudyRequest{SchemaVersion: SignalStudySchema, Config: SignalStudyConfig{NSteps: steps}}
	start := time.Date(year, 1, 1, 12, 0, 0, 123456789, time.UTC)
	first := max(19, candles-281)
	r.Config.From = start.AddDate(0, 0, first).Format("2006-01-02")
	r.Config.To = start.AddDate(0, 0, candles-1).Format("2006-01-02")
	if targets {
		tp, sl := 5., 3.
		r.Config.TakeProfitPct = &tp
		r.Config.StopLossPct = &sl
	}
	for s := 0; s < symbols; s++ {
		series := BacktestSeries{Symbol: fmt.Sprintf("TEST%02d", s), Timezone: "UTC"}
		for i := 0; i < candles; i++ {
			price := 100 + float64(rng.Intn(1000))/10
			stamp := start.AddDate(0, 0, i)
			// Equivalent instants exercise offsets and nanoseconds without UnixNano keys.
			location := time.FixedZone("fixture", (s%3-1)*3600)
			series.Candles = append(series.Candles, Candle{Timestamp: stamp.In(location).Format(time.RFC3339Nano), Open: price, High: price + float64(i%11), Low: price - float64(i%7), Close: price, Volume: int64(100 + i)})
			if i >= first && (i-first)%stride == 0 {
				side := "BUY"
				if (s+i)%2 != 0 {
					side = "SELL"
				}
				r.Entries = append(r.Entries, BacktestEntry{Symbol: series.Symbol, Timestamp: stamp.In(time.FixedZone("entry", -5*3600)).Format(time.RFC3339Nano), SignalType: side})
			}
		}
		r.Series = append(r.Series, series)
	}
	rng.Shuffle(len(r.Entries), func(i, j int) { r.Entries[i], r.Entries[j] = r.Entries[j], r.Entries[i] })
	return r
}
func studyPerfCases() []studyPerfCase {
	cases := []studyPerfCase{
		{"sparse_10x300_h5", studyPerfRequest(10, 300, 28, 5, 1, 2025, false)},
		{"dense_10x300_h5", studyPerfRequest(10, 300, 1, 5, 2, 2025, true)},
		{"dense_10x1000_h5", studyPerfRequest(10, 1000, 1, 5, 3, 2023, true)},
		{"sparse_10x2500_h100", studyPerfRequest(10, 2500, 70, 100, 4, 2018, false)},
	}
	for seed := 5; seed < 17; seed++ {
		cases = append(cases, studyPerfCase{fmt.Sprintf("random_%d", seed), studyPerfRequest(1+seed%3, 25+seed*7, 1+seed%4, 1+seed%10, seed, 2024, seed%2 == 0)})
	}
	for _, year := range []int{1, 9998} {
		cases = append(cases, studyPerfCase{fmt.Sprintf("year_%d", year), studyPerfRequest(1, 30, 1, 3, year, year, true)})
	}
	empty := studyPerfRequest(1, 25, 1, 2, 99, 2024, true)
	empty.Entries = nil
	cases = append(cases, studyPerfCase{"empty_target", empty})
	empty.Config.TakeProfitPct = nil
	cases = append(cases, studyPerfCase{"empty_no_target", empty})
	invalid := func(id string, change func(*SignalStudyRequest)) {
		r := studyPerfRequest(1, 30, 1, 3, 100, 2024, true)
		change(&r)
		cases = append(cases, studyPerfCase{id, r})
	}
	invalid("invalid_timestamp", func(r *SignalStudyRequest) { r.Entries[0].Timestamp = "bad" })
	invalid("duplicate_instant", func(r *SignalStudyRequest) { r.Entries = append(r.Entries, r.Entries[0]) })
	invalid("unknown_symbol", func(r *SignalStudyRequest) { r.Entries[0].Symbol = "MISSING" })
	invalid("invalid_side", func(r *SignalStudyRequest) { r.Entries[0].SignalType = "HOLD" })
	invalid("warmup", func(r *SignalStudyRequest) { r.Entries[0].Timestamp = r.Series[0].Candles[18].Timestamp })
	invalid("invalid_series", func(r *SignalStudyRequest) { r.Series[0].Candles[21].Timestamp = r.Series[0].Candles[20].Timestamp })
	invalid("invalid_schema", func(r *SignalStudyRequest) { r.SchemaVersion = "old" })
	invalid("outside_range", func(r *SignalStudyRequest) { r.Entries[0].Timestamp = "2020-01-01T00:00:00Z" })
	invalid("not_exact_nanosecond", func(r *SignalStudyRequest) {
		stamp, _ := time.Parse(time.RFC3339Nano, r.Entries[0].Timestamp)
		r.Entries[0].Timestamp = stamp.Add(time.Nanosecond).Format(time.RFC3339Nano)
	})
	return cases
}
func perfHash(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return fmt.Sprintf("%x", sha256.Sum256(raw))
}
func TestSignalStudyPerformanceCanonicalGolden(t *testing.T) {
	cases := studyPerfCases()
	actual := make([]studyPerfGolden, 0, len(cases))
	for _, c := range cases {
		result, err := RunSignalStudy(c.Request)
		g := studyPerfGolden{ID: c.ID, InputSHA256: perfHash(c.Request)}
		if err != nil {
			g.Error = err.Error()
		} else {
			g.OutputSHA256 = perfHash(result)
		}
		actual = append(actual, g)
	}
	if path := os.Getenv("SIGNALGEN_STUDY_FIXTURES"); path != "" {
		raw, _ := json.Marshal(struct {
			Cases  []studyPerfCase   `json:"cases"`
			Golden []studyPerfGolden `json:"golden"`
		}{cases, actual})
		if err := os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if path := os.Getenv("SIGNALGEN_STUDY_FREEZE"); path != "" {
		raw, _ := json.MarshalIndent(actual, "", "  ")
		if err := os.WriteFile(path, append(raw, '\n'), 0600); err != nil {
			t.Fatal(err)
		}
		return
	}
	raw, err := os.ReadFile("testdata/signal_study_performance_golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var expected []studyPerfGolden
	if err := json.Unmarshal(raw, &expected); err != nil {
		t.Fatal(err)
	}
	if perfHash(actual) != perfHash(expected) {
		t.Fatalf("complete canonical result/error hashes changed\nactual=%s\nexpected=%s", mustJSON(actual), raw)
	}
}
func mustJSON(v any) string { raw, _ := json.Marshal(v); return string(raw) }
func BenchmarkSignalStudyPerformance(b *testing.B) {
	for _, c := range studyPerfCases()[:4] {
		b.Run(c.ID, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				if _, err := RunSignalStudy(c.Request); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
func TestSignalStudyPerformanceSamples(t *testing.T) {
	path := os.Getenv("SIGNALGEN_STUDY_PERF_OUTPUT")
	if path == "" {
		t.Skip("opt-in synthetic engine timings")
	}
	rows := []map[string]any{}
	for _, c := range studyPerfCases()[:4] {
		for i := 0; i < 3; i++ {
			if _, err := RunSignalStudy(c.Request); err != nil {
				t.Fatal(err)
			}
		}
		samples, allocs, mallocs := []float64{}, []uint64{}, []uint64{}
		for i := 0; i < 15; i++ {
			var before, after runtime.MemStats
			runtime.ReadMemStats(&before)
			start := time.Now()
			out, err := RunSignalStudy(c.Request)
			elapsed := float64(time.Since(start).Nanoseconds()) / 1e6
			runtime.KeepAlive(out)
			runtime.ReadMemStats(&after)
			if err != nil {
				t.Fatal(err)
			}
			samples = append(samples, elapsed)
			allocs = append(allocs, after.TotalAlloc-before.TotalAlloc)
			mallocs = append(mallocs, after.Mallocs-before.Mallocs)
		}
		sorted := append([]float64(nil), samples...)
		sort.Float64s(sorted)
		rows = append(rows, map[string]any{"id": c.ID, "symbols": len(c.Request.Series), "candles_per_symbol": len(c.Request.Series[0].Candles), "entries": len(c.Request.Entries), "steps": c.Request.Config.NSteps, "samples": 15, "warmups": 3, "median_ms": sorted[int(math.Ceil(float64(len(sorted))*.5))-1], "p95_ms": sorted[int(math.Ceil(float64(len(sorted))*.95))-1], "raw_ms": samples, "raw_process_alloc_bytes": allocs, "raw_process_mallocs": mallocs, "input_sha256": perfHash(c.Request)})
	}
	report := map[string]any{"go": runtime.Version(), "os": runtime.GOOS, "arch": runtime.GOARCH, "gomaxprocs": runtime.GOMAXPROCS(0), "cases": rows, "allocation_note": "process-wide allocation deltas around engine call; includes internal final JSON validation; excludes fixture generation and external hash/serialization; not peak RSS"}
	raw, _ := json.Marshal(report)
	if err := os.WriteFile(path, append(raw, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
}
