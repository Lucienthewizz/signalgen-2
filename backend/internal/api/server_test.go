package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
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
	listed         []session.Session
	revokedID      string
	createError    error
}

type fakeAccess struct {
	account       access.Account
	features      []string
	grants        []access.FeatureGrant
	err           error
	ensuredUserID string
	ensuredEmail  string
	grantActor    string
	grantRequest  string
	grantUserID   string
	grantFeature  string
	grantReason   string
	grantUntil    time.Time
	revokeActor   string
	revokeRequest string
	revokeUserID  string
	revokeFeature string
	revokeReason  string
}

func (fake *fakeAccess) RequireFeature(_ context.Context, _ string, feature string) error {
	if fake.err != nil {
		return fake.err
	}
	for _, granted := range fake.features {
		if granted == feature {
			return nil
		}
	}
	return access.ErrEntitlementMissing
}

type fakeDatasets struct {
	manifest dataset.Manifest
	content  []byte
	err      error
}

type fakeCompute struct {
	created compute.CreateRequest
	grant   compute.Grant
	err     error
}

type fakeReadiness struct{ err error }

func (fake fakeReadiness) Ready(_ context.Context) error { return fake.err }

func (fake *fakeCompute) Create(_ context.Context, request compute.CreateRequest) (compute.Grant, error) {
	fake.created = request
	return fake.grant, fake.err
}

func (fake *fakeDatasets) Prepare(_ dataset.PrepareRequest) (dataset.Manifest, error) {
	return fake.manifest, fake.err
}

func (fake *fakeDatasets) Manifest(_ string) (dataset.Manifest, error) {
	return fake.manifest, fake.err
}

func (fake *fakeDatasets) Content(_ string) ([]byte, dataset.Manifest, error) {
	return fake.content, fake.manifest, fake.err
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

func (fake *fakeAccess) RequireOperator(_ context.Context, userID string) (access.Account, error) {
	if fake.err != nil {
		return access.Account{}, fake.err
	}
	account := fake.accountFor(userID, "")
	if account.Role != access.RoleOperator {
		return access.Account{}, access.ErrRoleRequired
	}
	return account, nil
}

func (fake *fakeAccess) Features(_ context.Context, _ string) ([]string, error) {
	if fake.err != nil {
		return nil, fake.err
	}
	return fake.features, nil
}

func (fake *fakeAccess) FeatureGrants(_ context.Context, userID string) ([]access.FeatureGrant, error) {
	if fake.err != nil {
		return nil, fake.err
	}
	items := make([]access.FeatureGrant, 0, len(fake.grants))
	for _, grant := range fake.grants {
		if grant.UserID == userID {
			items = append(items, grant)
		}
	}
	return items, nil
}

func (fake *fakeAccess) GrantFeatureAudited(_ context.Context, actor, requestID, userID, feature string, validUntil time.Time, reason string) (access.FeatureGrant, error) {
	if fake.err != nil {
		return access.FeatureGrant{}, fake.err
	}
	fake.grantActor, fake.grantRequest = actor, requestID
	fake.grantUserID, fake.grantFeature = userID, feature
	fake.grantUntil, fake.grantReason = validUntil, reason
	fake.grants = []access.FeatureGrant{{
		UserID: userID, Feature: feature, ValidUntil: validUntil, Reason: reason, Active: true,
	}}
	return fake.grants[0], nil
}

func (fake *fakeAccess) RevokeFeatureAudited(_ context.Context, actor, requestID, userID, feature, reason string) error {
	if fake.err != nil {
		return fake.err
	}
	fake.revokeActor, fake.revokeRequest = actor, requestID
	fake.revokeUserID, fake.revokeFeature, fake.revokeReason = userID, feature, reason
	return nil
}

func (fake *fakeAccess) accountFor(userID, email string) access.Account {
	if fake.account.UserID != "" {
		return fake.account
	}
	return access.Account{UserID: userID, Email: email, Role: access.RoleUser, Status: access.StatusActive}
}

func (fake *fakeSessions) Create(_ context.Context, userID, installationID, label string) (session.Created, error) {
	fake.createdUserID = userID
	if fake.createError != nil {
		return session.Created{}, fake.createError
	}
	if installationID == "" || label == "" {
		return session.Created{}, session.ErrInvalidRequest
	}
	return fake.created, nil
}

func (fake *fakeSessions) ActiveLimit() int { return 3 }

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

func (fake *fakeSessions) List(_ context.Context, userID string) ([]session.Session, error) {
	fake.verifiedUserID = userID
	return fake.listed, nil
}

func (fake *fakeSessions) RevokeByID(_ context.Context, userID, sessionID string) error {
	fake.revokedUserID = userID
	fake.revokedID = sessionID
	return nil
}

func testServer(t *testing.T, identity fakeIdentity, sessions *fakeSessions) *Server {
	t.Helper()
	server, err := NewServer(identity, sessions, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{})
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

func TestReadinessChecksDependenciesWithoutLeakingDetails(t *testing.T) {
	server, err := NewServer(
		fakeIdentity{}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{},
		WithReadinessChecks(fakeReadiness{}, fakeReadiness{err: errors.New("database path secret")}),
	)
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/ready", nil))
	assertErrorCode(t, response, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE")
	if bytes.Contains(response.Body.Bytes(), []byte("database path secret")) {
		t.Fatal("readiness response leaked dependency details")
	}

	readyServer, err := NewServer(
		fakeIdentity{}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{},
		WithReadinessChecks(fakeReadiness{}),
	)
	if err != nil {
		t.Fatal(err)
	}
	readyResponse := httptest.NewRecorder()
	readyServer.ServeHTTP(readyResponse, httptest.NewRequest(http.MethodGet, "/ready", nil))
	if readyResponse.Code != http.StatusOK || !bytes.Contains(readyResponse.Body.Bytes(), []byte(`"status":"ready"`)) {
		t.Fatalf("status = %d, body = %s", readyResponse.Code, readyResponse.Body.String())
	}
}

func TestCORSAllowsConfiguredBrowserOrigin(t *testing.T) {
	server, err := NewServer(
		fakeIdentity{}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{},
		WithCORSOrigins([]string{"http://localhost:5173"}),
	)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodOptions, "/api/v1/sessions", nil)
	request.Header.Set("Origin", "http://localhost:5173")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Fatalf("allow origin = %q", response.Header().Get("Access-Control-Allow-Origin"))
	}
	if response.Header().Get("Access-Control-Allow-Headers") != "Authorization, Content-Type, X-App-Session" {
		t.Fatalf("allow headers = %q", response.Header().Get("Access-Control-Allow-Headers"))
	}
}

func TestCORSRejectsUnlistedPreflightOrigin(t *testing.T) {
	server, err := NewServer(
		fakeIdentity{}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{},
		WithCORSOrigins([]string{"https://app.signalgen.example"}),
	)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodOptions, "/api/v1/sessions", nil)
	request.Header.Set("Origin", "https://evil.example")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusForbidden, "ORIGIN_NOT_ALLOWED")
	if response.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("unexpected allow origin = %q", response.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestCORSRejectsInvalidConfiguration(t *testing.T) {
	_, err := NewServer(
		fakeIdentity{}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{},
		WithCORSOrigins([]string{"*"}),
	)
	if err == nil {
		t.Fatal("expected invalid CORS origin error")
	}
}

func TestCreateSessionUsesBearerPrincipal(t *testing.T) {
	sessions := &fakeSessions{created: session.Created{
		Session: session.Session{ID: "ses_1", ExpiresAt: time.Date(2026, 9, 18, 0, 0, 0, 0, time.UTC)},
		Token:   "sgs_once",
	}}
	identity := fakeIdentity{principal: auth.Principal{ID: "user-a", Email: "user@example.com"}}
	accountStore := &fakeAccess{}
	server, err := NewServer(identity, sessions, accountStore, &fakeDatasets{}, &fakeCompute{})
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

func TestCreateSessionReturnsStableLimitError(t *testing.T) {
	sessions := &fakeSessions{createError: session.ErrSessionLimit}
	server := testServer(t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions)
	body := bytes.NewBufferString(`{"installation_id":"install-c","label":"Safari"}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", body)
	request.Header.Set("Authorization", "Bearer user-token")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusConflict, "DEVICE_LIMIT_REACHED")
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

func TestRulesRequireScreenerEntitlement(t *testing.T) {
	server := testServer(t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{})
	request := httptest.NewRequest(http.MethodGet, "/api/v1/rules", nil)
	request.Header.Set("Authorization", "Bearer user-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusForbidden, "ENTITLEMENT_REQUIRED")
}

func TestRulesExposeFrozenReadOnlyBaseline(t *testing.T) {
	server, err := NewServer(
		fakeIdentity{principal: auth.Principal{ID: "user-a"}},
		&fakeSessions{},
		&fakeAccess{features: []string{access.FeatureScreener}},
		&fakeDatasets{},
		&fakeCompute{},
	)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/rules", nil)
	request.Header.Set("Authorization", "Bearer user-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload struct {
		Items []struct {
			ID             string                      `json:"id"`
			OwnerType      string                      `json:"owner_type"`
			ReadOnly       bool                        `json:"read_only"`
			Definition     core.BaselineRuleDefinition `json:"definition"`
			DefinitionHash string                      `json:"definition_hash"`
		} `json:"items"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Items) != 1 || payload.Items[0].ID != core.BaselineRuleID ||
		payload.Items[0].OwnerType != "system" || !payload.Items[0].ReadOnly ||
		payload.Items[0].DefinitionHash != core.BaselineRuleHash || len(payload.Items[0].Definition.Conditions) != 4 {
		t.Fatalf("payload = %+v", payload)
	}

	detailRequest := httptest.NewRequest(http.MethodGet, "/api/v1/rules/"+core.BaselineRuleID, nil)
	detailRequest.Header.Set("Authorization", "Bearer user-token")
	detailRequest.Header.Set("X-App-Session", "sgs_session")
	detailResponse := httptest.NewRecorder()
	server.ServeHTTP(detailResponse, detailRequest)
	if detailResponse.Code != http.StatusOK {
		t.Fatalf("detail status = %d, body = %s", detailResponse.Code, detailResponse.Body.String())
	}
}

func TestRuleDetailHidesUnknownRuleAndSystemRuleIsReadOnly(t *testing.T) {
	server, err := NewServer(
		fakeIdentity{principal: auth.Principal{ID: "user-a"}},
		&fakeSessions{},
		&fakeAccess{features: []string{access.FeatureScreener}},
		&fakeDatasets{},
		&fakeCompute{},
	)
	if err != nil {
		t.Fatal(err)
	}
	unknown := httptest.NewRequest(http.MethodGet, "/api/v1/rules/not-found", nil)
	unknown.Header.Set("Authorization", "Bearer user-token")
	unknown.Header.Set("X-App-Session", "sgs_session")
	unknownResponse := httptest.NewRecorder()
	server.ServeHTTP(unknownResponse, unknown)
	assertErrorCode(t, unknownResponse, http.StatusNotFound, "RESOURCE_NOT_FOUND")

	mutation := httptest.NewRequest(http.MethodDelete, "/api/v1/rules/"+core.BaselineRuleID, nil)
	mutationResponse := httptest.NewRecorder()
	server.ServeHTTP(mutationResponse, mutation)
	if mutationResponse.Code != http.StatusMethodNotAllowed {
		t.Fatalf("mutation status = %d, want 405", mutationResponse.Code)
	}
}

func TestPrivateRouteRejectsSuspendedAccount(t *testing.T) {
	sessions := &fakeSessions{}
	server, err := NewServer(
		fakeIdentity{principal: auth.Principal{ID: "user-a"}},
		sessions,
		&fakeAccess{err: access.ErrAccountSuspended},
		&fakeDatasets{},
		&fakeCompute{},
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
	server, err := NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions, accountStore, &fakeDatasets{}, &fakeCompute{})
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

func TestOperatorGuardRequiresServerSideRole(t *testing.T) {
	request := func() *http.Request {
		value := httptest.NewRequest(http.MethodGet, "/operator-test", nil)
		value.Header.Set("Authorization", "Bearer user-token")
		value.Header.Set("X-App-Session", "sgs_session")
		return value.WithContext(context.WithValue(value.Context(), requestIDKey{}, "req_operator_test"))
	}
	server := testServer(
		t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{},
	)
	response := httptest.NewRecorder()
	if _, _, ok := server.requireOperator(response, request()); ok {
		t.Fatal("default user unexpectedly passed operator guard")
	}
	assertErrorCode(t, response, http.StatusForbidden, "ROLE_REQUIRED")

	operatorStore := &fakeAccess{account: access.Account{
		UserID: "operator-a", Role: access.RoleOperator, Status: access.StatusActive,
	}}
	server, err := NewServer(
		fakeIdentity{principal: auth.Principal{ID: "operator-a"}}, &fakeSessions{},
		operatorStore, &fakeDatasets{}, &fakeCompute{},
	)
	if err != nil {
		t.Fatal(err)
	}
	response = httptest.NewRecorder()
	principal, _, ok := server.requireOperator(response, request())
	if !ok || principal.ID != "operator-a" || response.Code != http.StatusOK {
		t.Fatalf("operator ok=%v principal=%+v status=%d", ok, principal, response.Code)
	}
}

func TestOperatorGrantRoutesRequireRoleAndUseAuthenticatedActor(t *testing.T) {
	request := func(method, target, body string) *http.Request {
		value := httptest.NewRequest(method, target, bytes.NewBufferString(body))
		value.Header.Set("Authorization", "Bearer operator-token")
		value.Header.Set("X-App-Session", "sgs_session")
		if body != "" {
			value.Header.Set("Content-Type", "application/json")
		}
		return value
	}

	userServer := testServer(
		t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{},
	)
	response := httptest.NewRecorder()
	userServer.ServeHTTP(response, request(http.MethodGet, "/api/v1/operator/grants?user_id=user-a", ""))
	assertErrorCode(t, response, http.StatusForbidden, "ROLE_REQUIRED")

	operatorStore := &fakeAccess{account: access.Account{
		UserID: "operator-a", Role: access.RoleOperator, Status: access.StatusActive,
	}}
	server, err := NewServer(
		fakeIdentity{principal: auth.Principal{ID: "operator-a"}}, &fakeSessions{},
		operatorStore, &fakeDatasets{}, &fakeCompute{},
	)
	if err != nil {
		t.Fatal(err)
	}
	response = httptest.NewRecorder()
	server.ServeHTTP(response, request(http.MethodPost, "/api/v1/operator/grants", `{
  "user_id":"user-target",
  "feature":"screener",
  "valid_until":"2027-01-01T00:00:00Z",
  "reason":"supervised demo"
}`))
	if response.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", response.Code, response.Body.String())
	}
	if operatorStore.grantActor != "operator-a" || !strings.HasPrefix(operatorStore.grantRequest, "req_") ||
		operatorStore.grantUserID != "user-target" || operatorStore.grantFeature != access.FeatureScreener {
		t.Fatalf("grant call = %+v", operatorStore)
	}

	response = httptest.NewRecorder()
	server.ServeHTTP(response, request(http.MethodGet, "/api/v1/operator/grants?user_id=user-target", ""))
	if response.Code != http.StatusOK || !bytes.Contains(response.Body.Bytes(), []byte(`"feature":"screener"`)) {
		t.Fatalf("list status = %d, body = %s", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	server.ServeHTTP(response, request(
		http.MethodDelete, "/api/v1/operator/grants/user-target/screener", `{"reason":"demo complete"}`,
	))
	if response.Code != http.StatusNoContent {
		t.Fatalf("revoke status = %d, body = %s", response.Code, response.Body.String())
	}
	if operatorStore.revokeActor != "operator-a" || !strings.HasPrefix(operatorStore.revokeRequest, "req_") ||
		operatorStore.revokeUserID != "user-target" || operatorStore.revokeFeature != access.FeatureScreener ||
		operatorStore.revokeReason != "demo complete" {
		t.Fatalf("revoke call = %+v", operatorStore)
	}
}

func TestOperatorGrantRejectsClientSuppliedAuditActor(t *testing.T) {
	operatorStore := &fakeAccess{account: access.Account{
		UserID: "operator-a", Role: access.RoleOperator, Status: access.StatusActive,
	}}
	server, err := NewServer(
		fakeIdentity{principal: auth.Principal{ID: "operator-a"}}, &fakeSessions{},
		operatorStore, &fakeDatasets{}, &fakeCompute{},
	)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/operator/grants", bytes.NewBufferString(`{
  "user_id":"user-target",
  "feature":"screener",
  "valid_until":"2027-01-01T00:00:00Z",
  "reason":"demo",
  "actor":"forged-operator"
}`))
	request.Header.Set("Authorization", "Bearer operator-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusBadRequest, "INVALID_REQUEST")
	if operatorStore.grantActor != "" {
		t.Fatalf("grant unexpectedly executed as %q", operatorStore.grantActor)
	}
}

func TestAccountSessionsListsOnlySafeOwnerMetadata(t *testing.T) {
	now := time.Now().UTC()
	sessions := &fakeSessions{
		verified: session.Session{ID: "ses_current"},
		listed: []session.Session{
			{ID: "ses_current", UserID: "user-a", InstallationID: "install-a", Label: "Chrome", CreatedAt: now, ExpiresAt: now.Add(time.Hour), LastSeenAt: now},
			{ID: "ses_old", UserID: "user-a", InstallationID: "install-b", Label: "Firefox", CreatedAt: now.Add(-time.Hour), ExpiresAt: now.Add(-time.Minute), LastSeenAt: now.Add(-time.Minute)},
		},
	}
	server := testServer(t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/account/sessions", nil)
	request.Header.Set("Authorization", "Bearer user-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if bytes.Contains(response.Body.Bytes(), []byte("session_token")) || bytes.Contains(response.Body.Bytes(), []byte("token_hash")) {
		t.Fatal("session secret material leaked")
	}
	var payload struct {
		Items []struct {
			ID      string `json:"id"`
			Status  string `json:"status"`
			Current bool   `json:"current"`
		} `json:"items"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Items) != 2 || !payload.Items[0].Current || payload.Items[1].Status != "expired" {
		t.Fatalf("payload = %+v", payload)
	}
	if sessions.verifiedUserID != "user-a" {
		t.Fatalf("listed user = %q", sessions.verifiedUserID)
	}
}

func TestRevokeAccountSessionUsesAuthenticatedOwner(t *testing.T) {
	sessions := &fakeSessions{verified: session.Session{ID: "ses_current"}}
	server := testServer(t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions)
	request := httptest.NewRequest(http.MethodDelete, "/api/v1/account/sessions/ses_other", nil)
	request.Header.Set("Authorization", "Bearer user-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if sessions.revokedUserID != "user-a" || sessions.revokedID != "ses_other" {
		t.Fatalf("revocation = user %q id %q", sessions.revokedUserID, sessions.revokedID)
	}
}

func TestPrepareDatasetRequiresFeatureEntitlement(t *testing.T) {
	sessions := &fakeSessions{}
	datasets := &fakeDatasets{manifest: dataset.Manifest{DatasetID: "fixture-1", Purpose: "screen"}}
	server, err := NewServer(
		fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions, &fakeAccess{}, datasets, &fakeCompute{},
	)
	if err != nil {
		t.Fatal(err)
	}
	body := bytes.NewBufferString(`{"purpose":"screen","market":"IDX","symbols":["BBCA.JK"],"timeframe":"1d","date_from":"2026-01-01","date_to":"2026-02-09"}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/datasets/prepare", body)
	request.Header.Set("Authorization", "Bearer user-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusForbidden, "ENTITLEMENT_REQUIRED")
}

func TestDatasetContentUsesPrivateCacheAndChecksum(t *testing.T) {
	sessions := &fakeSessions{}
	datasets := &fakeDatasets{
		manifest: dataset.Manifest{DatasetID: "fixture-1", Purpose: "screen", Checksum: "sha256:abc"},
		content:  []byte(`{"candles":[]}`),
	}
	server, err := NewServer(
		fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions,
		&fakeAccess{features: []string{access.FeatureScreener}}, datasets, &fakeCompute{},
	)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/datasets/fixture-1/content", nil)
	request.Header.Set("Authorization", "Bearer user-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Body.String() != `{"candles":[]}` {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if response.Header().Get("ETag") != `"sha256:abc"` || response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("headers = %+v", response.Header())
	}
}

func TestCreateComputeGrantBindsVerifiedVersions(t *testing.T) {
	sessions := &fakeSessions{verified: session.Session{ID: "ses-1"}}
	manifest := dataset.Manifest{
		DatasetID: "fixture-1", Version: "fixture-v1", Purpose: "screen", Checksum: "sha256:data",
	}
	computeStore := &fakeCompute{grant: compute.Grant{ID: "cgr-1"}}
	server, err := NewServer(
		fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions,
		&fakeAccess{features: []string{access.FeatureScreener}},
		&fakeDatasets{manifest: manifest}, computeStore,
	)
	if err != nil {
		t.Fatal(err)
	}
	body := bytes.NewBufferString(`{"purpose":"screen","dataset_id":"fixture-1","dataset_version":"fixture-v1","dataset_checksum":"sha256:data","rule_id":"default-scalping-v1","definition_hash":"sha256:74cb82c5bf9cf8fc06ce6eab0c054734110ad6775b0ab57a203836d588d1f52a","engine_version":"core-0.2.0","schema_version":"signal-baseline-1"}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/compute-grants", body)
	request.Header.Set("Authorization", "Bearer user-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if computeStore.created.UserID != "user-a" || computeStore.created.SessionID != "ses-1" || computeStore.created.DatasetChecksum != "sha256:data" {
		t.Fatalf("compute binding = %+v", computeStore.created)
	}
}

func TestCreateComputeGrantRejectsVersionMismatch(t *testing.T) {
	sessions := &fakeSessions{verified: session.Session{ID: "ses-1"}}
	manifest := dataset.Manifest{DatasetID: "fixture-1", Version: "fixture-v1", Purpose: "screen", Checksum: "sha256:data"}
	computeStore := &fakeCompute{}
	server, err := NewServer(
		fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions,
		&fakeAccess{features: []string{access.FeatureScreener}},
		&fakeDatasets{manifest: manifest}, computeStore,
	)
	if err != nil {
		t.Fatal(err)
	}
	body := bytes.NewBufferString(`{"purpose":"screen","dataset_id":"fixture-1","dataset_version":"wrong","dataset_checksum":"sha256:data","rule_id":"default-scalping-v1","definition_hash":"sha256:74cb82c5bf9cf8fc06ce6eab0c054734110ad6775b0ab57a203836d588d1f52a","engine_version":"core-0.2.0","schema_version":"signal-baseline-1"}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/compute-grants", body)
	request.Header.Set("Authorization", "Bearer user-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusUnprocessableEntity, "UNSUPPORTED_CAPABILITY")
	if computeStore.created.UserID != "" {
		t.Fatal("compute store was called for a mismatched version")
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

func TestOperatorGrantLifecycleWritesAuthenticatedAuditWithSQLite(t *testing.T) {
	db, err := sql.Open("sqlite", "file:operator_grant_api?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = db.Close() })
	accessStore, err := access.NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := accessStore.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	_, _ = accessStore.EnsureProfile(context.Background(), "operator-a", "operator@example.com")
	_, _ = accessStore.EnsureProfile(context.Background(), "user-target", "user@example.com")
	if err := accessStore.BootstrapOperator(
		context.Background(), "local:test", "cli_bootstrap", "operator-a", "test operator",
	); err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(
		fakeIdentity{principal: auth.Principal{ID: "operator-a"}}, &fakeSessions{},
		accessStore, &fakeDatasets{}, &fakeCompute{},
	)
	if err != nil {
		t.Fatal(err)
	}
	call := func(method, target, body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, target, bytes.NewBufferString(body))
		request.Header.Set("Authorization", "Bearer operator-token")
		request.Header.Set("X-App-Session", "sgs_session")
		response := httptest.NewRecorder()
		server.ServeHTTP(response, request)
		return response
	}
	expiresAt := time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
	response := call(http.MethodPost, "/api/v1/operator/grants", fmt.Sprintf(`{
  "user_id":"user-target",
  "feature":"screener",
  "valid_until":%q,
  "reason":"integration demo"
}`, expiresAt))
	if response.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", response.Code, response.Body.String())
	}
	response = call(
		http.MethodDelete, "/api/v1/operator/grants/user-target/screener", `{"reason":"integration complete"}`,
	)
	if response.Code != http.StatusNoContent {
		t.Fatalf("revoke status = %d, body = %s", response.Code, response.Body.String())
	}
	events, err := accessStore.AuditEvents(context.Background(), "user-target")
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0].Actor != "operator-a" || events[1].Actor != "operator-a" ||
		!strings.HasPrefix(events[0].RequestID, "req_") || events[1].Action != "feature.revoke" {
		t.Fatalf("audit events = %+v", events)
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
	datasets, err := dataset.NewFixtureStore(filepath.Join("..", "..", "core", "testdata", "default_scalping_v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	computeStore, err := compute.NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := computeStore.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions, accessStore, datasets, computeStore)
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
	if err := accessStore.GrantFeature(
		context.Background(), "user-a", access.FeatureScreener, time.Now().UTC().Add(time.Hour), "integration test",
	); err != nil {
		t.Fatal(err)
	}
	prepareRequest := httptest.NewRequest(http.MethodPost, "/api/v1/datasets/prepare",
		bytes.NewBufferString(`{"purpose":"screen","market":"IDX","symbols":["BBCA.JK"],"timeframe":"1d","date_from":"2026-01-01","date_to":"2026-02-09"}`))
	prepareRequest.Header.Set("Authorization", "Bearer user-token")
	prepareRequest.Header.Set("X-App-Session", created.Token)
	prepareResponse := httptest.NewRecorder()
	server.ServeHTTP(prepareResponse, prepareRequest)
	if prepareResponse.Code != http.StatusOK {
		t.Fatalf("prepare status = %d, body = %s", prepareResponse.Code, prepareResponse.Body.String())
	}
	var manifest dataset.Manifest
	if err := json.Unmarshal(prepareResponse.Body.Bytes(), &manifest); err != nil {
		t.Fatal(err)
	}
	contentRequest := httptest.NewRequest(http.MethodGet, "/api/v1/datasets/"+manifest.DatasetID+"/content", nil)
	contentRequest.Header.Set("Authorization", "Bearer user-token")
	contentRequest.Header.Set("X-App-Session", created.Token)
	contentResponse := httptest.NewRecorder()
	server.ServeHTTP(contentResponse, contentRequest)
	if contentResponse.Code != http.StatusOK || contentResponse.Header().Get("ETag") == "" {
		t.Fatalf("content status = %d, headers = %+v", contentResponse.Code, contentResponse.Header())
	}
	computeBody, _ := json.Marshal(map[string]string{
		"purpose": "screen", "dataset_id": manifest.DatasetID, "dataset_version": manifest.Version,
		"dataset_checksum": manifest.Checksum, "rule_id": core.BaselineRuleID,
		"definition_hash": core.BaselineRuleHash, "engine_version": core.EngineVersion,
		"schema_version": core.SchemaVersion,
	})
	computeRequest := httptest.NewRequest(http.MethodPost, "/api/v1/compute-grants", bytes.NewReader(computeBody))
	computeRequest.Header.Set("Authorization", "Bearer user-token")
	computeRequest.Header.Set("X-App-Session", created.Token)
	computeResponse := httptest.NewRecorder()
	server.ServeHTTP(computeResponse, computeRequest)
	if computeResponse.Code != http.StatusCreated {
		t.Fatalf("compute grant status = %d, body = %s", computeResponse.Code, computeResponse.Body.String())
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
