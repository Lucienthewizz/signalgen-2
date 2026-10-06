package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSupabaseRefreshReturnsRotatedPair(t *testing.T) {
	count := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count++
		if r.Method != http.MethodPost || r.URL.Path != "/auth/v1/token" || r.URL.Query().Get("grant_type") != "refresh_token" ||
			r.Header.Get("apikey") != "publishable-key" || r.Header.Get("Authorization") != "" {
			t.Error("refresh must use publishable key and refresh grant, not an expired bearer")
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body["refresh_token"] != "old-refresh" || len(body) != 1 {
			t.Error("unexpected refresh request")
		}
		_, _ = w.Write([]byte(`{"access_token":"new-access","refresh_token":"new-refresh","token_type":"bearer","expires_in":3600,"user":{"id":"user-1","user_metadata":{"role":"operator","full_name":"Demo"}}}`))
	}))
	defer server.Close()
	provider, _ := NewSupabaseVerifier(server.URL, "publishable-key", server.Client())
	result, err := provider.Refresh(context.Background(), "old-refresh")
	if err != nil || result.AccessToken != "new-access" || result.RefreshToken != "new-refresh" || result.User.ID != "user-1" || result.User.FullName != "Demo" || count != 1 {
		t.Fatal("refresh did not return a complete rotated identity session")
	}
}

func TestSupabaseRefreshRejectsErrorsAndIncompleteSuccess(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{"invalid", 400, `{"message":"old-refresh secret"}`, ErrRefreshInvalid},
		{"revoked", 401, `{}`, ErrRefreshInvalid},
		{"rate limited", 429, `{}`, ErrAuthRateLimited},
		{"outage", 503, `{}`, ErrProviderUnavailable},
		{"empty", 200, "", ErrProviderUnavailable},
		{"malformed", 200, "{", ErrProviderUnavailable},
		{"trailing", 200, "{}{}", ErrProviderUnavailable},
		{"oversized", 200, strings.Repeat(" ", maxUserResponseBytes+1), ErrProviderUnavailable},
		{"missing rotation", 200, `{"access_token":"new","token_type":"bearer","expires_in":3600,"user":{"id":"u"}}`, ErrProviderUnavailable},
		{"missing identity", 200, `{"access_token":"new","refresh_token":"next","token_type":"bearer","expires_in":3600}`, ErrProviderUnavailable},
		{"wrong type", 200, `{"access_token":"new","refresh_token":"next","token_type":"invalid","expires_in":3600,"user":{"id":"u"}}`, ErrProviderUnavailable},
		{"expired", 200, `{"access_token":"new","refresh_token":"next","token_type":"bearer","expires_in":0,"user":{"id":"u"}}`, ErrProviderUnavailable},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			count := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				count++
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			provider, _ := NewSupabaseVerifier(server.URL, "publishable-key", server.Client())
			result, err := provider.Refresh(context.Background(), "old-refresh")
			if !errors.Is(err, tc.want) || result.AccessToken != "" || result.RefreshToken != "" || count != 1 {
				t.Fatal("provider failure must return no credentials and must not retry")
			}
			if strings.Contains(err.Error(), "old-refresh") {
				t.Fatal("provider error leaked refresh token")
			}
		})
	}
}

func TestSupabaseRefreshCancellationAndEmptyInput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("empty or cancelled request must not contact provider")
	}))
	defer server.Close()
	provider, _ := NewSupabaseVerifier(server.URL, "publishable-key", server.Client())
	if _, err := provider.Refresh(context.Background(), " "); !errors.Is(err, ErrRefreshInvalid) {
		t.Fatal("empty refresh must be rejected")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := provider.Refresh(ctx, "old-refresh"); !errors.Is(err, ErrProviderUnavailable) {
		t.Fatal("cancelled refresh must return provider unavailable")
	}
}
