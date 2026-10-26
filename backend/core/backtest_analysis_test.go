package core

import "testing"

func TestBacktestClosedStatistics(t *testing.T) {
	cases := []struct {
		name                                           string
		trades                                         []BacktestTrade
		win, loss, expectancy, rate, reward, avgReturn *float64
	}{
		{"empty", nil, nil, nil, nil, nil, nil, nil},
		{"wins", []BacktestTrade{{Status: "closed", NetPL: 100, ReturnPct: 10}, {Status: "closed", NetPL: 300, ReturnPct: 15}}, backtestMean(200, 1), nil, backtestMean(200, 1), backtestMean(100, 1), nil, backtestMean(12.5, 1)},
		{"losses", []BacktestTrade{{Status: "closed", NetPL: -50, ReturnPct: -5}}, nil, backtestMean(-50, 1), backtestMean(-50, 1), backtestMean(0, 1), nil, backtestMean(-5, 1)},
		{"flat", []BacktestTrade{{Status: "closed"}}, nil, nil, backtestMean(0, 1), backtestMean(0, 1), nil, backtestMean(0, 1)},
		{"mixed with open", []BacktestTrade{{Status: "closed", NetPL: 100, ReturnPct: 10}, {Status: "closed", NetPL: -50, ReturnPct: -5}, {Status: "closed"}, {Status: "open", UnrealizedPL: 300, ReturnPct: 30, EntryCommission: 2}}, backtestMean(100, 1), backtestMean(-50, 1), backtestMean(50, 3), backtestMean(100, 3), backtestMean(2, 1), backtestMean(5, 3)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			m := summarizeBacktestTrades(c.trades)
			got := []*float64{m.AvgWinCash, m.AvgLossCash, m.ExpectancyCash, m.WinRate, m.RiskReward, m.AvgReturnPct}
			want := []*float64{c.win, c.loss, c.expectancy, c.rate, c.reward, c.avgReturn}
			for i := range got {
				if (got[i] == nil) != (want[i] == nil) {
					t.Fatalf("nullable metric %d: %+v", i, m)
				}
				if got[i] != nil {
					nearBacktest(t, *got[i], *want[i])
				}
			}
		})
	}
}

func TestBacktestSymbolReconciliation(t *testing.T) {
	r := backtestFixture(t)
	other := r.Series[0]
	other.Symbol = "AAA"
	r.Series = append(r.Series, other)
	e := r.Entries[0]
	e.Symbol = "AAA"
	r.Entries = append(r.Entries, e)
	r.Config.CommissionPct = 1
	r.Config.SlippagePct = 1
	result, err := RunBacktest(r)
	if err != nil {
		t.Fatal(err)
	}
	for _, h := range result.Horizons {
		if len(h.BySymbol) != 2 || h.BySymbol[0].Symbol != "AAA" || h.BySymbol[1].Symbol != "TEST" {
			t.Fatal(h.BySymbol)
		}
		closed, open, skipped := 0, 0, 0
		realized, unrealized, fees := 0.0, 0.0, 0.0
		for _, s := range h.BySymbol {
			closed += s.ClosedTrades
			open += s.OpenTrades
			skipped += s.SkippedEntries
			realized += s.NetPLCash
			unrealized += s.UnrealizedPL
			fees += s.TotalCommission
		}
		if closed != h.Metrics.ClosedTrades || open != h.Metrics.OpenTrades || skipped != len(h.Skipped) {
			t.Fatal("symbol counts do not reconcile")
		}
		nearBacktest(t, realized, h.Metrics.NetPLCash)
		nearBacktest(t, unrealized, h.Metrics.UnrealizedPL)
		nearBacktest(t, fees, h.Metrics.TotalCommission)
		nearBacktest(t, h.Metrics.FinalEquity, r.Config.InitialCapital+realized+unrealized)
		if h.Metrics.ClosedTrades > 0 {
			nearBacktest(t, *h.Metrics.ExpectancyCash, realized/float64(closed))
		}
	}
	r.Entries = nil
	empty, err := RunBacktest(r)
	if err != nil {
		t.Fatal(err)
	}
	for _, h := range empty.Horizons {
		if h.Metrics.WinRate != nil || h.Metrics.ExpectancyCash != nil || h.BySymbol[0].WinRate != nil {
			t.Fatal("undefined statistics must be null")
		}
	}
}
