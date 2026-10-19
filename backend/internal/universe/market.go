package universe

import "regexp"

var idxTickerPattern = regexp.MustCompile(`^[A-Z0-9]+\.JK$`)
var usTickerPattern = regexp.MustCompile(`^[A-Z][A-Z0-9]{0,9}(-[A-Z])?$`)

// SymbolMarket is a syntax check, not authorization: membership must still exist
// in the active server catalog. US share classes use Yahoo's BRK-B spelling.
func SymbolMarket(symbol string) string {
	if idxTickerPattern.MatchString(symbol) {
		return "IDX"
	}
	if usTickerPattern.MatchString(symbol) {
		return "US"
	}
	return ""
}

// InstrumentMarket derives the dataset's currency from trusted catalog metadata.
// One snapshot never mixes rupiah/dollars or silently converts either currency.
func InstrumentMarket(items []Instrument) (market, currency string, err error) {
	if len(items) < 1 || len(items) > MaxSymbols {
		return "", "", ErrInvalid
	}
	for _, item := range items {
		next := SymbolMarket(item.Symbol)
		valid := next == "IDX" && item.Exchange == "XIDX" && item.Currency == "IDR" ||
			next == "US" && (item.Exchange == "XNAS" || item.Exchange == "XNYS") && item.Currency == "USD"
		if !valid || market != "" && market != next {
			return "", "", ErrInvalid
		}
		market, currency = next, item.Currency
	}
	return market, currency, nil
}
