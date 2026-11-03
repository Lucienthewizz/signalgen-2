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

	platformhttp "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/http"
)

const maxUserResponseBytes = 1 << 20

type HTTPClient interface {
	Do(request *http.Request) (*http.Response, error)
}

type SupabaseVerifier struct {
	userEndpoint   string
	publishableKey string
	client         HTTPClient
	local          *publicKeyVerifier
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

// EnableLocalVerification must run once before serving requests. Only public
// signing keys are cached; HS256 tokens still require Supabase Auth validation.
func (verifier *SupabaseVerifier) EnableLocalVerification() {
	verifier.local = newPublicKeyVerifier(strings.TrimSuffix(verifier.userEndpoint, "/user"), verifier.client)
}

// Verify never treats a decoded JWT payload as authenticated before signature
// and claim validation. App-session and account checks remain in the API guard.
func (verifier *SupabaseVerifier) Verify(ctx context.Context, accessToken string) (Principal, error) {
	accessToken = strings.TrimSpace(accessToken)
	if accessToken == "" {
		return Principal{}, ErrTokenRequired
	}
	if verifier.local != nil {
		return verifier.local.verify(ctx, accessToken, verifier.verifyRemote)
	}
	return verifier.verifyRemote(ctx, accessToken)
}

func (verifier *SupabaseVerifier) verifyRemote(ctx context.Context, accessToken string) (Principal, error) {
	started := time.Now()
	defer func() { platformhttp.RecordTiming(ctx, platformhttp.AuthRemote, time.Since(started)) }()

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
