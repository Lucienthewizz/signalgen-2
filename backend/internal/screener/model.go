package screener

import (
	"errors"
	"time"
)

var (
	ErrInvalid = errors.New("socket ticket is invalid")
	ErrExpired = errors.New("socket ticket is expired")
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
