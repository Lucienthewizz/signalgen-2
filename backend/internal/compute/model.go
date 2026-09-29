package compute

import (
	"errors"
	"time"
)

var (
	ErrInvalid = errors.New("invalid compute grant")
	ErrExpired = errors.New("compute grant expired")
)

type CreateRequest struct {
	UserID          string
	SessionID       string
	Purpose         string
	DatasetID       string
	DatasetVersion  string
	DatasetChecksum string
	RuleID          string
	DefinitionHash  string
	EngineVersion   string
	SchemaVersion   string
}

type Grant struct {
	ID              string    `json:"id"`
	Purpose         string    `json:"purpose"`
	DatasetID       string    `json:"dataset_id"`
	DatasetVersion  string    `json:"dataset_version"`
	DatasetChecksum string    `json:"dataset_checksum"`
	RuleID          string    `json:"rule_id"`
	DefinitionHash  string    `json:"definition_hash"`
	EngineVersion   string    `json:"engine_version"`
	SchemaVersion   string    `json:"schema_version"`
	ExpiresAt       time.Time `json:"expires_at"`
	CreatedAt       time.Time `json:"created_at"`
	UserID          string    `json:"-"`
	SessionID       string    `json:"-"`
}
