package dataset

import "errors"

var (
	ErrInvalidRequest = errors.New("invalid dataset request")
	ErrNotFound       = errors.New("dataset not found")
	ErrIntegrity      = errors.New("dataset fixture integrity check failed")
)

type PrepareRequest struct {
	Purpose   string   `json:"purpose"`
	Market    string   `json:"market"`
	Symbols   []string `json:"symbols"`
	Timeframe string   `json:"timeframe"`
	DateFrom  string   `json:"date_from"`
	DateTo    string   `json:"date_to"`
	RuleID    string   `json:"rule_id,omitempty"`
}

type Range struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type Quality struct {
	Status   string   `json:"status"`
	Warnings []string `json:"warnings"`
}

type Manifest struct {
	DatasetID      string   `json:"dataset_id"`
	Version        string   `json:"version"`
	SchemaVersion  string   `json:"schema_version"`
	Provider       string   `json:"provider"`
	Purpose        string   `json:"purpose"`
	Market         string   `json:"market"`
	Currency       string   `json:"currency"`
	Symbols        []string `json:"symbols"`
	Timeframe      string   `json:"timeframe"`
	Timezone       string   `json:"timezone"`
	RequestedRange Range    `json:"requested_range"`
	AvailableRange Range    `json:"available_range"`
	WarmupCandles  int      `json:"warmup_candles"`
	Adjustment     string   `json:"adjustment"`
	CandleCount    int      `json:"candle_count"`
	DecodedBytes   int      `json:"decoded_bytes"`
	Checksum       string   `json:"checksum"`
	Quality        Quality  `json:"quality"`
}
