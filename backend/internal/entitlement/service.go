package entitlement

import "context"

type Service interface {
	Features(ctx context.Context, userID string) ([]string, error)
	FeatureGrants(ctx context.Context, userID string) ([]Grant, error)
	RequireFeature(ctx context.Context, userID, feature string) error
}
