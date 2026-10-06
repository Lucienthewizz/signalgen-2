package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type supabaseAuthResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	ID           string `json:"id"`
	Email        string `json:"email"`
	UserMetadata struct {
		FullName string `json:"full_name"`
	} `json:"user_metadata"`
	User struct {
		ID           string `json:"id"`
		Email        string `json:"email"`
		UserMetadata struct {
			FullName string `json:"full_name"`
		} `json:"user_metadata"`
	} `json:"user"`
}

func (response supabaseAuthResponse) result() AuthResult {
	id := response.User.ID
	email := response.User.Email
	fullName := response.User.UserMetadata.FullName
	if id == "" {
		id = response.ID
		email = response.Email
		fullName = response.UserMetadata.FullName
	}
	return AuthResult{
		AccessToken:  response.AccessToken,
		RefreshToken: response.RefreshToken,
		TokenType:    response.TokenType,
		ExpiresIn:    response.ExpiresIn,
		User: Principal{
			ID:       id,
			Email:    email,
			FullName: fullName,
		},
	}
}

// Register creates a Supabase email/password identity. User metadata is used
// only for display; SignalGen roles and entitlements remain server-owned.
func (verifier *SupabaseVerifier) Register(ctx context.Context, email, password, fullName string) (AuthResult, error) {
	var response supabaseAuthResponse
	status, err := verifier.doAuthJSON(ctx, http.MethodPost, verifier.authURL("/signup"), "", map[string]interface{}{
		"email":    email,
		"password": password,
		"data": map[string]string{
			"full_name": fullName,
		},
	}, &response)
	if err != nil {
		return AuthResult{}, err
	}
	if status == http.StatusTooManyRequests {
		return AuthResult{}, ErrAuthRateLimited
	}
	result := response.result()
	if status >= 200 && status < 300 && result.AccessToken != "" && !response.validSession() {
		return AuthResult{}, fmt.Errorf("%w: incomplete signup session", ErrProviderUnavailable)
	}
	if status < 200 || status >= 300 || strings.TrimSpace(result.User.ID) == "" {
		if status >= 400 && status < 500 {
			return AuthResult{}, ErrRegistrationRejected
		}
		return AuthResult{}, fmt.Errorf("%w: signup status %d", ErrProviderUnavailable, status)
	}
	return result, nil
}

// Login exchanges email/password credentials for a Supabase access token.
func (verifier *SupabaseVerifier) Login(ctx context.Context, email, password string) (AuthResult, error) {
	var response supabaseAuthResponse
	status, err := verifier.doAuthJSON(
		ctx,
		http.MethodPost,
		verifier.authURL("/token")+"?grant_type=password",
		"",
		map[string]string{"email": email, "password": password},
		&response,
	)
	if err != nil {
		return AuthResult{}, err
	}
	if status == http.StatusTooManyRequests {
		return AuthResult{}, ErrAuthRateLimited
	}
	if status < 200 || status >= 300 || !response.validSession() {
		if status >= 400 && status < 500 {
			return AuthResult{}, ErrCredentialsInvalid
		}
		return AuthResult{}, fmt.Errorf("%w: login status %d", ErrProviderUnavailable, status)
	}
	return response.result(), nil
}

// Refresh delegates token rotation to Supabase. Never retry this exchange
// automatically: the provider owns reuse detection and token-family lifetime.
// No SignalGen app session, role, or entitlement is created or renewed here.
func (verifier *SupabaseVerifier) Refresh(ctx context.Context, refreshToken string) (AuthResult, error) {
	if strings.TrimSpace(refreshToken) == "" {
		return AuthResult{}, ErrRefreshInvalid
	}
	var response supabaseAuthResponse
	status, err := verifier.doAuthJSON(ctx, http.MethodPost,
		verifier.authURL("/token")+"?grant_type=refresh_token", "",
		map[string]string{"refresh_token": refreshToken}, &response)
	if err != nil {
		return AuthResult{}, err
	}
	if status == http.StatusTooManyRequests {
		return AuthResult{}, ErrAuthRateLimited
	}
	if status >= 400 && status < 500 {
		return AuthResult{}, ErrRefreshInvalid
	}
	if status < 200 || status >= 300 || !response.validSession() {
		return AuthResult{}, fmt.Errorf("%w: invalid refresh response", ErrProviderUnavailable)
	}
	return response.result(), nil
}

// An incomplete successful response cannot maintain a rotating client session.
func (response supabaseAuthResponse) validSession() bool {
	return strings.TrimSpace(response.AccessToken) != "" &&
		strings.TrimSpace(response.RefreshToken) != "" &&
		response.TokenType == "bearer" && response.ExpiresIn > 0 &&
		strings.TrimSpace(response.User.ID) != ""
}

// RequestPasswordReset asks Supabase to send a recovery email. redirectURL is
// allowlisted by Supabase Auth and points back to the web reset-password view.
func (verifier *SupabaseVerifier) RequestPasswordReset(ctx context.Context, email, redirectURL string) error {
	endpoint := verifier.authURL("/recover")
	if strings.TrimSpace(redirectURL) != "" {
		endpoint += "?redirect_to=" + url.QueryEscape(redirectURL)
	}
	status, err := verifier.doAuthJSON(ctx, http.MethodPost, endpoint, "", map[string]string{"email": email}, nil)
	if err != nil {
		return err
	}
	if status == http.StatusTooManyRequests {
		return ErrAuthRateLimited
	}
	if status >= 200 && status < 300 {
		return nil
	}
	if status >= 400 && status < 500 {
		return ErrRecoveryInvalid
	}
	return fmt.Errorf("%w: recovery status %d", ErrProviderUnavailable, status)
}

// ResetPassword refreshes the one-time recovery session, then updates the
// password using the resulting user bearer token. No privileged key is used.
func (verifier *SupabaseVerifier) ResetPassword(ctx context.Context, accessToken, refreshToken, password string) error {
	token := strings.TrimSpace(accessToken)
	if strings.TrimSpace(refreshToken) != "" {
		var refreshed supabaseAuthResponse
		status, err := verifier.doAuthJSON(
			ctx,
			http.MethodPost,
			verifier.authURL("/token")+"?grant_type=refresh_token",
			"",
			map[string]string{"refresh_token": refreshToken},
			&refreshed,
		)
		if err != nil {
			return err
		}
		if status == http.StatusTooManyRequests {
			return ErrAuthRateLimited
		}
		if status < 200 || status >= 300 || strings.TrimSpace(refreshed.AccessToken) == "" {
			if status >= 400 && status < 500 {
				return ErrRecoveryInvalid
			}
			return fmt.Errorf("%w: refresh status %d", ErrProviderUnavailable, status)
		}
		token = refreshed.AccessToken
	}
	if token == "" {
		return ErrRecoveryInvalid
	}

	status, err := verifier.doAuthJSON(
		ctx,
		http.MethodPut,
		verifier.authURL("/user"),
		token,
		map[string]string{"password": password},
		nil,
	)
	if err != nil {
		return err
	}
	if status == http.StatusTooManyRequests {
		return ErrAuthRateLimited
	}
	if status >= 200 && status < 300 {
		return nil
	}
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		return ErrRecoveryInvalid
	}
	if status >= 400 && status < 500 {
		return ErrPasswordRejected
	}
	return fmt.Errorf("%w: password update status %d", ErrProviderUnavailable, status)
}

func (verifier *SupabaseVerifier) authURL(path string) string {
	return strings.TrimSuffix(verifier.userEndpoint, "/user") + path
}

func (verifier *SupabaseVerifier) doAuthJSON(
	ctx context.Context,
	method, endpoint, bearer string,
	payload interface{},
	target interface{},
) (int, error) {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return 0, fmt.Errorf("encode Supabase auth request: %w", err)
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return 0, fmt.Errorf("build Supabase auth request: %w", err)
	}
	request.Header.Set("apikey", verifier.publishableKey)
	request.Header.Set("Accept", "application/json")
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(bearer) != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}

	response, err := verifier.client.Do(request)
	if err != nil {
		return 0, fmt.Errorf("%w: %v", ErrProviderUnavailable, err)
	}
	defer response.Body.Close()
	if target != nil && response.StatusCode >= 200 && response.StatusCode < 300 {
		// Read one extra byte to detect overflow; Unmarshal also rejects empty
		// bodies and trailing JSON instead of accepting a partial token pair.
		body, err := io.ReadAll(io.LimitReader(response.Body, maxUserResponseBytes+1))
		if err != nil || len(body) > maxUserResponseBytes || json.Unmarshal(body, target) != nil {
			return 0, fmt.Errorf("%w: invalid auth response", ErrProviderUnavailable)
		}
		return response.StatusCode, nil
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, maxUserResponseBytes))
	return response.StatusCode, nil
}
