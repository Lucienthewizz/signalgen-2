package apitests

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

func TestUserRuleCRUDEnforcesOwnershipAndVersionWithSQLite(t *testing.T) {
	db, err := sql.Open("sqlite", "file:user_rule_api?mode=memory&cache=shared")
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
	for _, userID := range []string{"user-a", "user-b"} {
		_, _ = accessStore.EnsureProfile(context.Background(), userID, userID+"@example.com")
		if err := accessStore.GrantFeature(
			context.Background(), userID, access.FeatureScreener, time.Now().UTC().Add(time.Hour), "rule test",
		); err != nil {
			t.Fatal(err)
		}
	}
	ruleStore, err := rules.NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := ruleStore.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	newServer := func(userID string) *api.Server {
		server, err := api.NewServer(
			fakeIdentity{principal: auth.Principal{ID: userID}}, &fakeSessions{}, accessStore,
			&fakeDatasets{}, &fakeCompute{}, api.WithRuleStore(ruleStore),
		)
		if err != nil {
			t.Fatal(err)
		}
		return server
	}
	call := func(server *api.Server, method, target, body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, target, bytes.NewBufferString(body))
		request.Header.Set("Authorization", "Bearer user-token")
		request.Header.Set("X-App-Session", "sgs_session")
		response := httptest.NewRecorder()
		server.ServeHTTP(response, request)
		return response
	}
	serverA, serverB := newServer("user-a"), newServer("user-b")
	createBody := `{"definition":{"name":"My EMA rule","logic":"AND","signal_type":"BUY","cooldown_sec":60,"conditions":[{"left":"EMA9","op":">","right":"EMA20"}]}}`
	response := call(serverA, http.MethodPost, "/api/v1/rules", createBody)
	if response.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", response.Code, response.Body.String())
	}
	var created rules.Rule
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || created.Version != 1 || created.OwnerUserID != "" || created.ReadOnly {
		t.Fatalf("created rule = %+v", created)
	}
	if bytes.Contains(response.Body.Bytes(), []byte("owner_user_id")) {
		t.Fatalf("create response leaked owner id: %s", response.Body.String())
	}
	response = call(serverA, http.MethodGet, "/api/v1/rules", "")
	if response.Code != http.StatusOK || !bytes.Contains(response.Body.Bytes(), []byte(created.ID)) {
		t.Fatalf("owner list status = %d, body = %s", response.Code, response.Body.String())
	}
	response = call(serverB, http.MethodGet, "/api/v1/rules/"+created.ID, "")
	assertErrorCode(t, response, http.StatusNotFound, "RESOURCE_NOT_FOUND")
	updateBody := `{"version":1,"definition":{"name":"Updated EMA rule","logic":"AND","signal_type":"BUY","cooldown_sec":120,"conditions":[{"left":"PRICE","op":">","right":"EMA9"}]}}`
	response = call(serverB, http.MethodPatch, "/api/v1/rules/"+created.ID, updateBody)
	assertErrorCode(t, response, http.StatusNotFound, "RESOURCE_NOT_FOUND")
	response = call(serverA, http.MethodPatch, "/api/v1/rules/"+created.ID, updateBody)
	if response.Code != http.StatusOK {
		t.Fatalf("update status = %d, body = %s", response.Code, response.Body.String())
	}
	var updated rules.Rule
	if err := json.Unmarshal(response.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Version != 2 || updated.Name != "Updated EMA rule" {
		t.Fatalf("updated rule = %+v", updated)
	}
	response = call(serverA, http.MethodPatch, "/api/v1/rules/"+created.ID, updateBody)
	assertErrorCode(t, response, http.StatusConflict, "VERSION_CONFLICT")
	response = call(serverB, http.MethodDelete, "/api/v1/rules/"+created.ID, `{"version":2}`)
	assertErrorCode(t, response, http.StatusNotFound, "RESOURCE_NOT_FOUND")
	response = call(serverA, http.MethodDelete, "/api/v1/rules/"+created.ID, `{"version":2}`)
	if response.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, body = %s", response.Code, response.Body.String())
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
	server, err := api.NewServer(
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
	datasets, err := dataset.NewFixtureStore(filepath.Join("..", "..", "..", "core", "testdata", "default_scalping_v1.json"))
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
	ruleStore, err := rules.NewStore(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := ruleStore.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	server, err := api.NewServer(
		fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions, accessStore, datasets, computeStore,
		api.WithRuleStore(ruleStore),
	)
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
	ruleRequest := httptest.NewRequest(http.MethodPost, "/api/v1/rules", bytes.NewBufferString(
		`{"definition":{"name":"Lifecycle EMA rule","logic":"AND","signal_type":"BUY","cooldown_sec":60,"conditions":[{"left":"EMA9","op":">","right":"EMA20"}]}}`,
	))
	ruleRequest.Header.Set("Authorization", "Bearer user-token")
	ruleRequest.Header.Set("X-App-Session", created.Token)
	ruleResponse := httptest.NewRecorder()
	server.ServeHTTP(ruleResponse, ruleRequest)
	if ruleResponse.Code != http.StatusCreated {
		t.Fatalf("rule status = %d, body = %s", ruleResponse.Code, ruleResponse.Body.String())
	}
	var userRule rules.Rule
	if err := json.Unmarshal(ruleResponse.Body.Bytes(), &userRule); err != nil {
		t.Fatal(err)
	}
	prepareRequest := httptest.NewRequest(http.MethodPost, "/api/v1/datasets/prepare",
		bytes.NewBufferString(`{"purpose":"screen","rule_id":"default-scalping-v1","universe_id":"univ-1"}`))
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
		"dataset_checksum": manifest.Checksum, "rule_id": userRule.ID,
		"definition_hash": userRule.DefinitionHash, "engine_version": core.EngineVersion,
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
