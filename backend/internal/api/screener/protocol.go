// WebSocket wire contracts. Moving these types does not change JSON field names.
package screenerapi

import (
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
)

const (
	maxScreenerCandidates = screener.MaxCandidates
	maxScreenerMessage    = screener.MaxMessageBytes
	screenerSocketTimeout = 10 * time.Second
)

type EvaluateMessage struct {
	Type                 string                  `json:"type"`
	Protocol             string                  `json:"protocol"`
	RequestID            string                  `json:"request_id"`
	EngineVersion        string                  `json:"engine_version"`
	FeatureSchemaVersion string                  `json:"feature_schema_version"`
	Candidates           []core.FeatureCandidate `json:"candidates"`
}

type Decision struct {
	Symbol      string   `json:"symbol"`
	Timestamp   string   `json:"timestamp"`
	Matched     bool     `json:"matched"`
	ReasonCodes []string `json:"reason_codes"`
}

type ResultMessage struct {
	Type            string     `json:"type"`
	Protocol        string     `json:"protocol"`
	RequestID       string     `json:"request_id"`
	DecisionVersion string     `json:"decision_version"`
	Results         []Decision `json:"results"`
}

type ErrorMessage struct {
	Type      string `json:"type"`
	Protocol  string `json:"protocol"`
	RequestID string `json:"request_id,omitempty"`
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}
