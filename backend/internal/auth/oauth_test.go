package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestGooglePKCEGateway(t *testing.T) {
	providerServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/auth/v1/settings" {
			writeTestJSON(w, 200, map[string]interface{}{"external": map[string]bool{"google": true}})
			return
		}
		if r.Method != "POST" || r.URL.Path != "/auth/v1/token" || r.URL.Query().Get("grant_type") != "pkce" || r.Header.Get("apikey") != "public-key" {
			t.Fatal("invalid exchange request")
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["auth_code"] != "single-use-code" || body["code_verifier"] != "proof" {
			t.Fatal("proof not forwarded")
		}
		writeTestJSON(w, 200, map[string]interface{}{
			"access_token": "access", "refresh_token": "refresh", "token_type": "bearer", "expires_in": 3600,
			"provider_token": "discard-this-google-token", "user": map[string]string{"id": "user-1", "email": "demo@example.test"},
		})
	}))
	defer providerServer.Close()
	provider, _ := NewSupabaseVerifier(providerServer.URL, "public-key", providerServer.Client())
	authURL, err := provider.GoogleAuthorizationURL(context.Background(), "http://localhost:5174/auth/google/callback", "challenge")
	if err != nil {
		t.Fatal(err)
	}
	start, _ := url.Parse(authURL)
	if start.Path != "/auth/v1/authorize" || start.Query().Get("provider") != "google" || start.Query().Get("code_challenge_method") != "s256" || start.Query().Get("code_challenge") != "challenge" || start.Query().Get("redirect_to") != "http://localhost:5174/auth/google/callback" || start.Query().Get("scopes") != "openid email profile" {
		t.Fatal("invalid authorization URL")
	}
	result, err := provider.ExchangeOAuthCode(context.Background(), "single-use-code", "proof")
	if err != nil || result.User.ID != "user-1" || result.AccessToken != "access" {
		t.Fatalf("exchange: %v", err)
	}
}

func TestGoogleExchangeRejectsProviderFailuresAndIncompleteSessions(t *testing.T) {
	for _, tc := range []struct {
		status int
		body   string
		want   error
	}{
		{400, `{}`, ErrCredentialsInvalid}, {429, `{}`, ErrAuthRateLimited},
		{503, `{}`, ErrProviderUnavailable}, {200, `{"access_token":"partial"}`, ErrProviderUnavailable},
	} {
		t.Run(http.StatusText(tc.status), func(t *testing.T) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer s.Close()
			provider, _ := NewSupabaseVerifier(s.URL, "public-key", s.Client())
			_, err := provider.ExchangeOAuthCode(context.Background(), "code", "proof")
			if !errors.Is(err, tc.want) {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

func TestGoogleStartFailsClosedWhenProviderDisabled(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeTestJSON(w, 200, map[string]interface{}{"external": map[string]bool{"google": false}})
	}))
	defer s.Close()
	provider, _ := NewSupabaseVerifier(s.URL, "public-key", s.Client())
	_, err := provider.GoogleAuthorizationURL(context.Background(), "http://localhost:5174/auth/google/callback", "challenge")
	if !errors.Is(err, ErrGoogleNotConfigured) {
		t.Fatalf("error = %v", err)
	}
}
