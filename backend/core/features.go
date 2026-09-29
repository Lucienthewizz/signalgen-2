package core

// Version constants form the stable contract shared by the API, WebSocket,
// and browser WASM worker. Change them only together with contract fixtures.
const (
	EngineVersion        = "core-0.3.0"
	SchemaVersion        = "signal-baseline-1"
	CapabilitiesVersion  = "capabilities-2"
	WorkerProtocol       = "worker-2"
	FeatureSchemaVersion = "screener-features-1"
	DecisionVersion      = "decision-1"
	PrivateProtocol      = "screener-private-1"
	MaxCandlesPerRun     = 100000
	BaselineRuleID       = "default-scalping-v1"
	BaselineRuleHash     = "sha256:74cb82c5bf9cf8fc06ce6eab0c054734110ad6775b0ab57a203836d588d1f52a"
)

// Capabilities is the versioned feature contract exposed to clients.
type Capabilities struct {
	CapabilitiesVersion  string   `json:"capabilities_version"`
	EngineVersion        string   `json:"engine_version"`
	SchemaVersion        string   `json:"schema_version"`
	FeatureSchemaVersion string   `json:"feature_schema_version"`
	DecisionVersion      string   `json:"decision_version"`
	PrivateProtocol      string   `json:"private_protocol"`
	WorkerProtocol       string   `json:"worker_protocol"`
	Purposes             []string `json:"purposes"`
	Markets              []string `json:"markets"`
	Timeframes           []string `json:"timeframes"`
	Indicators           []string `json:"indicators"`
	Operators            []string `json:"operators"`
	RuleLogic            []string `json:"rule_logic"`
	MaxCandlesPerRun     int      `json:"max_candles_per_run"`
	MaxSymbolsPerRun     int      `json:"max_symbols_per_run"`
}

// Candle is a completed OHLCV candle ordered from oldest to newest.
type Candle struct {
	Timestamp string  `json:"timestamp"`
	Open      float64 `json:"open"`
	High      float64 `json:"high"`
	Low       float64 `json:"low"`
	Close     float64 `json:"close"`
	Volume    int64   `json:"volume"`
}

type FeatureRequest struct {
	Purpose string   `json:"purpose"`
	Symbol  string   `json:"symbol"`
	Candles []Candle `json:"candles"`
}

type IndicatorValues struct {
	Price float64 `json:"PRICE"`
	EMA9  float64 `json:"EMA9"`
	EMA20 float64 `json:"EMA20"`
	RSI14 float64 `json:"RSI14"`
}

// FeatureVector is the compact client-to-server computation result.
type FeatureVector struct {
	Price float64 `json:"price"`
	EMA9  float64 `json:"ema9"`
	EMA20 float64 `json:"ema20"`
	RSI14 float64 `json:"rsi14"`
}

type FeatureCandidate struct {
	Symbol    string        `json:"symbol"`
	Timestamp string        `json:"timestamp"`
	Features  FeatureVector `json:"features"`
}

type FeatureResult struct {
	EngineVersion        string             `json:"engine_version"`
	FeatureSchemaVersion string             `json:"feature_schema_version"`
	Execution            string             `json:"execution"`
	Candidates           []FeatureCandidate `json:"candidates"`
	CandleCount          int                `json:"candle_count"`
	Warnings             []string           `json:"warnings"`
}
