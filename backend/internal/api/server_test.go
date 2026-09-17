package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

type fakeIdentity struct {
	principal auth.Principal
	err       error
}

func (fake fakeIdentity) Verify(_ context.Context, _ string) (auth.Principal, error) {
	return fake.principal, fake.err
}

type fakeSessions struct {
	created        session.Created
	verified       session.Session
	verifyError    error
	createdUserID  string
	verifiedUserID string
	verifiedToken  string
	revokedUserID  string
	revokedToken   string
}

type fakeAccess struct {
	account       access.Account
	features      []string
	err           error
	ensuredUserID string
	ensuredEmail  string
}

func (fake *fakeAccess) EnsureProfile(_ context.Context, userID, email string) (access.Account, error) {
	fake.ensuredUserID = userID
	fake.ensuredEmail = email
	if fake.err != nil {
		return access.Account{}, fake.err
	}
	return fake.accountFor(userID, email), nil
}

func (fake *fakeAccess) RequireActive(_ context.Context, userID string) (access.Account, error) {
	if fake.err != nil {
		return access.Account{}, fake.err
	}
	return fake.accountFor(userID, ""), nil
}

func (fake *fakeAccess) Features(_ context.Context, _ string) ([]string, error) {
	if fake.err != nil {
		return nil, fake.err
	}
	return fake.features, nil
}

func (fake *fakeAccess) accountFor(userID, email string) access.Account {
	if fake.account.UserID != "" {
		return fake.account
	}
	return access.Account{UserID: userID, Email: email, Role: access.RoleUser, Status: access.StatusActive}
}

func (fake *fakeSessions) Create(_ context.Context, userID, installationID, label string) (session.Created, error) {
	fake.createdUserID = userID
	if installationID == "" || label == "" {
		return session.Created{}, session.ErrInvalidRequest
	}
	return fake.created, nil
}

func (fake *fakeSessions) Verify(_ context.Context, userID, token string) (session.Session, error) {
	fake.verifiedUserID = userID
	fake.verifiedToken = token
	return fake.verified, fake.verifyError
}

func (fake *fakeSessions) Revoke(_ context.Context, userID, token string) error {
	fake.revokedUserID = userID
	fake.revokedToken = token
	return nil
}

func testServer(t *testing.T, identity fakeIdentity, sessions *fakeSessions) *Server {
	t.Helper()
	server, err := NewServer(identity, sessions, &fakeAccess{})
	if err != nil {
		t.Fatal(err)
	}
	return server
}

func TestHealthIsPublic(t *testing.T) {
	server := testServer(t, fakeIdentity{}, &fakeSessions{})
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/health", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
}

func TestCreateSessionUsesBearerPrincipal(t *testing.T) {
	sessions := &fakeSessions{created: session.Created{
		Session: session.Session{ID: "ses_1", ExpiresAt: time.Date(2026, 9, 18, 0, 0, 0, 0, time.UTC)},
		Token:   "sgs_once",
	}}
	identity := fakeIdentity{principal: auth.Principal{ID: "user-a", Email: "user@example.com"}}
	accountStore := &fakeAccess{}
	server, err := NewServer(identity, sessions, accountStore)
	if err != nil {
		t.Fatal(err)
	}
	body := bytes.NewBufferString(`{"installation_id":"install-a","label":"Chrome","client":{"app_version":"web-0.1","user_agent_family":"Chrome"}}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", body)
	request.Header.Set("Authorization", "Bearer user-token")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if sessions.createdUserID != "user-a" {
		t.Fatalf("created user = %q", sessions.createdUserID)
	}
	if accountStore.ensuredUserID != "user-a" || accountStore.ensuredEmail != "user@example.com" {
		t.Fatalf("ensured profile = user %q email %q", accountStore.ensuredUserID, accountStore.ensuredEmail)
	}
	if response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("cache control = %q", response.Header().Get("Cache-Control"))
	}
}

func TestCapabilitiesRequiresBearerAndMatchingAppSession(t *testing.T) {
	sessions := &fakeSessions{}
	server := testServer(t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions)

	missingBearer := httptest.NewRecorder()
	server.ServeHTTP(missingBearer, httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil))
	assertErrorCode(t, missingBearer, http.StatusUnauthorized, "AUTH_REQUIRED")

	request := httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil)
	request.Header.Set("Authorization", "Bearer user-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if sessions.verifiedUserID != "user-a" || sessions.verifiedToken != "sgs_session" {
		t.Fatalf("verification = user %q token %q", sessions.verifiedUserID, sessions.verifiedToken)
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["engine_version"] != "core-0.2.0" {
		t.Fatalf("engine version = %v", payload["engine_version"])
	}
}

func TestCapabilitiesRejectsExpiredSession(t *testing.T) {
	sessions := &fakeSessions{verifyError: session.ErrExpired}
	server := testServer(t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil)
	request.Header.Set("Authorization", "Bearer user-token")
	request.Header.Set("X-App-Session", "sgs_expired")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusForbidden, "SESSION_EXPIRED")
}

func TestPrivateRouteRejectsSuspendedAccount(t *testing.T) {
	sessions := &fakeSessions{}
	server, err := NewServer(
		fakeIdentity{principal: auth.Principal{ID: "user-a"}},
		sessions,
		&fakeAccess{err: access.ErrAccountSuspended},
	)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil)
	request.Header.Set("Authorization", "Bearer user-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusForbidden, "ACCOUNT_SUSPENDED")
}

func TestAccountMeReturnsServerSideAccessState(t *testing.T) {
	sessions := &fakeSessions{verified: session.Session{
		ID: "ses_1", InstallationID: "install-a", Label: "Chrome",
		ExpiresAt: time.Date(2026, 9, 18, 0, 0, 0, 0, time.UTC),
	}}
	accountStore := &fakeAccess{
		account:  access.Account{UserID: "user-a", Email: "user@example.com", Role: access.RoleUser, Status: access.StatusActive},
		features: []string{access.FeatureScreener},
	}
	server, err := NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions, accountStore)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/account/me", nil)
	request.Header.Set("Authorization", "Bearer user-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload struct {
		User struct {
			Role string `json:"role"`
		} `json:"user"`
		Features []string `json:"features"`
		Device   struct {
			InstallationID string `json:"installation_id"`
		} `json:"device"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.User.Role != access.RoleUser || len(payload.Features) != 1 || payload.Device.InstallationID != "install-a" {
		t.Fatalf("payload = %+v", payload)
	}
}

func TestIdentityProviderFailureIsSanitized(t *testing.T) {
	server := testServer(t, fakeIdentity{err: errors.New("upstream leaked detail")}, &fakeSessions{})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", bytes.NewBufferString(`{}`))
	request.Header.Set("Authorization", "Bearer user-token")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE")
	if bytes.Contains(response.Body.Bytes(), []byte("leaked detail")) {
		t.Fatal("internal provider error leaked to client")
	}
}

func TestRevokeCurrentSession(t *testing.T) {
	sessions := &fakeSessions{}
	server := testServer(t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions)
	request := httptest.NewRequest(http.MethodDelete, "/api/v1/sessions/current", nil)
	request.Header.Set("Authorization", "Bearer user-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d", response.Code)
	}
	if sessions.revokedUserID != "user-a" || sessions.revokedToken != "sgs_session" {
		t.Fatalf("revocation = user %q token %q", sessions.revokedUserID, sessions.revokedToken)
	}
}

func TestSessionLifecycleWithSQLite(t *testing.T) {
	db, err := sql.Open("sqlite", "file:api_lifecycle?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	sessions, err := session.NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := sessions.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	accessStore, err := access.NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := accessStore.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions, accessStore)
	if err != nil {
		t.Fatal(err)
	}

	createRequest := httptest.NewRequest(http.MethodPost, "/api/v1/sessions",
		bytes.NewBufferString(`{"installation_id":"install-a","label":"Chrome"}`))
	createRequest.Header.Set("Authorization", "Bearer user-token")
	createResponse := httptest.NewRecorder()
	server.ServeHTTP(createResponse, createRequest)
	if createResponse.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", createResponse.Code, createResponse.Body.String())
	}
	var created session.Created
	if err := json.Unmarshal(createResponse.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}

	callCapabilities := func() *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil)
		request.Header.Set("Authorization", "Bearer user-token")
		request.Header.Set("X-App-Session", created.Token)
		response := httptest.NewRecorder()
		server.ServeHTTP(response, request)
		return response
	}
	if response := callCapabilities(); response.Code != http.StatusOK {
		t.Fatalf("capabilities status = %d, body = %s", response.Code, response.Body.String())
	}

	revokeRequest := httptest.NewRequest(http.MethodDelete, "/api/v1/sessions/current", nil)
	revokeRequest.Header.Set("Authorization", "Bearer user-token")
	revokeRequest.Header.Set("X-App-Session", created.Token)
	revokeResponse := httptest.NewRecorder()
	server.ServeHTTP(revokeResponse, revokeRequest)
	if revokeResponse.Code != http.StatusNoContent {
		t.Fatalf("revoke status = %d", revokeResponse.Code)
	}
	assertErrorCode(t, callCapabilities(), http.StatusForbidden, "SESSION_REVOKED")
}

func assertErrorCode(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if response.Code != status {
		t.Fatalf("status = %d, want %d; body = %s", response.Code, status, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("cache control = %q", response.Header().Get("Cache-Control"))
	}
	var payload struct {
		Error struct {
			Code      string `json:"code"`
			RequestID string `json:"request_id"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error.Code != code || payload.Error.RequestID == "" {
		t.Fatalf("error = %+v", payload.Error)
	}
}
