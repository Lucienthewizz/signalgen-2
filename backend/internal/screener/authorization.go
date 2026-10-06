package screener

import (
	"context"
	"errors"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/account"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/entitlement"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

// AuthorizationFailure is a transport-independent screening rejection. The API
// maps this code to the existing WebSocket envelope without exposing store errors.
type AuthorizationFailure struct {
	Code      string
	Retryable bool
}

// SessionVerifier only needs session validation, not device-management methods.
type SessionVerifier interface {
	VerifyByID(context.Context, string, string) (session.Session, error)
}

// RuleReader loads only the verified owner's private rule.
type RuleReader interface {
	Get(context.Context, string, string) (rules.Rule, error)
}

// AuthorizationService coordinates permissions immediately before private
// scoring. It knows domain contracts, but nothing about HTTP or WebSocket I/O.
type AuthorizationService struct {
	Sessions     SessionVerifier
	Accounts     account.Service
	Entitlements entitlement.Service
	Compute      compute.Repository
	Datasets     dataset.Repository
	Rules        RuleReader
}

// ResolveRule loads the exact definition bound to the ticket. Baseline rules
// stay server-owned; a changed or foreign custom rule is treated as unavailable.
func (service AuthorizationService) ResolveRule(ctx context.Context, binding Binding) (core.RuleSnapshot, error) {
	if binding.RuleID == core.BaselineRuleID {
		if binding.DefinitionHash != core.BaselineRuleHash {
			return core.RuleSnapshot{}, rules.ErrNotFound
		}
		definition := core.GetBaselineRuleDefinition()
		return core.RuleSnapshot{
			Name: definition.Name, Logic: definition.Logic, SignalType: definition.SignalType,
			CooldownSec: definition.CooldownSec, Conditions: definition.Conditions,
		}, nil
	}
	rule, err := service.Rules.Get(ctx, binding.UserID, binding.RuleID)
	if err != nil {
		return core.RuleSnapshot{}, err
	}
	if rule.DefinitionHash != binding.DefinitionHash || rule.EngineVersion != binding.EngineVersion || rule.SchemaVersion != binding.SchemaVersion {
		return core.RuleSnapshot{}, rules.ErrNotFound
	}
	return rule.Definition, nil
}

// RecheckBatch rereads durable state because waiting for client features can
// cross a revocation, expiry, or rule edit. These reads are not a cross-store
// transaction: a concurrent revoke does not cancel already-authorized work.
func (service AuthorizationService) RecheckBatch(ctx context.Context, binding Binding, expected compute.Grant) (core.RuleSnapshot, dataset.Manifest, *AuthorizationFailure) {
	fail := func(code string, retryable bool) (core.RuleSnapshot, dataset.Manifest, *AuthorizationFailure) {
		return core.RuleSnapshot{}, dataset.Manifest{}, &AuthorizationFailure{Code: code, Retryable: retryable}
	}
	if _, err := service.Sessions.VerifyByID(ctx, binding.UserID, binding.SessionID); err != nil {
		switch {
		case errors.Is(err, session.ErrExpired):
			return fail("SESSION_EXPIRED", false)
		case errors.Is(err, session.ErrInvalid), errors.Is(err, session.ErrRevoked):
			return fail("SESSION_REVOKED", false)
		default:
			return fail("SERVICE_UNAVAILABLE", true)
		}
	}
	if _, err := service.Accounts.RequireActive(ctx, binding.UserID); err != nil {
		if errors.Is(err, access.ErrAccountSuspended) || errors.Is(err, access.ErrAccountNotFound) {
			return fail("ACCOUNT_SUSPENDED", false)
		}
		return fail("SERVICE_UNAVAILABLE", true)
	}
	if err := service.Entitlements.RequireFeature(ctx, binding.UserID, access.FeatureScreener); err != nil {
		if errors.Is(err, access.ErrEntitlementMissing) {
			return fail("ENTITLEMENT_REQUIRED", false)
		}
		return fail("SERVICE_UNAVAILABLE", true)
	}
	grant, err := service.Compute.Verify(ctx, binding.UserID, binding.SessionID, binding.ComputeGrantID)
	if err != nil {
		if errors.Is(err, compute.ErrExpired) {
			return fail("GRANT_EXPIRED", false)
		}
		if errors.Is(err, compute.ErrInvalid) {
			return fail("GRANT_INVALID", false)
		}
		return fail("SERVICE_UNAVAILABLE", true)
	}
	if grant.ID != expected.ID || grant.Purpose != "screen" || grant.RuleID != binding.RuleID ||
		grant.DefinitionHash != binding.DefinitionHash || grant.EngineVersion != binding.EngineVersion ||
		grant.SchemaVersion != binding.SchemaVersion || grant.DatasetID != expected.DatasetID ||
		grant.DatasetVersion != expected.DatasetVersion || grant.DatasetChecksum != expected.DatasetChecksum {
		return fail("VERSION_MISMATCH", false)
	}
	manifest, err := service.Datasets.Manifest(ctx, binding.UserID, grant.DatasetID)
	if errors.Is(err, dataset.ErrNotFound) {
		return fail("RESOURCE_NOT_FOUND", false)
	}
	if err != nil {
		return fail("SERVICE_UNAVAILABLE", true)
	}
	if manifest.DatasetID != grant.DatasetID || manifest.Version != grant.DatasetVersion ||
		manifest.Checksum != grant.DatasetChecksum || manifest.Purpose != grant.Purpose {
		return fail("VERSION_MISMATCH", false)
	}
	rule, err := service.ResolveRule(ctx, binding)
	if errors.Is(err, rules.ErrNotFound) {
		return fail("RESOURCE_NOT_FOUND", false)
	}
	if err != nil {
		return fail("SERVICE_UNAVAILABLE", true)
	}
	return rule, manifest, nil
}
