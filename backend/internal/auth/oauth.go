package auth

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
)

// OAuthService keeps social sign-in optional for alternative identity adapters.
// Only Supabase identity tokens are returned; Google API tokens are discarded.
type OAuthService interface {
	GoogleAuthorizationURL(ctx context.Context, redirectURL, challenge string) (string, error)
	ExchangeOAuthCode(ctx context.Context, code, verifier string) (AuthResult, error)
}

func (verifier *SupabaseVerifier) GoogleAuthorizationURL(ctx context.Context, redirectURL, challenge string) (string, error) {
	var settings struct {
		External map[string]bool `json:"external"`
	}
	status, err := verifier.doAuthJSON(ctx, http.MethodGet, verifier.authURL("/settings"), "", nil, &settings)
	if err != nil {
		return "", err
	}
	if status == http.StatusTooManyRequests {
		return "", ErrAuthRateLimited
	}
	if status != http.StatusOK {
		return "", ErrProviderUnavailable
	}
	if !settings.External["google"] {
		return "", ErrGoogleNotConfigured
	}
	query := url.Values{
		"provider": {"google"}, "redirect_to": {redirectURL},
		"code_challenge": {challenge}, "code_challenge_method": {"s256"},
		"scopes": {"openid email profile"},
	}
	return verifier.authURL("/authorize") + "?" + query.Encode(), nil
}

// ExchangeOAuthCode uses the existing publishable-key gateway, never a Google
// client secret. Codes are single-use: do not retry this exchange automatically.
func (verifier *SupabaseVerifier) ExchangeOAuthCode(ctx context.Context, code, proof string) (AuthResult, error) {
	var response supabaseAuthResponse
	status, err := verifier.doAuthJSON(ctx, http.MethodPost,
		verifier.authURL("/token")+"?grant_type=pkce", "",
		map[string]string{"auth_code": code, "code_verifier": proof}, &response)
	if err != nil {
		return AuthResult{}, err
	}
	if status == http.StatusTooManyRequests {
		return AuthResult{}, ErrAuthRateLimited
	}
	if status >= 400 && status < 500 {
		return AuthResult{}, ErrCredentialsInvalid
	}
	if status < 200 || status >= 300 || !response.validSession() {
		return AuthResult{}, fmt.Errorf("%w: invalid OAuth response", ErrProviderUnavailable)
	}
	return response.result(), nil
}
