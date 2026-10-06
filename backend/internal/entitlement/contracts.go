package entitlement

import "context"

// Service reads effective access and checks whether a user may use a feature.
type Service interface {
	Features(ctx context.Context, userID string) ([]string, error)
	FeatureGrants(ctx context.Context, userID string) ([]Grant, error)
	RequireFeature(ctx context.Context, userID, feature string) error
}
