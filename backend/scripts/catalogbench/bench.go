package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
)

const warmupCandles = 250

var benchRules = []core.RuleSnapshot{
	{Name: "Bearish MA Cross", Logic: "AND", SignalType: "SELL", Conditions: []core.Condition{{Left: "MA9", Op: "CROSS_DOWN", Right: "MA20"}}},
	{Name: "Close above MA5 with rising volume", Logic: "AND", SignalType: "BUY", Conditions: []core.Condition{{Left: "CLOSE", Op: ">", Right: "MA5"}, {Left: "VOLUME", Op: ">", Right: "VOLUME_PREV_1"}}},
}

type stageTotals struct {
	features, decision, study time.Duration
	symbols, signals, events  int
	skipped                   int
}

// bench replays the product's per-batch stages (features -> private rule
// decision -> signal study, ten symbols per batch) on saved history.
func bench(dataDir, from, to string, steps int) error {
	start, err := time.Parse("2006-01-02", from)
	if err != nil {
		return fmt.Errorf("invalid -from")
	}
	end, err := time.Parse("2006-01-02", to)
	if err != nil || end.Before(start) {
		return fmt.Errorf("invalid -to")
	}
	files, err := filepath.Glob(filepath.Join(dataDir, "*.json"))
	if err != nil {
		return err
	}
	sort.Strings(files)
	loadStart := time.Now()
	var all []core.BacktestSeries
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			return err
		}
		var series marketdata.Series
		if err := json.Unmarshal(raw, &series); err != nil {
			return fmt.Errorf("%s: %w", file, err)
		}
		if candles := window(series.Candles, start, end, steps); candles != nil {
			all = append(all, core.BacktestSeries{Symbol: series.Symbol, Candles: candles})
		}
	}
	loadTime := time.Since(loadStart)
	fmt.Printf("files=%d usable=%d load=%s window=%s..%s steps=%d\n", len(files), len(all), loadTime.Round(time.Millisecond), from, to, steps)
	tp, sl := 2.0, 1.0
	config := core.SignalStudyConfig{From: from, To: to, NSteps: steps, TakeProfitPct: &tp, StopLossPct: &sl}
	for _, rule := range benchRules {
		totals, err := runRule(rule, all, config)
		if err != nil {
			return fmt.Errorf("%s: %w", rule.Name, err)
		}
		total := totals.features + totals.decision + totals.study
		fmt.Printf("rule=%q symbols=%d skipped=%d signals=%d events=%d features=%s decision=%s study=%s compute_total=%s\n",
			rule.Name, totals.symbols, totals.skipped, totals.signals, totals.events,
			totals.features.Round(time.Millisecond), totals.decision.Round(time.Millisecond), totals.study.Round(time.Millisecond), total.Round(time.Millisecond))
	}
	return nil
}

// window keeps warmup before the study start and N candles after its end,
// mirroring the frozen snapshot shape without fetching beyond that.
func window(candles []core.Candle, start, end time.Time, steps int) []core.Candle {
	first, last := -1, -1
	for i, candle := range candles {
		stamp, err := time.Parse(time.RFC3339, candle.Timestamp)
		if err != nil {
			return nil
		}
		day := stamp.UTC().Truncate(24 * time.Hour)
		if first < 0 && !day.Before(start) {
			first = i
		}
		if !day.After(end) {
			last = i
		}
	}
	if first < 0 || last < first {
		return nil
	}
	lo, hi := max(0, first-warmupCandles), min(len(candles), last+steps+1)
	return candles[lo:hi]
}

func runRule(rule core.RuleSnapshot, all []core.BacktestSeries, config core.SignalStudyConfig) (stageTotals, error) {
	var totals stageTotals
	operands := core.RequiredOperands(rule)
	for batchStart := 0; batchStart < len(all); batchStart += 10 {
		batch := all[batchStart:min(len(all), batchStart+10)]
		var series []core.BacktestSeries
		var entries []core.BacktestEntry
		for _, s := range batch {
			t := time.Now()
			features, err := core.ComputeBacktestFeatures(core.FeatureRequest{Operands: operands, Purpose: "backtest", Symbol: s.Symbol, Candles: s.Candles})
			totals.features += time.Since(t)
			if err != nil {
				totals.skipped++
				continue
			}
			t = time.Now()
			decision, err := core.EvaluateBacktestDecision(core.DecisionRequest{Rule: rule, Candidates: features.Candidates}, config.From, config.To)
			totals.decision += time.Since(t)
			if err != nil {
				return totals, fmt.Errorf("%s decision: %w", s.Symbol, err)
			}
			totals.symbols++
			series = append(series, s)
			for _, signal := range decision.Signals {
				entries = append(entries, core.BacktestEntry{Symbol: signal.Symbol, Timestamp: signal.Timestamp, SignalType: signal.SignalType})
			}
		}
		if len(series) == 0 {
			continue
		}
		totals.signals += len(entries)
		t := time.Now()
		result, err := core.RunSignalStudy(core.SignalStudyRequest{SchemaVersion: core.SignalStudySchema, Config: config, Series: series, Entries: entries})
		totals.study += time.Since(t)
		if err != nil {
			return totals, fmt.Errorf("study batch %d: %w", batchStart/10, err)
		}
		totals.events += len(result.Events)
	}
	return totals, nil
}
