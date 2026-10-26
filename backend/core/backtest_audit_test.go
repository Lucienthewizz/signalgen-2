package core

import (
	"encoding/json"
	"math"
	"math/rand"
	"testing"
	"time"
)

func TestBacktestDailySessionDoesNotReuseCloseProceeds(t *testing.T) {
	request := backtestFixture(t)
	request.Config.NSteps = 1
	other := request.Series[0]
	other.Symbol = "OTHER"
	other.Candles = append([]Candle(nil), other.Candles...)
	for i := range other.Candles {
		stamp, _ := time.Parse(time.RFC3339, other.Candles[i].Timestamp)
		other.Candles[i].Timestamp = stamp.Add(time.Hour).Format(time.RFC3339)
	}
	request.Series = append(request.Series, other)
	request.Entries = []BacktestEntry{request.Entries[0], {Symbol: other.Symbol, Timestamp: other.Candles[19].Timestamp, SignalType: "BUY"}}
	result, err := RunBacktest(request)
	if err != nil {
		t.Fatal(err)
	}
	horizon := result.Horizons[0]
	if len(horizon.Trades) != 1 || len(horizon.Skipped) != 1 || horizon.Skipped[0].Reason != "POSITION_OPEN" {
		t.Fatalf("spent a daily close at another symbol's same-day open: trades=%+v skipped=%+v", horizon.Trades, horizon.Skipped)
	}
	if len(horizon.EquityCurve) != 27 {
		t.Fatalf("daily curve must have one point per date plus initial balance; got %d", len(horizon.EquityCurve))
	}
}

func TestBacktestOpenPositionReturnUsesUnrealizedPL(t *testing.T) {
	request := backtestFixture(t)
	request.Entries = request.Entries[2:3]
	result, err := RunBacktest(request)
	if err != nil {
		t.Fatal(err)
	}
	trade := result.Horizons[2].Trades[0]
	if trade.Status != "open" || trade.UnrealizedPL <= 0 {
		t.Fatalf("fixture is not an open profit: %+v", trade)
	}
	nearBacktest(t, trade.ReturnPct, (125.0/120-1)*100)
}

func TestBacktestFeatureExportRejectsIntradayCandles(t *testing.T) {
	request := backtestFixture(t)
	candles := request.Series[0].Candles[:20]
	start := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := range candles {
		candles[i].Timestamp = start.Add(time.Duration(i) * time.Hour).Format(time.RFC3339)
	}
	if _, err := ComputeBacktestFeatures(FeatureRequest{Purpose: "backtest", Symbol: "TEST", Candles: candles}); err == nil {
		t.Fatal("daily-only feature export accepted intraday candles")
	}
}

func TestBacktestRequiresExactSubsecondReference(t *testing.T) {
	request := backtestFixture(t)
	request.Entries = request.Entries[:1]
	request.Series[0].Candles[19].Timestamp = "2026-01-20T00:00:00.100Z"
	request.Entries[0].Timestamp = "2026-01-20T00:00:00.200Z"
	if _, err := RunBacktest(request); err == nil {
		t.Fatal("entry reference matched a different instant after losing subsecond precision")
	}
	request.Entries[0].Timestamp = "2026-01-20T08:00:00.100+08:00"
	if _, err := RunBacktest(request); err != nil {
		t.Fatalf("equivalent UTC instant should match: %v", err)
	}
}

func TestBacktestEntryPriorityUsesInstantsNotTimestampText(t *testing.T) {
	request := backtestFixture(t)
	request.Config.NSteps = 1
	other := request.Series[0]
	other.Symbol = "AAA"
	other.Candles = append([]Candle(nil), other.Candles...)
	other.Candles[19].Timestamp = "2026-01-20T00:00:00.001Z"
	request.Series = append(request.Series, other)
	request.Entries = []BacktestEntry{{Symbol: other.Symbol, Timestamp: other.Candles[19].Timestamp, SignalType: "BUY"}, request.Entries[0]}
	result, err := RunBacktest(request)
	if err != nil {
		t.Fatal(err)
	}
	if result.Horizons[0].Trades[0].Symbol != "TEST" {
		t.Fatal("later fractional timestamp won the daily fill over an earlier instant")
	}
}

func TestBacktestConservesCapitalAcrossRandomPricesAndCosts(t *testing.T) {
	random := rand.New(rand.NewSource(42026))
	for scenario := 0; scenario < 100; scenario++ {
		request := backtestFixture(t)
		request.Config.NSteps = 5
		request.Config.InitialCapital = 1000 + random.Float64()*100000
		request.Config.CommissionPct = random.Float64() * 10
		request.Config.SlippagePct = random.Float64() * 10
		request.Config.PositionSize = 1 + random.Float64()*99
		for i := 20; i < len(request.Series[0].Candles); i++ {
			c := &request.Series[0].Candles[i]
			c.Open, c.Close = 1+random.Float64()*500, 1+random.Float64()*500
			c.High, c.Low = math.Max(c.Open, c.Close)+1, math.Min(c.Open, c.Close)*0.9
		}
		result, err := RunBacktest(request)
		if err != nil {
			t.Fatal(err)
		}
		for _, horizon := range result.Horizons {
			metrics := horizon.Metrics
			nearBacktest(t, metrics.FinalEquity, metrics.InitialCapital+metrics.NetPLCash+metrics.UnrealizedPL)
			if metrics.FinalEquity < 0 || metrics.MaxDrawdownPct < 0 || metrics.MaxDrawdownPct > 100 || metrics.OpenTrades > 1 {
				t.Fatalf("impossible portfolio metrics: %+v", metrics)
			}
			closedPL, unrealized, commission := 0.0, 0.0, 0.0
			for _, trade := range horizon.Trades {
				commission += trade.EntryCommission + trade.ExitCommission
				if trade.Status == "open" {
					unrealized += trade.UnrealizedPL
				} else {
					closedPL += trade.NetPL
					if trade.ExitTime <= trade.SignalTime {
						t.Fatal("exit did not follow signal")
					}
				}
			}
			nearBacktest(t, metrics.NetPLCash, closedPL)
			nearBacktest(t, metrics.UnrealizedPL, unrealized)
			nearBacktest(t, metrics.TotalCommission, commission)
			for _, point := range horizon.EquityCurve {
				if point.Equity < 0 || math.IsNaN(point.Equity) || math.IsInf(point.Equity, 0) {
					t.Fatal("invalid marked equity")
				}
			}
		}
		before, _ := json.Marshal(result)
		for i, j := 0, len(request.Entries)-1; i < j; i, j = i+1, j-1 {
			request.Entries[i], request.Entries[j] = request.Entries[j], request.Entries[i]
		}
		again, err := RunBacktest(request)
		if err != nil {
			t.Fatal(err)
		}
		after, _ := json.Marshal(again)
		if string(before) != string(after) {
			t.Fatal("input permutation changed simulation")
		}
	}
}
