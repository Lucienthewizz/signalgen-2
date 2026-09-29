package auth

import "context"

// IdentityVerifier validates the bearer token presented to protected routes.
type IdentityVerifier interface {
	Verify(ctx context.Context, accessToken string) (Principal, error)
}

// Service delegates public identity operations to Supabase Auth. Application
// roles and feature access intentionally do not belong to this interface.
type Service interface {
	Register(ctx context.Context, email, password, fullName string) (AuthResult, error)
	Login(ctx context.Context, email, password string) (AuthResult, error)
	RequestPasswordReset(ctx context.Context, email, redirectURL string) error
	ResetPassword(ctx context.Context, accessToken, refreshToken, password string) error
}
