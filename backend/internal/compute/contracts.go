package compute

import "context"

// Repository owns short-lived permission records that bind a user session to
// one exact dataset, rule, and engine version.
type Repository interface {
	Create(ctx context.Context, request CreateRequest) (Grant, error)
	Verify(ctx context.Context, userID, sessionID, grantID string) (Grant, error)
}
