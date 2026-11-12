package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"sort"
	"time"
)

const SignalStudySchema = "signal-study-1"
const SignalStudyPolicy = "signal-close-independent-1"

// Studies measure every signal independently; they do not allocate portfolio cash.
type SignalStudyConfig struct {
	From          string   `json:"from"`
	To            string   `json:"to"`
	NSteps        int      `json:"n_steps"`
	TakeProfitPct *float64 `json:"take_profit_pct,omitempty"`
	StopLossPct   *float64 `json:"stop_loss_pct,omitempty"`
}
type SignalStudyRequest struct {
	SchemaVersion string            `json:"schema_version"`
	Config        SignalStudyConfig `json:"config"`
	Series        []BacktestSeries  `json:"series"`
	Entries       []BacktestEntry   `json:"entries"`
}
type StudyOutcome struct {
	Basis     string   `json:"basis"`
	Step      int      `json:"step"`
	Status    string   `json:"status"`
	Price     *float64 `json:"price"`
	ReturnPct *float64 `json:"return_pct"`
	Timestamp string   `json:"timestamp,omitempty"`
}
type StudyEvent struct {
	Symbol         string         `json:"symbol"`
	Timestamp      string         `json:"timestamp"`
	SignalType     string         `json:"signal_type"`
	ReferencePrice float64        `json:"reference_price"`
	Outcomes       []StudyOutcome `json:"outcomes"`
	Swing          StudyOutcome   `json:"swing"`
}
type StudyMetrics struct {
	// Present only for window metrics with a configured TP; absent in older results.
	TargetHits *int     `json:"target_hits,omitempty"`
	Signals    int      `json:"signals"`
	Evaluated  int      `json:"evaluated"`
	Missing    int      `json:"missing"`
	Wins       int      `json:"wins"`
	Losses     int      `json:"losses"`
	Flats      int      `json:"flats"`
	SumReturn  float64  `json:"sum_return_pct"`
	MeanReturn *float64 `json:"mean_return_pct"`
	WinRate    *float64 `json:"win_rate"`
}
type StudyHorizon struct {
	Step  int    `json:"step"`
	Basis string `json:"basis"`
	StudyMetrics
}
type StudyGroup struct {
	Key string `json:"key"`
	StudyMetrics
}
type SignalStudyResult struct {
	SchemaVersion string            `json:"schema_version"`
	PolicyVersion string            `json:"policy_version"`
	Config        SignalStudyConfig `json:"config"`
	Events        []StudyEvent      `json:"events"`
	Horizons      []StudyHorizon    `json:"horizons"`
	Swing         StudyMetrics      `json:"swing"`
	BySymbol      []StudyGroup      `json:"by_symbol"`
	ByDay         []StudyGroup      `json:"by_day"`
	Warnings      []string          `json:"warnings"`
}

func ValidateSignalStudyConfig(c SignalStudyConfig) error {
	from, e1 := time.Parse("2006-01-02", c.From)
	to, e2 := time.Parse("2006-01-02", c.To)
	if e1 != nil || e2 != nil || to.Before(from) || to.After(from.AddDate(1, 0, 0)) || c.NSteps < 1 || c.NSteps > 100 {
		return fmt.Errorf("study requires an inclusive date range of at most one year and 1–100 trading candles")
	}
	for _, v := range []*float64{c.TakeProfitPct, c.StopLossPct} {
		if v != nil && (math.IsNaN(*v) || math.IsInf(*v, 0) || *v <= 0 || *v >= 100) {
			return fmt.Errorf("TP/SL must be positive percentages below 100")
		}
	}
	return nil
}

func DecodeSignalStudyRequest(raw []byte) (SignalStudyRequest, error) {
	var r SignalStudyRequest
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&r); err != nil {
		return r, err
	}
	if d.Decode(new(any)) != io.EOF {
		return r, fmt.Errorf("trailing study data")
	}
	return r, nil
}

func newStudyWindowMetrics(c SignalStudyConfig) *StudyMetrics {
	m := &StudyMetrics{}
	if c.TakeProfitPct != nil {
		m.TargetHits = new(int)
	}
	return m
}

func (m *StudyMetrics) add(o StudyOutcome) {
	m.Signals++
	if o.ReturnPct == nil {
		m.Missing++
		return
	}
	m.Evaluated++
	if m.TargetHits != nil && o.Status == "take_profit" {
		(*m.TargetHits)++
	}
	m.SumReturn += *o.ReturnPct
	if *o.ReturnPct > 0 {
		m.Wins++
	} else if *o.ReturnPct < 0 {
		m.Losses++
	} else {
		m.Flats++
	}
	mean, rate := m.SumReturn/float64(m.Evaluated), float64(m.Wins)/float64(m.Evaluated)*100
	m.MeanReturn, m.WinRate = &mean, &rate
}

func studyOutcome(basis string, step int, c Candle, ref, direction float64) StudyOutcome {
	price := c.Close
	switch basis {
	case "open":
		price = c.Open
	case "high":
		price = c.High
	case "low":
		price = c.Low
	}
	ret := direction * (price - ref) / ref * 100
	return StudyOutcome{Basis: basis, Step: step, Status: "evaluated", Price: &price, ReturnPct: &ret, Timestamp: c.Timestamp}
}

// A barrier touch is an OHLC observation, not a guaranteed broker fill.
func studySwing(candles []Candle, idx int, c SignalStudyConfig, direction float64) StudyOutcome {
	ref := candles[idx].Close
	for k := 1; k <= c.NSteps && idx+k < len(candles); k++ {
		bar := candles[idx+k]
		for _, barrier := range []struct {
			pct  *float64
			side float64
			name string
		}{{c.StopLossPct, -1, "stop_loss"}, {c.TakeProfitPct, 1, "take_profit"}} {
			if barrier.pct == nil {
				continue
			}
			level := direction * barrier.side * (*barrier.pct) / 100
			price := ref * (1 + level)
			upper := direction*barrier.side > 0
			if (upper && bar.High >= price) || (!upper && bar.Low <= price) {
				ret := barrier.side * *barrier.pct
				return StudyOutcome{Basis: "barrier", Step: k, Status: barrier.name, Price: &price, ReturnPct: &ret, Timestamp: bar.Timestamp}
			}
		}
	}
	if idx+c.NSteps >= len(candles) {
		return StudyOutcome{Basis: "close", Step: c.NSteps, Status: "incomplete"}
	}
	o := studyOutcome("close", c.NSteps, candles[idx+c.NSteps], ref, direction)
	o.Status = "time_exit"
	return o
}

func RunSignalStudy(r SignalStudyRequest) (SignalStudyResult, error) {
	var out SignalStudyResult
	if r.SchemaVersion != SignalStudySchema {
		return out, fmt.Errorf("unsupported signal study schema")
	}
	if err := ValidateSignalStudyConfig(r.Config); err != nil {
		return out, err
	}
	if len(r.Series) < 1 || len(r.Series) > 10 || len(r.Entries) > 10*MaxBacktestCandles {
		return out, fmt.Errorf("study batch exceeds limits")
	}
	series := map[string][]Candle{}
	for _, s := range r.Series {
		if series[s.Symbol] != nil || len(s.Candles) > MaxBacktestCandles || (s.Timezone != "" && s.Timezone != "UTC") {
			return out, fmt.Errorf("invalid study series")
		}
		if err := validateFeatureRequest(FeatureRequest{Purpose: "screen", Symbol: s.Symbol, Candles: s.Candles}); err != nil {
			return out, err
		}
		if err := validateBacktestDays(s.Candles); err != nil {
			return out, err
		}
		series[s.Symbol] = s.Candles
	}
	out = SignalStudyResult{SchemaVersion: SignalStudySchema, PolicyVersion: SignalStudyPolicy, Config: r.Config, Events: []StudyEvent{}, Horizons: []StudyHorizon{}, BySymbol: []StudyGroup{}, ByDay: []StudyGroup{}, Warnings: []string{"Independent signal observations, not a cash portfolio or executed trades.", "High is historical potential, not an obtainable fill. Close reference is known only after the signal candle closes.", "Same-candle TP and SL assumes SL first. OHLC cannot establish intraday order or broker fills."}}
	out.Swing = *newStudyWindowMetrics(r.Config)
	for k := 1; k <= r.Config.NSteps; k++ {
		for _, basis := range []string{"open", "high", "close"} {
			out.Horizons = append(out.Horizons, StudyHorizon{Step: k, Basis: basis})
		}
	}
	seen := map[string]bool{}
	bySymbol, byDay := map[string]*StudyMetrics{}, map[string]*StudyMetrics{}
	for symbol := range series {
		bySymbol[symbol] = newStudyWindowMetrics(r.Config)
	}
	entries := append([]BacktestEntry(nil), r.Entries...)
	sort.Slice(entries, func(i, j int) bool {
		a, _ := time.Parse(time.RFC3339Nano, entries[i].Timestamp)
		b, _ := time.Parse(time.RFC3339Nano, entries[j].Timestamp)
		if a.Equal(b) {
			return entries[i].Symbol < entries[j].Symbol
		}
		return a.Before(b)
	})
	positions := map[string]int{}
	for _, entry := range entries {
		stamp, err := time.Parse(time.RFC3339Nano, entry.Timestamp)
		if err != nil || (entry.SignalType != "BUY" && entry.SignalType != "SELL") {
			return SignalStudyResult{}, fmt.Errorf("invalid study signal")
		}
		day := stamp.UTC().Format("2006-01-02")
		if day < r.Config.From || day > r.Config.To {
			return SignalStudyResult{}, fmt.Errorf("signal outside study range")
		}
		candles := series[entry.Symbol]
		idx := -1
		// Entries and validated candles are chronological; retain each symbol's
		// position instead of reparsing its prefix for every subsequent signal.
		for i := positions[entry.Symbol]; i < len(candles); i++ {
			ts, _ := time.Parse(time.RFC3339Nano, candles[i].Timestamp)
			if ts.Equal(stamp) {
				idx = i
				positions[entry.Symbol] = i
				break
			}
		}
		key := entry.Symbol + "\x00" + stamp.UTC().Format(time.RFC3339Nano)
		if idx < 19 || seen[key] {
			return SignalStudyResult{}, fmt.Errorf("signal requires exact warm candle and cannot repeat")
		}
		seen[key] = true
		direction := 1.0
		if entry.SignalType == "SELL" {
			direction = -1
		}
		event := StudyEvent{Symbol: entry.Symbol, Timestamp: stamp.UTC().Format(time.RFC3339Nano), SignalType: entry.SignalType, ReferencePrice: candles[idx].Close, Outcomes: []StudyOutcome{}}
		for i := range out.Horizons {
			h := &out.Horizons[i]
			o := StudyOutcome{Basis: h.Basis, Step: h.Step, Status: "incomplete"}
			if idx+h.Step < len(candles) {
				o = studyOutcome(h.Basis, h.Step, candles[idx+h.Step], event.ReferencePrice, direction)
			}
			h.add(o)
			// Persist every horizon for review/CSV; the UI pages the selected one.
			event.Outcomes = append(event.Outcomes, o)
		}
		event.Swing = studySwing(candles, idx, r.Config, direction)
		out.Swing.add(event.Swing)
		for _, group := range []struct {
			m map[string]*StudyMetrics
			k string
		}{{bySymbol, entry.Symbol}, {byDay, day}} {
			if group.m[group.k] == nil {
				group.m[group.k] = newStudyWindowMetrics(r.Config)
			}
			group.m[group.k].add(event.Swing)
		}
		out.Events = append(out.Events, event)
	}
	for _, group := range []struct {
		m    map[string]*StudyMetrics
		dest *[]StudyGroup
	}{{bySymbol, &out.BySymbol}, {byDay, &out.ByDay}} {
		keys := []string{}
		for k := range group.m {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			*group.dest = append(*group.dest, StudyGroup{Key: k, StudyMetrics: *group.m[k]})
		}
	}
	if _, err := json.Marshal(out); err != nil {
		return SignalStudyResult{}, fmt.Errorf("study arithmetic overflow")
	}
	return out, nil
}
