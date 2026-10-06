package apitests

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

func TestCreateSessionUsesBearerPrincipal(t *testing.T) {
	sessions := &fakeSessions{created: session.Created{
		Session: session.Session{ID: "ses_1", ExpiresAt: time.Date(2026, 9, 18, 0, 0, 0, 0, time.UTC)},
		Token:   "sgs_once",
	}}
	identity := fakeIdentity{principal: auth.Principal{ID: "user-a", Email: "user@example.com"}}
	accountStore := &fakeAccess{}
	server, err := api.NewServer(identity, sessions, accountStore, &fakeDatasets{}, &fakeCompute{})
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

func TestCreateSessionReturnsStableDeviceCooldownError(t *testing.T) {
	sessions := &fakeSessions{createError: session.ErrDeviceCooldown}
	server := testServer(t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/sessions",
		strings.NewReader(`{"installation_id":"install-c","label":"Safari"}`))
	request.Header.Set("Authorization", "Bearer user-token")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusConflict, "DEVICE_SWITCH_COOLDOWN")
}

func TestPrivateRouteRejectsSuspendedAccount(t *testing.T) {
	sessions := &fakeSessions{}
	server, err := api.NewServer(
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
	server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions, accountStore, &fakeDatasets{}, &fakeCompute{})
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

func TestAccountDevicesListsOwnerDevicesAndMarksCurrent(t *testing.T) {
	now := time.Now().UTC()
	sessions := &fakeSessions{
		verified: session.Session{ID: "ses_current", InstallationID: "install-a"},
		devices: []session.Device{
			{ID: "install-a", Label: "Chrome", Status: "active", CreatedAt: now, LastSeenAt: now},
			{ID: "install-b", Label: "Firefox", Status: "revoked", CreatedAt: now, LastSeenAt: now},
		},
	}
	server := testServer(t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/account/devices", nil)
	request.Header.Set("Authorization", "Bearer user-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload struct {
		Items []struct {
			ID      string `json:"id"`
			Current bool   `json:"current"`
			Status  string `json:"status"`
		} `json:"items"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Items) != 2 || !payload.Items[0].Current || payload.Items[1].Status != "revoked" {
		t.Fatalf("payload = %+v", payload)
	}
	if sessions.verifiedUserID != "user-a" {
		t.Fatalf("listed user = %q", sessions.verifiedUserID)
	}
}

func TestUpdateAccountDeviceUsesAuthenticatedOwner(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		label   string
		revoked bool
	}{
		{name: "rename", body: `{"label":"Work Mac"}`, label: "Work Mac"},
		{name: "revoke", body: `{"status":"revoked"}`, revoked: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			sessions := &fakeSessions{}
			server := testServer(t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions)
			request := httptest.NewRequest(http.MethodPatch, "/api/v1/account/devices/install-a", strings.NewReader(test.body))
			request.Header.Set("Authorization", "Bearer user-token")
			request.Header.Set("X-App-Session", "sgs_session")
			response := httptest.NewRecorder()
			server.ServeHTTP(response, request)
			if response.Code != http.StatusNoContent {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
			}
			if sessions.revokedUserID != "user-a" || sessions.deviceID != "install-a" || sessions.deviceLabel != test.label || sessions.deviceRevoked != test.revoked {
				t.Fatalf("device mutation = %+v", sessions)
			}
		})
	}
}

func TestUpdateAccountDeviceRejectsAmbiguousMutation(t *testing.T) {
	sessions := &fakeSessions{}
	server := testServer(t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions)
	request := httptest.NewRequest(
		http.MethodPatch, "/api/v1/account/devices/install-a",
		strings.NewReader(`{"label":"Work Mac","status":"revoked"}`),
	)
	request.Header.Set("Authorization", "Bearer user-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusUnprocessableEntity, "INVALID_REQUEST")
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
