package core

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"
)

type indicatorBenchmarkCase struct {
	ID       string   `json:"id"`
	Purpose  string   `json:"purpose"`
	Symbols  int      `json:"symbols"`
	Candles  int      `json:"candles"`
	Operands []string `json:"operands"`
}

// Integer-only synthetic OHLCV also used by the browser harness. Setup and JSON
// are outside the timed region; ns/op covers an entire sequential stock batch.
func benchmarkCandles(n int) []Candle {
	result := make([]Candle, n)
	for i := range result {
		base := 10000 + (i*37)%601 + (i%7)*10
		open, close := base+((i%5)-2)*5, base+((i%11)-5)*3
		result[i] = Candle{Timestamp: time.Date(2016, 1, 1+i, 0, 0, 0, 0, time.UTC).Format(time.RFC3339), Open: float64(open), Close: float64(close), High: float64(max(open, close) + 10 + i%7), Low: float64(min(open, close) - 10 - i%5), Volume: int64(1000 + (i*113)%10000)}
	}
	return result
}

func BenchmarkIndicatorBatch(b *testing.B) {
	raw, err := os.ReadFile("testdata/indicator_benchmark_cases.json")
	if err != nil {
		b.Fatal(err)
	}
	var cases []indicatorBenchmarkCase
	if err = json.Unmarshal(raw, &cases); err != nil {
		b.Fatal(err)
	}
	for _, c := range cases {
		b.Run(c.ID, func(b *testing.B) {
			requests := make([]FeatureRequest, c.Symbols)
			for i := range requests {
				requests[i] = FeatureRequest{Purpose: c.Purpose, Symbol: fmt.Sprintf("TEST%d", i), Candles: benchmarkCandles(c.Candles), Operands: c.Operands}
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				for _, request := range requests {
					var result FeatureResult
					var err error
					if c.Purpose == "backtest" {
						result, err = ComputeBacktestFeatures(request)
					} else {
						result, err = ComputeFeatures(request)
					}
					if err != nil || len(result.Candidates) != c.Candles-19 {
						b.Fatalf("invalid benchmark result: %v", err)
					}
				}
			}
		})
	}
}

var benchmarkTrioSink float64

// Isolate the three always-computed formulas. This excludes validation, JSON,
// feature assembly and worker startup, so it is not an end-to-end saving estimate.
func BenchmarkLegacyIndicatorMath(b *testing.B) {
	for _, n := range []int{100, 2500} {
		b.Run(fmt.Sprint(n), func(b *testing.B) {
			candles := benchmarkCandles(n)
			closes := make([]float64, n)
			for i, c := range candles {
				closes[i] = c.Close
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				a, _ := emaSeries(closes, 9)
				c, _ := emaSeries(closes, 20)
				r, _ := rsiSeries(closes, 14)
				benchmarkTrioSink = a[n-1] + c[n-1] + r[n-1]
			}
		})
	}
}
