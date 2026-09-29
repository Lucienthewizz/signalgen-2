package auth

import "errors"

var (
	ErrTokenRequired        = errors.New("access token is required")
	ErrTokenInvalid         = errors.New("access token is invalid or expired")
	ErrProviderUnavailable  = errors.New("identity provider is unavailable")
	ErrCredentialsInvalid   = errors.New("email or password is invalid")
	ErrRegistrationRejected = errors.New("registration was rejected")
	ErrRecoveryInvalid      = errors.New("password recovery session is invalid")
	ErrPasswordRejected     = errors.New("password was rejected")
	ErrAuthRateLimited      = errors.New("authentication provider rate limited the request")
)

// Principal is the identity confirmed by Supabase Auth. Roles and feature
// entitlements are intentionally absent because SignalGen owns those values.
type Principal struct {
	ID       string `json:"id"`
	Email    string `json:"email,omitempty"`
	FullName string `json:"full_name,omitempty"`
}

// AuthResult is the stable subset of a Supabase Auth session exposed to the
// frontend. SignalGen never adds roles or entitlements to this identity result.
type AuthResult struct {
	AccessToken string
	TokenType   string
	ExpiresIn   int
	User        Principal
}
