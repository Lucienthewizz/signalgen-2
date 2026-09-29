package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxUserResponseBytes = 1 << 20

type HTTPClient interface {
	Do(request *http.Request) (*http.Response, error)
}

type SupabaseVerifier struct {
	userEndpoint   string
	publishableKey string
	client         HTTPClient
}

func NewSupabaseVerifier(projectURL, publishableKey string, client HTTPClient) (*SupabaseVerifier, error) {
	projectURL = strings.TrimRight(strings.TrimSpace(projectURL), "/")
	parsed, err := url.Parse(projectURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return nil, fmt.Errorf("invalid Supabase URL")
	}
	if strings.TrimSpace(publishableKey) == "" {
		return nil, fmt.Errorf("Supabase publishable key is required")
	}
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &SupabaseVerifier{
		userEndpoint:   projectURL + "/auth/v1/user",
		publishableKey: publishableKey,
		client:         client,
	}, nil
}

// Verify asks Supabase Auth for the current user. This deliberately performs a
// network validation so the API does not trust an unverified JWT payload.
func (verifier *SupabaseVerifier) Verify(ctx context.Context, accessToken string) (Principal, error) {
	accessToken = strings.TrimSpace(accessToken)
	if accessToken == "" {
		return Principal{}, ErrTokenRequired
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, verifier.userEndpoint, nil)
	if err != nil {
		return Principal{}, fmt.Errorf("build Supabase user request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("apikey", verifier.publishableKey)
	request.Header.Set("Accept", "application/json")

	response, err := verifier.client.Do(request)
	if err != nil {
		return Principal{}, fmt.Errorf("%w: %v", ErrProviderUnavailable, err)
	}
	defer response.Body.Close()

	switch {
	case response.StatusCode == http.StatusOK:
		// Continue below.
	case response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden:
		return Principal{}, ErrTokenInvalid
	default:
		return Principal{}, fmt.Errorf("%w: unexpected status %d", ErrProviderUnavailable, response.StatusCode)
	}

	var payload struct {
		ID           string `json:"id"`
		Email        string `json:"email"`
		UserMetadata struct {
			FullName string `json:"full_name"`
		} `json:"user_metadata"`
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, maxUserResponseBytes))
	if err := decoder.Decode(&payload); err != nil {
		return Principal{}, fmt.Errorf("%w: invalid user response", ErrProviderUnavailable)
	}
	if strings.TrimSpace(payload.ID) == "" {
		return Principal{}, fmt.Errorf("%w: user id is missing", ErrProviderUnavailable)
	}

	return Principal{ID: payload.ID, Email: payload.Email, FullName: payload.UserMetadata.FullName}, nil
}

// BearerToken extracts a strict Authorization bearer token. It never accepts
// API keys or alternate schemes as user credentials.
func BearerToken(header string) (string, error) {
	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return "", ErrTokenRequired
	}
	return parts[1], nil
}
