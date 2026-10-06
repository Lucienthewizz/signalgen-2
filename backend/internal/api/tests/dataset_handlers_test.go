package apitests

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

func TestPrepareDatasetRequiresFeatureEntitlement(t *testing.T) {
	sessions := &fakeSessions{}
	datasets := &fakeDatasets{manifest: dataset.Manifest{DatasetID: "fixture-1", Purpose: "screen"}}
	server, err := api.NewServer(
		fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions, &fakeAccess{}, datasets, &fakeCompute{},
	)
	if err != nil {
		t.Fatal(err)
	}
	body := bytes.NewBufferString(`{"purpose":"screen","rule_id":"default-scalping-v1","universe_id":"univ-1"}`)
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
	server, err := api.NewServer(
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
	server, err := api.NewServer(
		fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions,
		&fakeAccess{features: []string{access.FeatureScreener}},
		&fakeDatasets{manifest: manifest}, computeStore,
	)
	if err != nil {
		t.Fatal(err)
	}
	body := bytes.NewBufferString(`{"purpose":"screen","dataset_id":"fixture-1","dataset_version":"fixture-v1","dataset_checksum":"sha256:data","rule_id":"default-scalping-v1","definition_hash":"sha256:74cb82c5bf9cf8fc06ce6eab0c054734110ad6775b0ab57a203836d588d1f52a","engine_version":"core-0.3.0","schema_version":"signal-baseline-1"}`)
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
	server, err := api.NewServer(
		fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions,
		&fakeAccess{features: []string{access.FeatureScreener}},
		&fakeDatasets{manifest: manifest}, computeStore,
	)
	if err != nil {
		t.Fatal(err)
	}
	body := bytes.NewBufferString(`{"purpose":"screen","dataset_id":"fixture-1","dataset_version":"wrong","dataset_checksum":"sha256:data","rule_id":"default-scalping-v1","definition_hash":"sha256:74cb82c5bf9cf8fc06ce6eab0c054734110ad6775b0ab57a203836d588d1f52a","engine_version":"core-0.3.0","schema_version":"signal-baseline-1"}`)
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
