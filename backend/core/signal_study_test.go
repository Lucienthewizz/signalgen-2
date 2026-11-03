package core

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"testing"
	"time"
)

func TestSignalStudyFrozenClaudioFixture(t *testing.T) {
	raw, e := os.ReadFile("testdata/signal_study_claudio_v1.json")
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		Base   string            `json:"base_fixture"`
		Hash   string            `json:"base_sha256"`
		Config SignalStudyConfig `json:"config"`
	}
	if e = json.Unmarshal(raw, &f); e != nil {
		t.Fatal(e)
	}
	base, e := os.ReadFile("testdata/" + f.Base)
	if e != nil {
		t.Fatal(e)
	}
	if fmt.Sprintf("%x", sha256.Sum256(base)) != f.Hash {
		t.Fatal("frozen input changed")
	}
	var old BacktestRequest
	if e = json.Unmarshal(base, &old); e != nil {
		t.Fatal(e)
	}
	request := SignalStudyRequest{SchemaVersion: SignalStudySchema, Config: f.Config, Series: old.Series, Entries: old.Entries}
	result, e := RunSignalStudy(request)
	if e != nil {
		t.Fatal(e)
	}
	if result.Swing.Signals != 4 || result.Swing.Evaluated != 3 || result.Swing.Missing != 1 {
		t.Fatalf("coverage %+v", result.Swing)
	}
	for i, want := range []float64{10, 20, 15} {
		if math.Abs(*result.Events[0].Outcomes[i].ReturnPct-want) > 1e-9 {
			t.Fatal("wrong close basis")
		}
	}
	tp, sl := 5., 3.
	request.Config.NSteps = 3
	request.Config.TakeProfitPct = &tp
	request.Config.StopLossPct = &sl
	result, e = RunSignalStudy(request)
	if e != nil {
		t.Fatal(e)
	}
	for i, want := range []string{"take_profit", "stop_loss", "take_profit", "incomplete"} {
		if result.Events[i].Swing.Status != want {
			t.Fatalf("event %d %+v", i, result.Events[i])
		}
	}
}

func TestSignalStudyTradingSessionsNotCalendarDays(t *testing.T) {
	r := studyFixture()
	r.Entries = r.Entries[:1]
	r.Config.From = "2026-01-23"
	r.Config.To = "2026-01-23"
	for i := range r.Series[0].Candles {
		stamp := time.Date(2026, 1, 1+i, 0, 0, 0, 0, time.UTC)
		if i >= 19 {
			stamp = time.Date(2026, 1, 23+(i-19)*3, 0, 0, 0, 0, time.UTC)
		}
		r.Series[0].Candles[i].Timestamp = stamp.Format(time.RFC3339)
	}
	r.Entries[0].Timestamp = r.Series[0].Candles[19].Timestamp
	result, e := RunSignalStudy(r)
	if e != nil {
		t.Fatal(e)
	}
	if result.Events[0].Outcomes[0].Timestamp != "2026-01-26T00:00:00Z" {
		t.Fatal("T+1 invented a weekend candle")
	}
	r.Entries = nil
	result, e = RunSignalStudy(r)
	if e != nil || len(result.Events) != 0 || result.Swing.WinRate != nil {
		t.Fatal("zero-signal study must be valid")
	}
	r.Entries = []BacktestEntry{{Symbol: "TEST", Timestamp: r.Series[0].Candles[18].Timestamp, SignalType: "BUY"}}
	if _, e = RunSignalStudy(r); e == nil {
		t.Fatal("warmup/out-of-range signal accepted")
	}
}

func studyFixture() SignalStudyRequest {
	cs := make([]Candle, 24)
	for i := range cs {
		cs[i] = Candle{Timestamp: time.Date(2026, 1, 1+i, 0, 0, 0, 0, time.UTC).Format(time.RFC3339), Open: 100, High: 110, Low: 90, Close: 100, Volume: 100}
	}
	cs[20].Open = 102
	cs[20].Close = 105
	return SignalStudyRequest{SchemaVersion: SignalStudySchema, Config: SignalStudyConfig{From: "2026-01-20", To: "2026-01-24", NSteps: 1}, Series: []BacktestSeries{{Symbol: "TEST", Candles: cs}}, Entries: []BacktestEntry{{Symbol: "TEST", Timestamp: cs[19].Timestamp, SignalType: "BUY"}, {Symbol: "TEST", Timestamp: cs[20].Timestamp, SignalType: "BUY"}}}
}
func TestSignalStudyEveryEventAndPriceBasis(t *testing.T) {
	r := studyFixture()
	out, err := RunSignalStudy(r)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Events) != 2 || out.Horizons[0].Evaluated != 2 {
		t.Fatalf("signals skipped: %+v", out)
	}
	for i, want := range []float64{2, 10, 5} {
		if math.Abs(*out.Events[0].Outcomes[i].ReturnPct-want) > 1e-9 {
			t.Fatalf("basis %d: %+v", i, out.Events[0])
		}
	}
	if len(out.ByDay) != 2 || len(out.BySymbol) != 1 {
		t.Fatal("missing groups")
	}
}
func TestSignalStudyMissingNeverBecomesLoss(t *testing.T) {
	r := studyFixture()
	r.Config.NSteps = 100
	o, e := RunSignalStudy(r)
	if e != nil {
		t.Fatal(e)
	}
	if o.Swing.Missing != 2 || o.Swing.WinRate != nil || o.Swing.Losses != 0 || o.Events[0].Swing.Status != "incomplete" {
		t.Fatalf("bad missing: %+v", o.Swing)
	}
}
func TestSignalStudySLFirstAndSELL(t *testing.T) {
	for _, side := range []string{"BUY", "SELL"} {
		t.Run(side, func(t *testing.T) {
			r := studyFixture()
			tp, sl := 5.0, 3.0
			r.Config.TakeProfitPct = &tp
			r.Config.StopLossPct = &sl
			r.Entries = r.Entries[:1]
			r.Entries[0].SignalType = side
			o, e := RunSignalStudy(r)
			if e != nil {
				t.Fatal(e)
			}
			if o.Events[0].Swing.Status != "stop_loss" || *o.Events[0].Swing.ReturnPct != -3 {
				t.Fatalf("SL must precede TP: %+v", o.Events[0])
			}
			if side == "SELL" && *o.Events[0].Outcomes[0].ReturnPct != -2 {
				t.Fatal("SELL direction not inverted")
			}
		})
	}
}
func TestSignalStudyValidatesAndCountsFlats(t *testing.T) {
	r := studyFixture()
	r.Series[0].Candles[20].Open = 100
	o, e := RunSignalStudy(r)
	if e != nil {
		t.Fatal(e)
	}
	if o.Horizons[0].Flats < 1 {
		t.Fatal("missing flat")
	}
	r.Entries = append(r.Entries, r.Entries[0])
	if _, e = RunSignalStudy(r); e == nil {
		t.Fatal("accepted duplicate")
	}
	r = studyFixture()
	r.Series[0].Candles[21].Timestamp = r.Series[0].Candles[20].Timestamp
	if _, e = RunSignalStudy(r); e == nil {
		t.Fatal("accepted unordered")
	}
	r = studyFixture()
	bad := math.NaN()
	r.Config.TakeProfitPct = &bad
	if _, e = RunSignalStudy(r); e == nil {
		t.Fatal("accepted NaN")
	}
	if _, e = DecodeSignalStudyRequest([]byte(`{"schema_version":"signal-study-1","owner":"x"}`)); e == nil {
		t.Fatal("accepted unknown JSON")
	}
}
func TestSignalStudyMultipleSymbolsNoCashConstraint(t *testing.T) {
	r := studyFixture()
	base := r.Series[0]
	for i := 1; i < 10; i++ {
		s := fmt.Sprintf("TEST%d", i)
		r.Series = append(r.Series, BacktestSeries{Symbol: s, Candles: base.Candles})
		r.Entries = append(r.Entries, BacktestEntry{Symbol: s, Timestamp: base.Candles[19].Timestamp, SignalType: "BUY"})
	}
	o, e := RunSignalStudy(r)
	if e != nil {
		t.Fatal(e)
	}
	if len(o.Events) != 11 {
		t.Fatal("independent signals lost")
	}
}
