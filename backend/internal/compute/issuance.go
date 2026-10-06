package compute

import (
	"context"
	"errors"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/entitlement"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
)

var (
	ErrUnsupportedPurpose = errors.New("unsupported compute purpose")
	ErrBindingMismatch    = errors.New("dataset, rule or engine binding mismatch")
)

// IssueInput contains client claims only. Owner and session IDs are deliberately
// absent: the adapter supplies them separately from its verified credentials.
type IssueInput struct {
	Purpose         string `json:"purpose"`
	DatasetID       string `json:"dataset_id"`
	DatasetVersion  string `json:"dataset_version"`
	DatasetChecksum string `json:"dataset_checksum"`
	RuleID          string `json:"rule_id"`
	DefinitionHash  string `json:"definition_hash"`
	EngineVersion   string `json:"engine_version"`
	SchemaVersion   string `json:"schema_version"`
}

// IssuanceStage distinguishes failures without coupling the service to HTTP.
// Adapters can preserve endpoint-specific errors while stores remain replaceable.
type IssuanceStage string

const (
	StageEntitlement IssuanceStage = "entitlement"
	StageDataset     IssuanceStage = "dataset"
	StageRule        IssuanceStage = "rule"
	StageGrant       IssuanceStage = "grant"
)

// IssuanceError preserves the underlying domain error for errors.Is/As.
// Its details are for server-side mapping, never a public error message.
type IssuanceError struct {
	Stage IssuanceStage
	Err   error
}

func (err *IssuanceError) Error() string { return "compute issuance failed at " + string(err.Stage) }
func (err *IssuanceError) Unwrap() error { return err.Err }

// These consumer-owned interfaces expose only operations this workflow needs.
type FeatureAuthorizer interface {
	RequireFeature(context.Context, string, string) error
}
type ManifestReader interface {
	Manifest(context.Context, string, string) (dataset.Manifest, error)
}
type RuleReader interface {
	Get(context.Context, string, string) (rules.Rule, error)
}
type GrantWriter interface {
	Create(context.Context, CreateRequest) (Grant, error)
}

// IssuanceService verifies permission and immutable bindings before persistence.
// It has no dependency on HTTP, Gin or WebSocket and can be tested independently.
type IssuanceService struct {
	Features FeatureAuthorizer
	Datasets ManifestReader
	Rules    RuleReader
	Grants   GrantWriter
}

// Issue requires owner/session values from an authenticated caller. It carries
// that owner through every read/write and never trusts an owner ID from JSON.
// Reads and issuance are not one cross-store transaction; later ticket/scoring
// checks still revalidate the grant and current authorization state.
func (service IssuanceService) Issue(ctx context.Context, ownerID, sessionID string, input IssueInput) (Grant, error) {
	feature, supported := entitlement.FeatureForPurpose(input.Purpose)
	if !supported {
		return Grant{}, ErrUnsupportedPurpose
	}
	if err := service.Features.RequireFeature(ctx, ownerID, feature); err != nil {
		return Grant{}, &IssuanceError{Stage: StageEntitlement, Err: err}
	}
	manifest, err := service.Datasets.Manifest(ctx, ownerID, input.DatasetID)
	if err != nil {
		return Grant{}, &IssuanceError{Stage: StageDataset, Err: err}
	}
	expectedRuleHash := core.BaselineRuleHash
	if input.RuleID != core.BaselineRuleID {
		rule, err := service.Rules.Get(ctx, ownerID, input.RuleID)
		if err != nil {
			return Grant{}, &IssuanceError{Stage: StageRule, Err: err}
		}
		expectedRuleHash = rule.DefinitionHash
	}
	if input.Purpose != manifest.Purpose || input.DatasetVersion != manifest.Version ||
		input.DatasetChecksum != manifest.Checksum || input.DefinitionHash != expectedRuleHash ||
		input.EngineVersion != core.EngineVersion || input.SchemaVersion != core.SchemaVersion {
		return Grant{}, ErrBindingMismatch
	}
	grant, err := service.Grants.Create(ctx, CreateRequest{
		UserID: ownerID, SessionID: sessionID, Purpose: input.Purpose,
		DatasetID: input.DatasetID, DatasetVersion: input.DatasetVersion, DatasetChecksum: input.DatasetChecksum,
		RuleID: input.RuleID, DefinitionHash: input.DefinitionHash,
		EngineVersion: input.EngineVersion, SchemaVersion: input.SchemaVersion,
	})
	if err != nil {
		return Grant{}, &IssuanceError{Stage: StageGrant, Err: err}
	}
	return grant, nil
}
