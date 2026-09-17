package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSupabaseVerifierReturnsServerConfirmedPrincipal(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/auth/v1/user" {
			t.Fatalf("path = %q, want /auth/v1/user", request.URL.Path)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer user-token" {
			t.Fatalf("authorization = %q", got)
		}
		if got := request.Header.Get("apikey"); got != "publishable-key" {
			t.Fatalf("apikey = %q", got)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"id":"user-123","email":"user@example.com","user_metadata":{"role":"admin"}}`))
	}))
	defer server.Close()

	verifier, err := NewSupabaseVerifier(server.URL, "publishable-key", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	principal, err := verifier.Verify(context.Background(), "user-token")
	if err != nil {
		t.Fatal(err)
	}
	if principal.ID != "user-123" || principal.Email != "user@example.com" {
		t.Fatalf("principal = %+v", principal)
	}
}

func TestSupabaseVerifierMapsRejectedToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	verifier, _ := NewSupabaseVerifier(server.URL, "publishable-key", server.Client())
	_, err := verifier.Verify(context.Background(), "expired-token")
	if !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("error = %v, want ErrTokenInvalid", err)
	}
}

func TestSupabaseVerifierMapsProviderFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	verifier, _ := NewSupabaseVerifier(server.URL, "publishable-key", server.Client())
	_, err := verifier.Verify(context.Background(), "user-token")
	if !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("error = %v, want ErrProviderUnavailable", err)
	}
}

func TestSupabaseVerifierRejectsMissingUserID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"email":"user@example.com"}`))
	}))
	defer server.Close()

	verifier, _ := NewSupabaseVerifier(server.URL, "publishable-key", server.Client())
	_, err := verifier.Verify(context.Background(), "user-token")
	if !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("error = %v, want ErrProviderUnavailable", err)
	}
}

func TestBearerToken(t *testing.T) {
	token, err := BearerToken("Bearer access-token")
	if err != nil || token != "access-token" {
		t.Fatalf("token = %q, error = %v", token, err)
	}
	for _, header := range []string{"", "access-token", "Basic abc", "Bearer", "Bearer one two"} {
		if _, err := BearerToken(header); !errors.Is(err, ErrTokenRequired) {
			t.Errorf("header %q error = %v, want ErrTokenRequired", header, err)
		}
	}
}
