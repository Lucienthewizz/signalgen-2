package rules

import (
	"errors"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
)

var (
	ErrNotFound        = errors.New("rule not found")
	ErrInvalid         = errors.New("invalid rule")
	ErrVersionConflict = errors.New("rule version conflict")
	ErrLimit           = errors.New("user rule limit reached")
)

const MaxRulesPerUser = 100

// Rule is an owner-scoped strategy definition. System rules use a separate
// read-only response because users may never update or delete them.
type Rule struct {
	ID             string            `json:"id"`
	OwnerUserID    string            `json:"-"`
	Name           string            `json:"name"`
	OwnerType      string            `json:"owner_type"`
	ReadOnly       bool              `json:"read_only"`
	Definition     core.RuleSnapshot `json:"definition"`
	DefinitionHash string            `json:"definition_hash"`
	SchemaVersion  string            `json:"schema_version"`
	EngineVersion  string            `json:"engine_version"`
	Version        int               `json:"version"`
	CreatedAt      time.Time         `json:"created_at"`
	UpdatedAt      time.Time         `json:"updated_at"`
}
