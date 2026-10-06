package apitests

import (
	"bytes"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/ratelimit"
)

func TestHealthIsPublic(t *testing.T) {
	server := testServer(t, fakeIdentity{}, &fakeSessions{})
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/health", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d", response.Code)
	}
}

func TestReadinessChecksDependenciesWithoutLeakingDetails(t *testing.T) {
	server, err := api.NewServer(
		fakeIdentity{}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{},
		api.WithReadinessChecks(fakeReadiness{}, fakeReadiness{err: errors.New("database path secret")}),
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

	readyServer, err := api.NewServer(
		fakeIdentity{}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{},
		api.WithReadinessChecks(fakeReadiness{}),
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
	server, err := api.NewServer(
		fakeIdentity{}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{},
		api.WithCORSOrigins([]string{"http://localhost:5173"}),
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
	if !strings.Contains(response.Header().Get("Access-Control-Allow-Methods"), http.MethodPatch) {
		t.Fatalf("allow methods = %q", response.Header().Get("Access-Control-Allow-Methods"))
	}
}

func TestCORSRejectsUnlistedPreflightOrigin(t *testing.T) {
	server, err := api.NewServer(
		fakeIdentity{}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{},
		api.WithCORSOrigins([]string{"https://app.signalgen.example"}),
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
	_, err := api.NewServer(
		fakeIdentity{}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{},
		api.WithCORSOrigins([]string{"*"}),
	)
	if err == nil {
		t.Fatal("expected invalid CORS origin error")
	}
}

func TestJSONBodyLimitRejectsValidPrefixWithOversizedTrailingData(t *testing.T) {
	server := testServer(
		t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{},
	)
	body := `{"installation_id":"install-a","label":"Chrome"}` + strings.Repeat(" ", shared.MaxJSONBody)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer user-token")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE")
}

func TestMutationRateLimitReturnsRetryAfter(t *testing.T) {
	limiter, err := ratelimit.New(1, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	server, err := api.NewServer(
		fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{},
		&fakeAccess{}, &fakeDatasets{}, &fakeCompute{}, api.WithRateLimiter(limiter),
	)
	if err != nil {
		t.Fatal(err)
	}
	call := func() *httptest.ResponseRecorder {
		request := httptest.NewRequest(
			http.MethodPost, "/api/v1/sessions",
			strings.NewReader(`{"installation_id":"install-a","label":"Chrome"}`),
		)
		request.Header.Set("Authorization", "Bearer user-token")
		response := httptest.NewRecorder()
		server.ServeHTTP(response, request)
		return response
	}
	if response := call(); response.Code != http.StatusCreated {
		t.Fatalf("first status = %d, body = %s", response.Code, response.Body.String())
	}
	response := call()
	assertErrorCode(t, response, http.StatusTooManyRequests, "RATE_LIMITED")
	if response.Header().Get("Retry-After") == "" {
		t.Fatal("rate-limited response omitted Retry-After")
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
