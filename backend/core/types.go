package core

const (
	EngineVersion       = "core-0.2.0"
	SchemaVersion       = "signal-baseline-1"
	CapabilitiesVersion = "capabilities-1"
	WorkerProtocol      = "worker-1"
	MaxCandlesPerRun    = 100000
	BaselineRuleID      = "default-scalping-v1"
	BaselineRuleHash    = "sha256:74cb82c5bf9cf8fc06ce6eab0c054734110ad6775b0ab57a203836d588d1f52a"
)

// Capabilities is the versioned feature contract exposed to clients. Keeping
// this list in the core prevents the API and WASM adapter from advertising
// calculations that are not implemented yet.
type Capabilities struct {
	CapabilitiesVersion string   `json:"capabilities_version"`
	EngineVersion       string   `json:"engine_version"`
	SchemaVersion       string   `json:"schema_version"`
	WorkerProtocol      string   `json:"worker_protocol"`
	Purposes            []string `json:"purposes"`
	Markets             []string `json:"markets"`
	Timeframes          []string `json:"timeframes"`
	Indicators          []string `json:"indicators"`
	Operators           []string `json:"operators"`
	RuleLogic           []string `json:"rule_logic"`
	MaxCandlesPerRun    int      `json:"max_candles_per_run"`
	MaxSymbolsPerRun    int      `json:"max_symbols_per_run"`
}

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
	Purpose string       `json:"purpose"`
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
