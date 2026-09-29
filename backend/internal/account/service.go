package account

import "context"

type Service interface {
	EnsureProfile(ctx context.Context, userID, email string) (Profile, error)
	RequireActive(ctx context.Context, userID string) (Profile, error)
}
