package apitests

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
)

type fakeGoogleAuth struct {
	fakeAuthService
	calls int
}

func (f *fakeGoogleAuth) GoogleAuthorizationURL(ctx context.Context, redirect, challenge string) (string, error) {
	f.calls++
	return "https://auth.example.test/authorize", f.err
}
func (f *fakeGoogleAuth) ExchangeOAuthCode(ctx context.Context, code, proof string) (auth.AuthResult, error) {
	f.calls++
	return f.result, f.err
}

func TestGoogleAuthRejectsOpenRedirectsAndMalformedProofs(t *testing.T) {
	fake := &fakeGoogleAuth{}
	s := newAuthTestServer(t, fakeIdentity{}, fake, api.WithCORSOrigins([]string{"http://localhost:5174"}))
	challenge := strings.Repeat("A", 43)
	for _, callback := range []string{"https://evil.test/auth/google/callback", "http://localhost:5174.evil.test/auth/google/callback", "http://127.0.0.1:5174/auth/google/callback", "http://localhost:5174/auth/google/callback?next=https://evil.test", "http://localhost:5174/auth/google/callback#fragment", "http://localhost:5174/other", "http://user@localhost:5174/auth/google/callback", ":bad"} {
		r := httptest.NewRequest("POST", "/api/auth/google/start", strings.NewReader(`{"redirect_to":"`+callback+`","code_challenge":"`+challenge+`"}`))
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != 422 || fake.calls != 0 || w.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("unsafe callback accepted: %q %d", callback, w.Code)
		}
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("POST", "/api/auth/google/start", strings.NewReader(`{"redirect_to":"http://localhost:5174/auth/google/callback","code_challenge":"`+challenge+`"}`)))
	if w.Code != 200 || fake.calls != 1 {
		t.Fatalf("valid start rejected: %d %s", w.Code, w.Body.String())
	}
	for _, proof := range []string{"", "short", strings.Repeat("?", 43), strings.Repeat("a", 129)} {
		w = httptest.NewRecorder()
		s.ServeHTTP(w, httptest.NewRequest("POST", "/api/auth/google/exchange", strings.NewReader(`{"code":"code","code_verifier":"`+proof+`"}`)))
		if w.Code != 422 || fake.calls != 1 {
			t.Fatalf("invalid proof accepted: %d", w.Code)
		}
	}
}

func TestGoogleExchangePreservesExistingSessionContract(t *testing.T) {
	fake := &fakeGoogleAuth{fakeAuthService: fakeAuthService{result: auth.AuthResult{AccessToken: "access", RefreshToken: "refresh", TokenType: "bearer", ExpiresIn: 3600, User: auth.Principal{ID: "user-a"}}}}
	s := newAuthTestServer(t, fakeIdentity{}, fake)
	w := httptest.NewRecorder()
	s.ServeHTTP(w, httptest.NewRequest("POST", "/api/auth/google/exchange", strings.NewReader(`{"code":"code","code_verifier":"`+strings.Repeat("a", 43)+`"}`)))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"access_token":"access"`) || strings.Contains(w.Body.String(), "app_session") || strings.Contains(w.Body.String(), "entitlement") || w.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("response: %d %s", w.Code, w.Body.String())
	}
}
