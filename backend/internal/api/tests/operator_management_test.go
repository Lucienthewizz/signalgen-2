package apitests

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/account"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

const managementTarget = "00000000-0000-0000-0000-000000000001"

type fakeManagement struct {
	actor, requestID, target string
	query                    account.AccountQuery
	audit                    account.AuditQuery
	input                    account.StatusUpdate
	calls                    int
	err                      error
}

func (fake *fakeManagement) ListAccounts(_ context.Context, actor string, query account.AccountQuery) (account.AccountPage, error) {
	fake.calls++
	fake.actor, fake.query = actor, query
	return account.AccountPage{Items: []account.ManagedAccount{{UserID: managementTarget, Status: "active", Role: "user"}}}, fake.err
}
func (fake *fakeManagement) SetStatusAudited(_ context.Context, actor, requestID, target string, input account.StatusUpdate) (account.ManagedAccount, error) {
	fake.calls++
	fake.actor, fake.requestID, fake.target, fake.input = actor, requestID, target, input
	return account.ManagedAccount{UserID: target, Status: input.Status, Role: "user"}, fake.err
}
func (fake *fakeManagement) ListAccountAudit(_ context.Context, actor string, query account.AuditQuery) (account.AuditPage, error) {
	fake.calls++
	fake.actor, fake.audit = actor, query
	return account.AuditPage{Items: []account.ManagementAudit{}}, fake.err
}

func managementServer(t *testing.T, role string, store *fakeManagement, sessions *fakeSessions, options ...api.ServerOption) *api.Server {
	t.Helper()
	options = append(options, api.WithAccountManagement(store))
	server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "operator-verified"}}, sessions,
		&fakeAccess{account: access.Account{UserID: "operator-verified", Role: role, Status: "active"}}, &fakeDatasets{}, &fakeCompute{}, options...)
	if err != nil {
		t.Fatal(err)
	}
	return server
}
func managementRequest(method, path, body string) *http.Request {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer test-identity")
	req.Header.Set("X-App-Session", "test-app-session")
	return req
}

func TestManagementRoutesRequireOperatorAndValidSession(t *testing.T) {
	for _, tc := range []struct{ method, path, body string }{
		{"GET", "/api/v1/operator/accounts", ""},
		{"GET", "/api/v1/operator/accounts?q=member", ""},
		{"GET", "/api/v1/operator/audit-events?user_id=" + managementTarget, ""},
		{"PATCH", "/api/v1/operator/accounts/" + managementTarget + "/status", `{"status":"suspended","expected_status":"active","reason":"test"}`},
	} {
		for _, mode := range []string{"user", "missing-bearer", "missing-session", "revoked-session"} {
			t.Run(mode+tc.path, func(t *testing.T) {
				store := &fakeManagement{}
				sessions := &fakeSessions{}
				role := "operator"
				if mode == "user" {
					role = "user"
				}
				if mode == "revoked-session" {
					sessions.verifyError = session.ErrRevoked
				}
				server := managementServer(t, role, store, sessions)
				req := managementRequest(tc.method, tc.path, tc.body)
				code, status := "ROLE_REQUIRED", 403
				if mode == "missing-bearer" {
					req.Header.Del("Authorization")
					code, status = "AUTH_REQUIRED", 401
				}
				if mode == "missing-session" {
					req.Header.Del("X-App-Session")
					code, status = "AUTH_REQUIRED", 401
				}
				if mode == "revoked-session" {
					code = "SESSION_REVOKED"
				}
				res := httptest.NewRecorder()
				server.ServeHTTP(res, req)
				assertErrorCode(t, res, status, code)
				if store.calls != 0 {
					t.Fatal("unauthorized management access")
				}
			})
		}
	}
}

func TestManagementActorFiltersAndStrictInput(t *testing.T) {
	store := &fakeManagement{}
	server := managementServer(t, "operator", store, &fakeSessions{})
	res := httptest.NewRecorder()
	server.ServeHTTP(res, managementRequest("GET", "/api/v1/operator/accounts?limit=2&role=user&status=active&after="+managementTarget, ""))
	if res.Code != 200 || store.actor != "operator-verified" || store.query.Limit != 2 || store.query.After != managementTarget || res.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("list = %d %+v", res.Code, store)
	}
	res = httptest.NewRecorder()
	server.ServeHTTP(res, managementRequest("GET", "/api/v1/operator/accounts?q=Member%40Example.test&limit=2&status=active", ""))
	if res.Code != 200 || store.query.Search != "Member@Example.test" || store.query.Status != "active" {
		t.Fatal("account search filter was not forwarded")
	}
	res = httptest.NewRecorder()
	server.ServeHTTP(res, managementRequest("GET", "/api/v1/operator/audit-events?user_id="+managementTarget+"&before=9223372036854775807&limit=1", ""))
	if res.Code != 200 || store.audit.Before != 9223372036854775807 || store.audit.UserID != managementTarget {
		t.Fatal("audit pagination")
	}
	res = httptest.NewRecorder()
	server.ServeHTTP(res, managementRequest("PATCH", "/api/v1/operator/accounts/"+managementTarget+"/status", `{"status":"suspended","expected_status":"active","reason":" reviewed "}`))
	if res.Code != 200 || store.actor != "operator-verified" || !strings.HasPrefix(store.requestID, "req_") || store.input.Reason != "reviewed" || store.target != managementTarget {
		t.Fatal("status actor/input")
	}
	for _, path := range []string{
		"/api/v1/operator/accounts?limit=0", "/api/v1/operator/accounts?limit=101", "/api/v1/operator/accounts?limit=1&limit=2",
		"/api/v1/operator/accounts?email=private", "/api/v1/operator/accounts?after=not-uuid", "/api/v1/operator/accounts?status=paid",
		"/api/v1/operator/accounts?role=admin", "/api/v1/operator/accounts?limit=", "/api/v1/operator/accounts?bad=%ZZ",
		"/api/v1/operator/accounts?q=", "/api/v1/operator/accounts?q=a&q=b", "/api/v1/operator/accounts?q=" + strings.Repeat("x", 201), "/api/v1/operator/accounts?q=mail%00value",
		"/api/v1/operator/audit-events", "/api/v1/operator/audit-events?user_id=" + managementTarget + "&before=0",
	} {
		before := store.calls
		res := httptest.NewRecorder()
		server.ServeHTTP(res, managementRequest("GET", path, ""))
		assertErrorCode(t, res, 422, "INVALID_REQUEST")
		if store.calls != before {
			t.Fatal("invalid query reached repository")
		}
	}
	for _, body := range []string{
		`{"status":"suspended","expected_status":"active","reason":"test","actor":"forged"}`,
		`{"status":"suspended","expected_status":"active","reason":"test","user_id":"forged"}`,
	} {
		before := store.calls
		res := httptest.NewRecorder()
		server.ServeHTTP(res, managementRequest("PATCH", "/api/v1/operator/accounts/"+managementTarget+"/status", body))
		assertErrorCode(t, res, 400, "INVALID_REQUEST")
		if store.calls != before {
			t.Fatal("forged audit input reached repository")
		}
	}
}

func TestManagementErrorsAreStableAndPrivate(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{
		{access.ErrLastOperator, 409, "LAST_OPERATOR_REQUIRED"}, {account.ErrStatusConflict, 409, "STATUS_CONFLICT"},
		{access.ErrAccountNotFound, 404, "RESOURCE_NOT_FOUND"}, {access.ErrRoleRequired, 403, "ROLE_REQUIRED"},
		{errors.New("private-password-database-details"), 503, "SERVICE_UNAVAILABLE"},
	} {
		store := &fakeManagement{err: tc.err}
		server := managementServer(t, "operator", store, &fakeSessions{})
		res := httptest.NewRecorder()
		server.ServeHTTP(res, managementRequest("PATCH", "/api/v1/operator/accounts/"+managementTarget+"/status", `{"status":"suspended","expected_status":"active","reason":"test"}`))
		assertErrorCode(t, res, tc.status, tc.code)
		if strings.Contains(res.Body.String(), "private-password") {
			t.Fatal("raw database error exposed")
		}
	}
}

func TestSessionCreationRejectsInactiveAccountRace(t *testing.T) {
	server := testServer(t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{createError: session.ErrAccountInactive})
	res := httptest.NewRecorder()
	server.ServeHTTP(res, managementRequest("POST", "/api/v1/sessions", `{"installation_id":"install","label":"test"}`))
	assertErrorCode(t, res, 403, "ACCOUNT_SUSPENDED")
}

func TestManagementRejectsSuspendedOperatorAndNilStore(t *testing.T) {
	store := &fakeManagement{}
	server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "operator-verified"}}, &fakeSessions{},
		&fakeAccess{err: access.ErrAccountSuspended}, &fakeDatasets{}, &fakeCompute{}, api.WithAccountManagement(store))
	if err != nil {
		t.Fatal(err)
	}
	res := httptest.NewRecorder()
	server.ServeHTTP(res, managementRequest("GET", "/api/v1/operator/accounts", ""))
	assertErrorCode(t, res, 403, "ACCOUNT_SUSPENDED")
	if store.calls != 0 {
		t.Fatal("suspended operator accessed management")
	}
	if _, err := api.NewServer(fakeIdentity{}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{}, api.WithAccountManagement(nil)); err == nil {
		t.Fatal("nil management store accepted")
	}
}

type managementDeniedLimiter struct{}

func (managementDeniedLimiter) Allow(string) (bool, time.Duration) { return false, time.Second }

func TestManagementWritesAreRateLimited(t *testing.T) {
	store := &fakeManagement{}
	server := managementServer(t, "operator", store, &fakeSessions{}, api.WithRateLimiter(managementDeniedLimiter{}))
	res := httptest.NewRecorder()
	server.ServeHTTP(res, managementRequest("PATCH", "/api/v1/operator/accounts/"+managementTarget+"/status", `{"status":"suspended","expected_status":"active","reason":"test"}`))
	assertErrorCode(t, res, 429, "RATE_LIMITED")
	if store.calls != 0 {
		t.Fatal("rate-limited mutation executed")
	}
}
