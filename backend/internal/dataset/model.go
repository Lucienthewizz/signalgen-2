package dataset

import "errors"

var (
	ErrInvalidRequest = errors.New("invalid dataset request")
	ErrNotFound       = errors.New("dataset not found")
	ErrIntegrity      = errors.New("dataset fixture integrity check failed")
	ErrCapacity       = errors.New("dataset snapshot capacity reached")
)

type PrepareRequest struct {
	RequiredOperands []string `json:"-"` // derived from the authorized rule, never client-controlled
	Mode             string   `json:"mode,omitempty"`
	From             string   `json:"from,omitempty"`
	To               string   `json:"to,omitempty"`
	NSteps           int      `json:"n_steps,omitempty"`
	Timeframe        string   `json:"timeframe,omitempty"`
	Purpose          string   `json:"purpose"`
	RuleID           string   `json:"rule_id"`
	UniverseID       string   `json:"universe_id"`
}

type Range struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type Quality struct {
	Status   string   `json:"status"`
	Warnings []string `json:"warnings"`
}

type BacktestScope struct {
	Mode   string `json:"mode"`
	From   string `json:"from"`
	To     string `json:"to"`
	NSteps int    `json:"n_steps"`
	RuleID string `json:"rule_id,omitempty"`
}

type Manifest struct {
	RequiredOperands        []string       `json:"required_operands,omitempty"`
	IndicatorCatalogVersion string         `json:"indicator_catalog_version,omitempty"`
	Backtest                *BacktestScope `json:"backtest,omitempty"`
	AvailableTimestampRange *Range         `json:"available_timestamp_range,omitempty"`
	RequestedTimestampRange *Range         `json:"requested_timestamp_range,omitempty"`
	ExpiresAt               string         `json:"expires_at,omitempty"`
	DatasetID               string         `json:"dataset_id"`
	Version                 string         `json:"version"`
	SchemaVersion           string         `json:"schema_version"`
	Provider                string         `json:"provider"`
	Purpose                 string         `json:"purpose"`
	Market                  string         `json:"market"`
	Currency                string         `json:"currency"`
	Symbols                 []string       `json:"symbols"`
	Exchanges               []string       `json:"exchanges,omitempty"`
	Timeframe               string         `json:"timeframe"`
	Timezone                string         `json:"timezone"`
	RequestedRange          Range          `json:"requested_range"`
	AvailableRange          Range          `json:"available_range"`
	WarmupCandles           int            `json:"warmup_candles"`
	Adjustment              string         `json:"adjustment"`
	CandleCount             int            `json:"candle_count"`
	DecodedBytes            int            `json:"decoded_bytes"`
	Checksum                string         `json:"checksum"`
	Quality                 Quality        `json:"quality"`
}
