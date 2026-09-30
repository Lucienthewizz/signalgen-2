package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSupabaseRegisterSupportsEmailConfirmation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/auth/v1/signup" {
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
		if request.Header.Get("apikey") != "publishable-key" {
			t.Fatalf("apikey = %q", request.Header.Get("apikey"))
		}
		var body struct {
			Email    string `json:"email"`
			Password string `json:"password"`
			Data     struct {
				FullName string `json:"full_name"`
			} `json:"data"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body.Email != "user@example.com" || body.Password != "password-123" || body.Data.FullName != "Demo User" {
			t.Fatalf("body = %+v", body)
		}
		writeTestJSON(writer, http.StatusOK, map[string]interface{}{
			"user": map[string]interface{}{
				"id": "user-123", "email": "user@example.com",
				"user_metadata": map[string]string{"full_name": "Demo User"},
			},
		})
	}))
	defer server.Close()

	provider, err := NewSupabaseVerifier(server.URL, "publishable-key", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	result, err := provider.Register(context.Background(), "user@example.com", "password-123", "Demo User")
	if err != nil {
		t.Fatal(err)
	}
	if result.AccessToken != "" || result.User.ID != "user-123" || result.User.FullName != "Demo User" {
		t.Fatalf("result = %+v", result)
	}
}

func TestSupabaseRegisterSupportsRootUserResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writeTestJSON(writer, http.StatusOK, map[string]interface{}{
			"id": "user-root-123", "email": "user@example.com",
			"user_metadata": map[string]string{"full_name": "Root User"},
		})
	}))
	defer server.Close()

	provider, err := NewSupabaseVerifier(server.URL, "publishable-key", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	result, err := provider.Register(context.Background(), "user@example.com", "password-123", "Root User")
	if err != nil {
		t.Fatal(err)
	}
	if result.AccessToken != "" || result.User.ID != "user-root-123" || result.User.FullName != "Root User" {
		t.Fatalf("result = %+v", result)
	}
}

func TestSupabaseLoginReturnsSession(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/auth/v1/token" || request.URL.Query().Get("grant_type") != "password" {
			t.Fatalf("url = %s", request.URL.String())
		}
		writeTestJSON(writer, http.StatusOK, map[string]interface{}{
			"access_token": "access-token", "token_type": "bearer", "expires_in": 3600,
			"user": map[string]interface{}{
				"id": "user-123", "email": "user@example.com",
				"user_metadata": map[string]string{"full_name": "Demo User"},
			},
		})
	}))
	defer server.Close()

	provider, _ := NewSupabaseVerifier(server.URL, "publishable-key", server.Client())
	result, err := provider.Login(context.Background(), "user@example.com", "password-123")
	if err != nil {
		t.Fatal(err)
	}
	if result.AccessToken != "access-token" || result.ExpiresIn != 3600 || result.User.Email != "user@example.com" {
		t.Fatalf("result = %+v", result)
	}
}

func TestSupabaseLoginHidesCredentialFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writeTestJSON(writer, http.StatusBadRequest, map[string]string{"error_code": "invalid_credentials"})
	}))
	defer server.Close()

	provider, _ := NewSupabaseVerifier(server.URL, "publishable-key", server.Client())
	_, err := provider.Login(context.Background(), "user@example.com", "wrong-password")
	if !errors.Is(err, ErrCredentialsInvalid) {
		t.Fatalf("error = %v", err)
	}
}

func TestSupabasePasswordRecoveryUsesConfiguredRedirect(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/auth/v1/recover" {
			t.Fatalf("path = %q", request.URL.Path)
		}
		if got := request.URL.Query().Get("redirect_to"); got != "https://signalgen.example/?view=reset-password" {
			t.Fatalf("redirect_to = %q", got)
		}
		writer.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	provider, _ := NewSupabaseVerifier(server.URL, "publishable-key", server.Client())
	if err := provider.RequestPasswordReset(context.Background(), "user@example.com", "https://signalgen.example/?view=reset-password"); err != nil {
		t.Fatal(err)
	}
}

func TestSupabaseResetRefreshesRecoverySessionBeforeUpdatingPassword(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestCount++
		switch requestCount {
		case 1:
			if request.URL.Path != "/auth/v1/token" || request.URL.Query().Get("grant_type") != "refresh_token" {
				t.Fatalf("refresh url = %s", request.URL.String())
			}
			writeTestJSON(writer, http.StatusOK, map[string]interface{}{
				"access_token": "fresh-access", "token_type": "bearer", "expires_in": 3600,
				"user": map[string]string{"id": "user-123", "email": "user@example.com"},
			})
		case 2:
			if request.Method != http.MethodPut || request.URL.Path != "/auth/v1/user" {
				t.Fatalf("update request = %s %s", request.Method, request.URL.Path)
			}
			if request.Header.Get("Authorization") != "Bearer fresh-access" {
				t.Fatalf("authorization = %q", request.Header.Get("Authorization"))
			}
			var body map[string]string
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["password"] != "new-password-123" {
				t.Fatalf("body = %+v", body)
			}
			writer.WriteHeader(http.StatusOK)
		default:
			t.Fatalf("unexpected request %d", requestCount)
		}
	}))
	defer server.Close()

	provider, _ := NewSupabaseVerifier(server.URL, "publishable-key", server.Client())
	if err := provider.ResetPassword(context.Background(), "recovery-access", "recovery-refresh", "new-password-123"); err != nil {
		t.Fatal(err)
	}
	if requestCount != 2 {
		t.Fatalf("requestCount = %d", requestCount)
	}
}

func writeTestJSON(writer http.ResponseWriter, status int, payload interface{}) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(payload)
}
