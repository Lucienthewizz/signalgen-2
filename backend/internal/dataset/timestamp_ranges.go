package dataset

import "github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"

// All provider timestamps are canonical UTC RFC3339, hence lexically ordered.
func timestampRanges(series []marketdata.Series) (*Range, *Range) {
	available, requested := Range{}, Range{}
	for _, item := range series {
		for _, candle := range item.Candles {
			if available.From == "" || candle.Timestamp < available.From {
				available.From = candle.Timestamp
			}
			if candle.Timestamp > available.To {
				available.To = candle.Timestamp
			}
		}
		if item.RequestedFrom != "" && (requested.From == "" || item.RequestedFrom < requested.From) {
			requested.From = item.RequestedFrom
		}
		if item.RequestedTo > requested.To {
			requested.To = item.RequestedTo
		}
	}
	if requested.From == "" {
		requested = available
	}
	return &available, &requested
}
