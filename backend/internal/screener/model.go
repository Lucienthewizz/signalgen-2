package screener

import (
	"errors"
	"time"
)

// Shared limits keep capability discovery and the actual WebSocket guards in
// agreement. Model A receives compact features, never raw candle batches.
const (
	Model           = "A"
	MaxCandidates   = 1000
	MaxMessageBytes = 256 << 10
)

var (
	ErrInvalid  = errors.New("socket ticket is invalid")
	ErrExpired  = errors.New("socket ticket is expired")
	ErrCapacity = errors.New("socket ticket capacity reached")
)

type Binding struct {
	UserID         string
	SessionID      string
	ComputeGrantID string
	RuleID         string
	DefinitionHash string
	EngineVersion  string
	SchemaVersion  string
	FeatureSchema  string
	ExpiresAt      time.Time
}

type CreatedTicket struct {
	Token     string    `json:"ticket"`
	ExpiresAt time.Time `json:"expires_at"`
}
