package core

const (
	EngineVersion = "core-0.1.0"
	SchemaVersion = "signal-baseline-1"
)

// Candle is a completed OHLCV candle. Timestamps must be RFC3339 UTC values
// ordered from oldest to newest.
type Candle struct {
	Timestamp string  `json:"timestamp"`
	Open      float64 `json:"open"`
	High      float64 `json:"high"`
	Low       float64 `json:"low"`
	Close     float64 `json:"close"`
	Volume    int64   `json:"volume"`
}

type Condition struct {
	Left  string      `json:"left"`
	Op    string      `json:"op"`
	Right interface{} `json:"right"`
}

type RuleSnapshot struct {
	Name        string      `json:"name"`
	Logic       string      `json:"logic"`
	SignalType  string      `json:"signal_type"`
	CooldownSec int64       `json:"cooldown_sec"`
	Conditions  []Condition `json:"conditions"`
}

type RunRequest struct {
	Symbol  string       `json:"symbol"`
	Candles []Candle     `json:"candles"`
	Rule    RuleSnapshot `json:"rule"`
}

type IndicatorValues struct {
	Price float64 `json:"PRICE"`
	EMA9  float64 `json:"EMA9"`
	EMA20 float64 `json:"EMA20"`
	RSI14 float64 `json:"RSI14"`
}

type Signal struct {
	Symbol     string          `json:"symbol"`
	Timestamp  string          `json:"timestamp"`
	SignalType string          `json:"signal_type"`
	Price      float64         `json:"price"`
	Indicators IndicatorValues `json:"indicators"`
}

type RunResult struct {
	EngineVersion string   `json:"engine_version"`
	SchemaVersion string   `json:"schema_version"`
	Execution     string   `json:"execution"`
	Signals       []Signal `json:"signals"`
	CandleCount   int      `json:"candle_count"`
	Warnings      []string `json:"warnings"`
}
