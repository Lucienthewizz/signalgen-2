package apitests

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
)

type fakeAuthService struct {
	result          auth.AuthResult
	err             error
	email           string
	password        string
	fullName        string
	redirectURL     string
	accessToken     string
	refreshToken    string
	resetPassword   string
	recoveryInvoked bool
}

func (fake *fakeAuthService) Register(_ context.Context, email, password, fullName string) (auth.AuthResult, error) {
	fake.email, fake.password, fake.fullName = email, password, fullName
	return fake.result, fake.err
}

func (fake *fakeAuthService) Login(_ context.Context, email, password string) (auth.AuthResult, error) {
	fake.email, fake.password = email, password
	return fake.result, fake.err
}

func (fake *fakeAuthService) RequestPasswordReset(_ context.Context, email, redirectURL string) error {
	fake.email, fake.redirectURL, fake.recoveryInvoked = email, redirectURL, true
	return fake.err
}

func (fake *fakeAuthService) Refresh(_ context.Context, token string) (auth.AuthResult, error) {
	fake.refreshToken = token
	return fake.result, fake.err
}

func (fake *fakeAuthService) ResetPassword(_ context.Context, accessToken, refreshToken, password string) error {
	fake.accessToken, fake.refreshToken, fake.resetPassword = accessToken, refreshToken, password
	return fake.err
}

func newAuthTestServer(t *testing.T, identity api.IdentityVerifier, service api.AuthService, options ...api.ServerOption) *api.Server {
	t.Helper()
	allOptions := append([]api.ServerOption{api.WithAuthService(service)}, options...)
	server, err := api.NewServer(identity, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{}, allOptions...)
	if err != nil {
		t.Fatal(err)
	}
	return server
}

func TestGoRegisterMatchesFrontendContract(t *testing.T) {
	service := &fakeAuthService{result: auth.AuthResult{
		User: auth.Principal{ID: "user-1", Email: "demo@example.test", FullName: "Demo User"},
	}}
	server := newAuthTestServer(t, fakeIdentity{}, service)
	request := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(`{
		"full_name":" Demo User ","email":"DEMO@example.test","password":"password-123"
	}`))
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if service.email != "demo@example.test" || service.fullName != "Demo User" {
		t.Fatalf("service input = %+v", service)
	}
	var body struct {
		RequiresConfirmation bool        `json:"requires_email_confirmation"`
		AccessToken          interface{} `json:"access_token"`
		User                 struct {
			ID       string `json:"id"`
			FullName string `json:"full_name"`
		} `json:"user"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.RequiresConfirmation || body.AccessToken != nil || body.User.ID != "user-1" || body.User.FullName != "Demo User" {
		t.Fatalf("body = %+v", body)
	}
}

func TestGoLoginReturnsSupabaseBearerSession(t *testing.T) {
	service := &fakeAuthService{result: auth.AuthResult{
		AccessToken: "access-token", RefreshToken: "refresh-token", TokenType: "bearer", ExpiresIn: 3600,
		User: auth.Principal{ID: "user-1", Email: "demo@example.test"},
	}}
	server := newAuthTestServer(t, fakeIdentity{}, service)
	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{
		"email":"demo@example.test","password":"password-123"
	}`))
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"access_token":"access-token"`) ||
		!strings.Contains(response.Body.String(), `"refresh_token":"refresh-token"`) ||
		response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestGoLoginHidesProviderCredentialDetails(t *testing.T) {
	service := &fakeAuthService{err: auth.ErrCredentialsInvalid}
	server := newAuthTestServer(t, fakeIdentity{}, service)
	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{
		"email":"demo@example.test","password":"wrong-password"
	}`))
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"AUTH_INVALID"`) {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestGoProfileUsesServerVerifiedBearerIdentity(t *testing.T) {
	identity := fakeIdentity{principal: auth.Principal{
		ID: "user-1", Email: "demo@example.test", FullName: "Demo User",
	}}
	server := newAuthTestServer(t, identity, &fakeAuthService{})
	request := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	request.Header.Set("Authorization", "Bearer access-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"full_name":"Demo User"`) {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestGoPasswordRecoveryMatchesFrontendContract(t *testing.T) {
	service := &fakeAuthService{}
	server := newAuthTestServer(
		t, fakeIdentity{}, service,
		api.WithPasswordResetRedirectURL("https://signalgen.example/?view=reset-password"),
	)
	request := httptest.NewRequest(http.MethodPost, "/api/auth/password/reset-request", strings.NewReader(`{"email":"demo@example.test"}`))
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !service.recoveryInvoked || service.redirectURL != "https://signalgen.example/?view=reset-password" {
		t.Fatalf("status = %d, service = %+v", response.Code, service)
	}

	request = httptest.NewRequest(http.MethodPost, "/api/auth/password/reset", strings.NewReader(`{
		"access_token":"recovery-access","refresh_token":"recovery-refresh","password":"new-password-123"
	}`))
	response = httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK || service.accessToken != "recovery-access" || service.refreshToken != "recovery-refresh" || service.resetPassword != "new-password-123" {
		t.Fatalf("status = %d, service = %+v", response.Code, service)
	}
}

func TestGoPasswordResetRejectsExpiredRecoverySession(t *testing.T) {
	service := &fakeAuthService{err: auth.ErrRecoveryInvalid}
	server := newAuthTestServer(t, fakeIdentity{}, service)
	request := httptest.NewRequest(http.MethodPost, "/api/auth/password/reset", strings.NewReader(`{
		"access_token":"expired-access","refresh_token":"expired-refresh","password":"new-password-123"
	}`))
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"AUTH_REJECTED"`) {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestGoAuthProviderOutageReturnsServiceUnavailable(t *testing.T) {
	service := &fakeAuthService{err: errors.New("network down")}
	server := newAuthTestServer(t, fakeIdentity{}, service)
	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{
		"email":"demo@example.test","password":"password-123"
	}`))
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}
