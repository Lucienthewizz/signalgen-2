package dataset

import (
	"context"
	"errors"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/entitlement"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
)

var ErrUnsupportedPurpose = errors.New("unsupported dataset purpose")

// FeatureAuthorizer exposes only the feature check needed by dataset access.
type FeatureAuthorizer interface {
	RequireFeature(context.Context, string, string) error
}

// RuleReader checks existence/ownership without exposing rule mutations.
type RuleReader interface {
	Get(context.Context, string, string) (rules.Rule, error)
}

// AccessError marks a permission failure for transport-specific error mapping.
// Store failures stay distinct so an unavailable dataset is not reported as 403.
type AccessError struct{ Err error }

func (err *AccessError) Error() string { return "dataset access denied" }
func (err *AccessError) Unwrap() error { return err.Err }

// RuleError preserves ownership/version errors from the private rule reader.
type RuleError struct{ Err error }

func (err *RuleError) Error() string { return "dataset rule validation failed" }
func (err *RuleError) Unwrap() error { return err.Err }

// AccessService coordinates dataset permission and ownership. The repository
// still owns provider/snapshot mechanics, while this service owns access policy.
// No method accepts an owner from JSON: the HTTP guard supplies the verified ID.
type AccessService struct {
	Repository Repository
	Features   FeatureAuthorizer
	Rules      RuleReader
}

// Prepare checks purpose, entitlement and private rule before fetching data.
// Universe ownership is checked by the repository when preparing its snapshot.
func (service AccessService) Prepare(ctx context.Context, owner string, input PrepareRequest) (Manifest, error) {
	feature, supported := entitlement.FeatureForPurpose(input.Purpose)
	if !supported {
		return Manifest{}, ErrUnsupportedPurpose
	}
	if err := service.Features.RequireFeature(ctx, owner, feature); err != nil {
		return Manifest{}, &AccessError{Err: err}
	}
	if input.RuleID != core.BaselineRuleID {
		if _, err := service.Rules.Get(ctx, owner, input.RuleID); err != nil {
			return Manifest{}, &RuleError{Err: err}
		}
	}
	return service.Repository.Prepare(ctx, owner, input)
}

// Manifest rereads entitlement using the purpose stored in the owner's snapshot,
// not a purpose supplied by the caller at read time.
func (service AccessService) Manifest(ctx context.Context, owner, id string) (Manifest, error) {
	manifest, err := service.Repository.Manifest(ctx, owner, id)
	if err != nil {
		return Manifest{}, err
	}
	if err := service.requireFeature(ctx, owner, manifest); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

// Content withholds bytes and metadata when access has been revoked. Read order
// intentionally matches the existing owner-scoped repository contract; this is
// not a cross-store transaction and does not cancel concurrent in-flight reads.
func (service AccessService) Content(ctx context.Context, owner, id string) ([]byte, Manifest, error) {
	content, manifest, err := service.Repository.Content(ctx, owner, id)
	if err != nil {
		return nil, Manifest{}, err
	}
	if err := service.requireFeature(ctx, owner, manifest); err != nil {
		return nil, Manifest{}, err
	}
	return content, manifest, nil
}

func (service AccessService) requireFeature(ctx context.Context, owner string, manifest Manifest) error {
	feature, supported := entitlement.FeatureForPurpose(manifest.Purpose)
	if !supported {
		return &AccessError{Err: access.ErrEntitlementMissing}
	}
	if err := service.Features.RequireFeature(ctx, owner, feature); err != nil {
		return &AccessError{Err: err}
	}
	return nil
}
