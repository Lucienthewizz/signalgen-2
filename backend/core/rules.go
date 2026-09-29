package core

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

// BaselineRuleDefinition is the frozen system rule used by the M0 fixture.
type BaselineRuleDefinition struct {
	ID          int         `json:"id"`
	Name        string      `json:"name"`
	Type        string      `json:"type"`
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

// DecisionRequest keeps the private rule server-side while accepting only
// compact feature candidates from the WASM client.
type DecisionRequest struct {
	Rule       RuleSnapshot       `json:"-"`
	Candidates []FeatureCandidate `json:"candidates"`
}

type DecisionResult struct {
	DecisionVersion string   `json:"decision_version"`
	Signals         []Signal `json:"signals"`
	CandidateCount  int      `json:"candidate_count"`
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
