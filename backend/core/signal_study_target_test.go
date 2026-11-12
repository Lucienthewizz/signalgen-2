package core

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func targetStudyFixture() SignalStudyRequest {
	r := studyFixture()
	r.Entries = nil
	r.Series = nil
	r.Config.NSteps = 3
	tp := 5.0
	r.Config.TakeProfitPct = &tp
	for _, name := range []string{"HIT", "TIME", "COLLISION", "MISSING"} {
		candles := append([]Candle(nil), studyFixture().Series[0].Candles...)
		for i := 20; i < len(candles); i++ {
			candles[i].Open, candles[i].High, candles[i].Low, candles[i].Close = 100, 104, 99, 102
		}
		switch name {
		case "HIT":
			candles[20].High = 106
			candles = candles[:21] // An early hit resolves an otherwise incomplete window.
		case "COLLISION":
			candles[20].High, candles[20].Low = 106, 96
		case "MISSING":
			candles = candles[:20]
		}
		r.Series = append(r.Series, BacktestSeries{Symbol: name, Candles: candles})
		r.Entries = append(r.Entries, BacktestEntry{Symbol: name, Timestamp: candles[19].Timestamp, SignalType: "BUY"})
	}
	return r
}

func TestSignalStudyTargetHitsSeparateFromPositiveTimeExit(t *testing.T) {
	r := targetStudyFixture()
	for _, slActive := range []bool{false, true} {
		if slActive {
			sl := 3.0
			r.Config.StopLossPct = &sl
		}
		out, err := RunSignalStudy(r)
		if err != nil {
			t.Fatal(err)
		}
		hits, wins := 2, 3
		if slActive {
			hits, wins = 1, 2
		}
		m := out.Swing
		if m.TargetHits == nil || *m.TargetHits != hits || m.Wins != wins || m.Evaluated != 3 || m.Missing != 1 || m.Signals != 4 {
			t.Fatalf("SL=%t target/win denominators: %+v", slActive, m)
		}
		var sum int
		for _, g := range out.BySymbol {
			if g.TargetHits == nil {
				t.Fatalf("missing symbol counter: %+v", g)
			}
			sum += *g.TargetHits
			if g.Key == "TIME" && (*g.TargetHits != 0 || g.Wins != 1) {
				t.Fatal("positive time exit counted as target")
			}
			if g.Key == "COLLISION" && slActive && (*g.TargetHits != 0 || g.Losses != 1) {
				t.Fatal("SL-first counted as TP")
			}
		}
		if sum != hits || len(out.ByDay) != 1 || *out.ByDay[0].TargetHits != hits {
			t.Fatal("inconsistent grouped counts")
		}
		for _, h := range out.Horizons {
			if h.TargetHits != nil {
				t.Fatal("exact prices must not claim target hits")
			}
		}
		if math.Abs(*m.WinRate-float64(wins)/3*100) > 1e-9 {
			t.Fatal("win rate changed")
		}
	}
}

func TestSignalStudyTargetCounterAvailabilityAndCompatibility(t *testing.T) {
	r := targetStudyFixture()
	r.Entries = nil
	out, err := RunSignalStudy(r)
	if err != nil || out.Swing.TargetHits == nil || *out.Swing.TargetHits != 0 || out.Swing.Evaluated != 0 || out.Swing.WinRate != nil {
		t.Fatalf("empty TP run: %+v %v", out.Swing, err)
	}
	raw, _ := json.Marshal(out.Swing)
	if !strings.Contains(string(raw), `"target_hits":0`) {
		t.Fatal("known zero omitted")
	}
	// Older consumers ignore additive response fields; request/schema/policy stay unchanged.
	var legacy struct {
		Signals   int `json:"signals"`
		Evaluated int `json:"evaluated"`
		Wins      int `json:"wins"`
	}
	if err = json.Unmarshal(raw, &legacy); err != nil || legacy.Signals != 0 {
		t.Fatal("legacy consumer failed")
	}
	var old StudyMetrics
	if err = json.Unmarshal([]byte(`{"signals":2,"evaluated":2,"wins":2,"win_rate":100}`), &old); err != nil || old.TargetHits != nil {
		t.Fatal("legacy results must remain unknown")
	}
	r.Config.TakeProfitPct = nil
	out, err = RunSignalStudy(r)
	if err != nil || out.Swing.TargetHits != nil {
		t.Fatal("no configured target must be unavailable")
	}
	raw, _ = json.Marshal(out.Swing)
	if strings.Contains(string(raw), "target_hits") {
		t.Fatal("no-target run implies zero hits")
	}
}

func TestSignalStudyTargetCounterSLFirstBothDirections(t *testing.T) {
	for _, side := range []string{"BUY", "SELL"} {
		r := studyFixture()
		tp, sl := 5.0, 3.0
		r.Config.TakeProfitPct = &tp
		r.Config.StopLossPct = &sl
		r.Entries = r.Entries[:1]
		r.Entries[0].SignalType = side
		out, err := RunSignalStudy(r)
		if err != nil || out.Swing.TargetHits == nil || *out.Swing.TargetHits != 0 || out.Events[0].Swing.Status != "stop_loss" {
			t.Fatalf("%s collision: %+v %v", side, out, err)
		}
	}
}
