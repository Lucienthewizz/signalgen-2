package main

import (
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
	"testing"
	"time"
)

func TestSyntheticHistoryScopeAndDirections(t *testing.T) {
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 0, 40)
	for i := 0; i < 23; i++ {
		symbol := code(i) + ".JK"
		got := syntheticHistory(universe.Instrument{Symbol: symbol}, from, to)
		if err := marketdata.ValidateHistory(got.Series, symbol, from, to); err != nil {
			t.Fatal(err)
		}
		if len(got.Series.Candles) != 40 {
			t.Fatal("fixture date window changed")
		}
		delta := got.Series.Candles[39].Close - got.Series.Candles[0].Close
		if (i%2 == 0 && delta <= 0) || (i%2 == 1 && delta >= 0) {
			t.Fatal("fixture direction changed")
		}
	}
}
