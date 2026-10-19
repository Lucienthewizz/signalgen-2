package universe

import "testing"

func TestSingleMarketSymbolBundles(t *testing.T) {
	for _, symbols := range [][]string{{"AAPL", "MSFT", "BRK-B"}, {"BBCA.JK", "BBRI.JK"}} {
		if !validSymbols(symbols) {
			t.Fatalf("valid bundle rejected: %v", symbols)
		}
	}
	for _, symbols := range [][]string{{"BBCA.JK", "AAPL"}, {"AAPL", "AAPL"}, {"https://evil"}, {"AAPL<script>"}, {"BRK.B"}} {
		if validSymbols(symbols) {
			t.Fatalf("invalid bundle accepted: %v", symbols)
		}
	}
}

func TestInstrumentMarketValidatesCurrencyAndExchange(t *testing.T) {
	us := []Instrument{{Symbol: "AAPL", Exchange: "XNAS", Currency: "USD"}, {Symbol: "BRK-B", Exchange: "XNYS", Currency: "USD"}}
	market, currency, err := InstrumentMarket(us)
	if err != nil || market != "US" || currency != "USD" {
		t.Fatalf("market=%s currency=%s err=%v", market, currency, err)
	}
	for _, invalid := range [][]Instrument{nil, {{Symbol: "AAPL", Exchange: "XNAS", Currency: "IDR"}},
		{{Symbol: "BBCA.JK", Exchange: "XNYS", Currency: "USD"}}, append(us, Instrument{Symbol: "BBCA.JK", Exchange: "XIDX", Currency: "IDR"})} {
		if _, _, err := InstrumentMarket(invalid); err == nil {
			t.Fatalf("invalid metadata accepted: %v", invalid)
		}
	}
}
