package apitests

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
)

func TestOperatorGuardRequiresServerSideRole(t *testing.T) {
	request := func() *http.Request {
		value := httptest.NewRequest(http.MethodGet, "/operator-test", nil)
		value.Header.Set("Authorization", "Bearer user-token")
		value.Header.Set("X-App-Session", "sgs_session")
		return value.WithContext(context.WithValue(value.Context(), shared.RequestIDKey{}, "req_operator_test"))
	}
	server := testServer(
		t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{},
	)
	response := httptest.NewRecorder()
	if _, _, ok := server.RequireOperator(response, request()); ok {
		t.Fatal("default user unexpectedly passed operator guard")
	}
	assertErrorCode(t, response, http.StatusForbidden, "ROLE_REQUIRED")

	operatorStore := &fakeAccess{account: access.Account{
		UserID: "operator-a", Role: access.RoleOperator, Status: access.StatusActive,
	}}
	server, err := api.NewServer(
		fakeIdentity{principal: auth.Principal{ID: "operator-a"}}, &fakeSessions{},
		operatorStore, &fakeDatasets{}, &fakeCompute{},
	)
	if err != nil {
		t.Fatal(err)
	}
	response = httptest.NewRecorder()
	principal, _, ok := server.RequireOperator(response, request())
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
	server, err := api.NewServer(
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
	server, err := api.NewServer(
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

func TestOperatorRoleRouteUsesAuthenticatedActor(t *testing.T) {
	operatorStore := &fakeAccess{account: access.Account{
		UserID: "operator-a", Role: access.RoleOperator, Status: access.StatusActive,
	}}
	server, err := api.NewServer(
		fakeIdentity{principal: auth.Principal{ID: "operator-a"}}, &fakeSessions{},
		operatorStore, &fakeDatasets{}, &fakeCompute{},
	)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(
		http.MethodPatch, "/api/v1/operator/accounts/user-target/role",
		bytes.NewBufferString(`{"role":"operator","reason":"backup operator"}`),
	)
	request.Header.Set("Authorization", "Bearer operator-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("role status = %d, body = %s", response.Code, response.Body.String())
	}
	if operatorStore.roleActor != "operator-a" || !strings.HasPrefix(operatorStore.roleRequest, "req_") ||
		operatorStore.roleUserID != "user-target" || operatorStore.roleValue != access.RoleOperator ||
		operatorStore.roleReason != "backup operator" {
		t.Fatalf("role call = %+v", operatorStore)
	}
}

func TestOperatorRoleRouteProtectsLastOperator(t *testing.T) {
	operatorStore := &fakeAccess{
		account:   access.Account{UserID: "operator-a", Role: access.RoleOperator, Status: access.StatusActive},
		roleError: access.ErrLastOperator,
	}
	server, err := api.NewServer(
		fakeIdentity{principal: auth.Principal{ID: "operator-a"}}, &fakeSessions{},
		operatorStore, &fakeDatasets{}, &fakeCompute{},
	)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(
		http.MethodPatch, "/api/v1/operator/accounts/operator-a/role",
		bytes.NewBufferString(`{"role":"user","reason":"unsafe demotion"}`),
	)
	request.Header.Set("Authorization", "Bearer operator-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusConflict, "LAST_OPERATOR_REQUIRED")
}
