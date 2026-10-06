package account

import "context"

// Service defines account operations; repository.go implements this contract.
// Account status comes from server-owned state, not editable user metadata.
type Service interface {
	EnsureProfile(ctx context.Context, userID, email string) (State, error)
	RequireActive(ctx context.Context, userID string) (State, error)
}
