package portfolio

import (
	"errors"
	"testing"
	"time"
)

func testTransaction(id, side, quantity, price, fee string, step int) Transaction {
	return Transaction{ID: id, Version: 1, Data: Data{Symbol: "BBCA.JK", Market: "IDX", Currency: "IDR", Side: side, Quantity: quantity, Price: price, Fee: fee, Book: "Main", ExecutedAt: time.Date(2026, 9, 1, 0, step, 0, 0, time.UTC)}}
}

func TestWeightedAverageFeesPartialSaleAndFullClosure(t *testing.T) {
	items := []Transaction{testTransaction("a", "BUY", "100", "4000", "1000", 0), testTransaction("b", "BUY", "100", "5000", "1000", 1), testTransaction("c", "SELL", "100", "6000", "1000", 2)}
	summary, err := Recalculate(items)
	if err != nil {
		t.Fatal(err)
	}
	p := summary.Positions[0]
	if p.Quantity != "100.000000" || p.CostBasis != "451000.000000" || *p.AverageCost != "4510.000000" || p.RealizedPnL != "148000.000000" || p.MarketValue != nil || p.UnrealizedPnL != nil {
		t.Fatalf("unexpected position: %+v", p)
	}
	items = append(items, testTransaction("d", "SELL", "100", "4300", "1000", 3))
	summary, err = Recalculate(items)
	if err != nil {
		t.Fatal(err)
	}
	p = summary.Positions[0]
	if p.Quantity != "0.000000" || p.CostBasis != "0.000000" || p.AverageCost != nil || p.RealizedPnL != "126000.000000" || summary.Totals[0].Fees != "4000.000000" {
		t.Fatalf("closure = %+v", p)
	}
}

func TestDecimalPrecisionAndBookCurrencyIsolation(t *testing.T) {
	a := testTransaction("a", "BUY", "0.3", "0.1", "0", 0)
	a.Data.Symbol, a.Data.Market, a.Data.Currency = "AAPL", "US", "USD"
	b := a
	b.ID = "b"
	b.Data.Side, b.Data.Quantity, b.Data.Price = "SELL", "0.1", "0.2"
	b.Data.ExecutedAt = b.Data.ExecutedAt.Add(time.Minute)
	c := testTransaction("c", "BUY", "100", "4000", "0", 0)
	summary, err := Recalculate([]Transaction{b, c, a})
	if err != nil {
		t.Fatal(err)
	}
	if len(summary.Totals) != 2 || len(summary.Positions) != 2 {
		t.Fatal("currencies were combined")
	}
	for _, p := range summary.Positions {
		if p.Market == "US" && (p.Quantity != "0.200000" || p.CostBasis != "0.020000" || p.RealizedPnL != "0.010000") {
			t.Fatalf("decimal drift: %+v", p)
		}
	}
	b.Data.Book = "Other"
	if _, err = Recalculate([]Transaction{a, b}); !errors.Is(err, ErrInsufficient) {
		t.Fatal("sale borrowed holdings from another book")
	}
}

func TestChronologyOversellAndSameTimeTieBreak(t *testing.T) {
	buy := testTransaction("b", "BUY", "100", "4000", "0", 1)
	sell := testTransaction("a", "SELL", "100", "4000", "0", 0)
	if _, err := Recalculate([]Transaction{buy, sell}); !errors.Is(err, ErrInsufficient) {
		t.Fatal("future purchase funded an earlier sale")
	}
	sell.Data.ExecutedAt = buy.Data.ExecutedAt
	if _, err := Recalculate([]Transaction{buy, sell}); !errors.Is(err, ErrInsufficient) {
		t.Fatal("same-timestamp UUID ordering changed")
	}
	sell.ID = "c"
	if _, err := Recalculate([]Transaction{sell, buy}); err != nil {
		t.Fatal(err)
	}
	sell.Data.Quantity = "200"
	if _, err := Recalculate([]Transaction{buy, sell}); !errors.Is(err, ErrInsufficient) {
		t.Fatal("oversell accepted")
	}
}

func TestTransactionValidationAndCanonicalDecimals(t *testing.T) {
	base := testTransaction("a", "BUY", "100", "4000", "0", 0).Data
	for _, test := range []struct {
		name   string
		mutate func(*Data)
	}{
		{"float exponent", func(d *Data) { d.Price = "1e3" }},
		{"negative", func(d *Data) { d.Quantity = "-100" }},
		{"precision", func(d *Data) { d.Price = "1.0000001" }},
		{"zero", func(d *Data) { d.Quantity = "0" }},
		{"lot", func(d *Data) { d.Quantity = "101" }},
		{"market", func(d *Data) { d.Currency = "USD" }},
		{"notional", func(d *Data) { d.Quantity = "100000000"; d.Price = "1000000000" }},
		{"future", func(d *Data) { d.ExecutedAt = time.Now().Add(time.Hour) }},
		{"timestamp precision", func(d *Data) { d.ExecutedAt = d.ExecutedAt.Add(time.Nanosecond) }},
		{"null", func(d *Data) { d.Book = "Main\x00other" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			d := base
			test.mutate(&d)
			if _, err := Normalize(d); !errors.Is(err, ErrInvalid) {
				t.Fatal("invalid input accepted")
			}
		})
	}
	base.Quantity = "000100.00"
	base.Symbol = " bbca.jk "
	data, err := Normalize(base)
	if err != nil || data.Quantity != "100.000000" || data.Symbol != "BBCA.JK" {
		t.Fatal("decimal normalization failed")
	}
	result, err := Recalculate(nil)
	if err != nil || len(result.Positions) != 0 || len(result.Totals) != 0 {
		t.Fatal("empty ledger invented holdings")
	}
}
