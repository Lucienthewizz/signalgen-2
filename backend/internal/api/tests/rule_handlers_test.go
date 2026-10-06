package apitests

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

func TestRulesRequireScreenerEntitlement(t *testing.T) {
	server := testServer(t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{})
	request := httptest.NewRequest(http.MethodGet, "/api/v1/rules", nil)
	request.Header.Set("Authorization", "Bearer user-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusForbidden, "ENTITLEMENT_REQUIRED")
}

func TestRulesExposeBaselineMetadataWithoutPrivateDefinition(t *testing.T) {
	server, err := api.NewServer(
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
			ID             string `json:"id"`
			OwnerType      string `json:"owner_type"`
			ReadOnly       bool   `json:"read_only"`
			DefinitionHash string `json:"definition_hash"`
		} `json:"items"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Items) != 1 || payload.Items[0].ID != core.BaselineRuleID ||
		payload.Items[0].OwnerType != "system" || !payload.Items[0].ReadOnly ||
		payload.Items[0].DefinitionHash != core.BaselineRuleHash {
		t.Fatalf("payload = %+v", payload)
	}
	if bytes.Contains(response.Body.Bytes(), []byte(`"definition"`)) || bytes.Contains(response.Body.Bytes(), []byte(`"conditions"`)) {
		t.Fatalf("private baseline rule leaked: %s", response.Body.String())
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
	server, err := api.NewServer(
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
	mutation.Header.Set("Authorization", "Bearer user-token")
	mutation.Header.Set("X-App-Session", "sgs_session")
	mutationResponse := httptest.NewRecorder()
	server.ServeHTTP(mutationResponse, mutation)
	assertErrorCode(t, mutationResponse, http.StatusConflict, "RULE_READ_ONLY")
}

func TestPrepareDatasetUsesRuleAndUniverseContract(t *testing.T) {
	datasets := &fakeDatasets{manifest: dataset.Manifest{DatasetID: "dataset-1", Purpose: "screen"}}
	server, err := api.NewServer(
		fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{},
		&fakeAccess{features: []string{access.FeatureScreener}}, datasets, &fakeCompute{},
	)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/datasets/prepare",
		bytes.NewBufferString(`{"purpose":"screen","rule_id":"default-scalping-v1","universe_id":"univ-a"}`))
	request.Header.Set("Authorization", "Bearer user-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if datasets.preparedBy != "user-a" || datasets.prepareInput.RuleID != core.BaselineRuleID || datasets.prepareInput.UniverseID != "univ-a" {
		t.Fatalf("prepare owner = %q, request = %+v", datasets.preparedBy, datasets.prepareInput)
	}
}

func TestCreateComputeGrantHidesUnknownCustomRule(t *testing.T) {
	sessions := &fakeSessions{verified: session.Session{ID: "ses-1"}}
	manifest := dataset.Manifest{DatasetID: "fixture-1", Version: "fixture-v1", Purpose: "screen", Checksum: "sha256:data"}
	computeStore := &fakeCompute{}
	server, err := api.NewServer(
		fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions,
		&fakeAccess{features: []string{access.FeatureScreener}},
		&fakeDatasets{manifest: manifest}, computeStore,
	)
	if err != nil {
		t.Fatal(err)
	}
	body := bytes.NewBufferString(`{"purpose":"screen","dataset_id":"fixture-1","dataset_version":"fixture-v1","dataset_checksum":"sha256:data","rule_id":"rule_missing","definition_hash":"sha256:missing","engine_version":"core-0.3.0","schema_version":"signal-baseline-1"}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/compute-grants", body)
	request.Header.Set("Authorization", "Bearer user-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusNotFound, "RESOURCE_NOT_FOUND")
	if computeStore.created.UserID != "" {
		t.Fatal("compute store was called for an unknown custom rule")
	}
}
