package apitests

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/ratelimit"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

func TestAuthRefreshContractWithoutAccessBearer(t *testing.T) {
	service := &fakeAuthService{result: auth.AuthResult{
		AccessToken: "new-access", RefreshToken: "new-refresh", TokenType: "bearer", ExpiresIn: 3600,
		User: auth.Principal{ID: "user-1", Email: "demo@example.test"},
	}}
	server := newAuthTestServer(t, fakeIdentity{err: auth.ErrTokenInvalid}, service)
	request := httptest.NewRequest(http.MethodPost, "/api/auth/refresh", strings.NewReader(`{"refresh_token":"old-refresh"}`))
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || service.refreshToken != "old-refresh" || body["access_token"] != "new-access" ||
		body["refresh_token"] != "new-refresh" || response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal("refresh must return rotated pair without requiring a current access bearer")
	}
	for _, field := range []string{"session_token", "features", "role", "entitlements"} {
		if _, exists := body[field]; exists {
			t.Fatal("identity refresh must not grant app authorization")
		}
	}
	// A new access token is not a substitute for a valid server app session.
	request = httptest.NewRequest(http.MethodGet, "/api/v1/account/me", nil)
	request.Header.Set("Authorization", "Bearer new-access")
	response = httptest.NewRecorder()
	server.Identity = fakeIdentity{principal: service.result.User}
	server.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatal("refresh bypassed app-session requirement")
	}
	for _, failure := range []error{session.ErrRevoked, session.ErrExpired} {
		server.Sessions = &fakeSessions{verifyError: failure}
		request = httptest.NewRequest(http.MethodGet, "/api/v1/account/me", nil)
		request.Header.Set("Authorization", "Bearer new-access")
		request.Header.Set("X-App-Session", "old-app-session")
		response = httptest.NewRecorder()
		server.ServeHTTP(response, request)
		if response.Code != http.StatusForbidden {
			t.Fatal("identity refresh revived an invalid app session")
		}
	}
}

// This exercises the real provider adapter through Go routes over HTTP.
// The upstream is local and deterministic, not a real Supabase account.
func TestAuthHTTPLoginRefreshAndMe(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/auth/v1/token" && r.URL.Query().Get("grant_type") == "password":
			_, _ = w.Write([]byte(`{"access_token":"old-access","refresh_token":"old-refresh","token_type":"bearer","expires_in":3600,"user":{"id":"user-1","email":"demo@example.test"}}`))
		case r.URL.Path == "/auth/v1/token" && r.URL.Query().Get("grant_type") == "refresh_token":
			var body map[string]string
			if json.NewDecoder(r.Body).Decode(&body) != nil || body["refresh_token"] != "old-refresh" {
				w.WriteHeader(400)
				_, _ = w.Write([]byte(`{}`))
				return
			}
			_, _ = w.Write([]byte(`{"access_token":"new-access","refresh_token":"new-refresh","token_type":"bearer","expires_in":3600,"user":{"id":"user-1","email":"demo@example.test"}}`))
		case r.URL.Path == "/auth/v1/user" && r.Header.Get("Authorization") == "Bearer new-access":
			_, _ = w.Write([]byte(`{"id":"user-1","email":"demo@example.test"}`))
		default:
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{}`))
		}
	}))
	defer upstream.Close()
	provider, err := auth.NewSupabaseVerifier(upstream.URL, "publishable-test", upstream.Client())
	if err != nil {
		t.Fatal(err)
	}
	api := httptest.NewServer(newAuthTestServer(t, provider, provider))
	defer api.Close()
	call := func(method, path, body, bearer string, want int) map[string]any {
		t.Helper()
		req, err := http.NewRequest(method, api.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		res, err := api.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var result map[string]any
		if json.NewDecoder(res.Body).Decode(&result) != nil || res.StatusCode != want {
			t.Fatalf("HTTP auth contract failed: %s returned %d, wanted %d", path, res.StatusCode, want)
		}
		return result
	}
	login := call("POST", "/api/auth/login", `{"email":"demo@example.test","password":"test-password-only"}`, "", 200)
	if login["refresh_token"] != "old-refresh" {
		t.Fatal("login lost refresh token")
	}
	rotated := call("POST", "/api/auth/refresh", `{"refresh_token":"old-refresh"}`, "", 200)
	if rotated["access_token"] != "new-access" || rotated["refresh_token"] != "new-refresh" {
		t.Fatal("rotation failed")
	}
	call("GET", "/api/auth/me", "", "old-access", 401)
	me := call("GET", "/api/auth/me", "", "new-access", 200)
	if me["id"] != "user-1" {
		t.Fatal("refresh changed identity")
	}
}

func TestAuthRefreshInputAndProviderFailures(t *testing.T) {
	for _, tc := range []struct {
		body   string
		err    error
		status int
		code   string
	}{
		{`{}`, nil, 422, "INVALID_REQUEST"},
		{`{"refresh_token":" "}`, nil, 422, "INVALID_REQUEST"},
		{`{"refresh_token":"ok","role":"operator"}`, nil, 400, "INVALID_REQUEST"},
		{`{"refresh_token":"` + strings.Repeat("x", 4097) + `"}`, nil, 422, "INVALID_REQUEST"},
		{`{"refresh_token":"secret"}`, auth.ErrRefreshInvalid, 401, "AUTH_INVALID"},
		{`{"refresh_token":"secret"}`, auth.ErrAuthRateLimited, 429, "RATE_LIMITED"},
		{`{"refresh_token":"secret"}`, auth.ErrProviderUnavailable, 503, "SERVICE_UNAVAILABLE"},
	} {
		service := &fakeAuthService{err: tc.err}
		server := newAuthTestServer(t, fakeIdentity{}, service)
		response := httptest.NewRecorder()
		server.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/auth/refresh", strings.NewReader(tc.body)))
		if response.Code != tc.status || !strings.Contains(response.Body.String(), tc.code) ||
			strings.Contains(response.Body.String(), "secret") || response.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("status=%d, wanted=%d, body=%s", response.Code, tc.status, response.Body.String())
		}
		if tc.err == nil && service.refreshToken != "" {
			t.Fatal("invalid request reached provider")
		}
	}
}

func TestAuthRefreshPublicRateLimitAndMissingProvider(t *testing.T) {
	limiter, _ := ratelimit.New(1, time.Minute)
	service := &fakeAuthService{err: auth.ErrRefreshInvalid}
	server := newAuthTestServer(t, fakeIdentity{}, service, api.WithRateLimiter(limiter))
	for _, status := range []int{401, 429} {
		response := httptest.NewRecorder()
		server.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/auth/refresh", strings.NewReader(`{"refresh_token":"secret"}`)))
		if response.Code != status {
			t.Fatalf("status=%d, wanted=%d", response.Code, status)
		}
		if status == 429 && response.Header().Get("Retry-After") == "" {
			t.Fatal("missing retry hint")
		}
	}
	server = newAuthTestServer(t, fakeIdentity{}, &fakeAuthService{})
	server.Auth = nil
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/auth/refresh", strings.NewReader(`{"refresh_token":"secret"}`)))
	if response.Code != 503 {
		t.Fatal("missing provider must fail closed")
	}
}
