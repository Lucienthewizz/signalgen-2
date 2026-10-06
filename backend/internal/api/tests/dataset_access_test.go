package apitests

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
)

func TestDatasetReadsRejectRevokedEntitlementWithoutReturningPrivateData(t *testing.T) {
	permissions := &fakeAccess{features: []string{access.FeatureScreener}}
	server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "owner"}}, &fakeSessions{}, permissions,
		&fakeDatasets{manifest: dataset.Manifest{DatasetID: "snapshot", Purpose: "screen", Checksum: "private-checksum"}, content: []byte(`{"private-candles":true}`)}, &fakeCompute{})
	if err != nil {
		t.Fatal(err)
	}
	request := func(path string) *http.Request {
		value := httptest.NewRequest(http.MethodGet, path, nil)
		value.Header.Set("Authorization", "Bearer identity")
		value.Header.Set("X-App-Session", "sgs_session")
		return value
	}
	for _, suffix := range []string{"manifest", "content"} {
		path := "/api/v1/datasets/snapshot/" + suffix
		permissions.features = []string{access.FeatureScreener}
		allowed := httptest.NewRecorder()
		server.ServeHTTP(allowed, request(path))
		if allowed.Code != http.StatusOK {
			t.Fatalf("authorized %s failed: %s", suffix, allowed.Body.String())
		}
		permissions.features = nil
		denied := httptest.NewRecorder()
		server.ServeHTTP(denied, request(path))
		assertErrorCode(t, denied, http.StatusForbidden, "ENTITLEMENT_REQUIRED")
		if strings.Contains(denied.Body.String(), "private-candles") || strings.Contains(denied.Body.String(), "private-checksum") || denied.Header().Get("ETag") != "" {
			t.Fatal("revoked dataset access leaked content/metadata")
		}
	}
}

func TestPrepareDatasetRejectsClientSuppliedOwner(t *testing.T) {
	server := testServer(t, fakeIdentity{principal: auth.Principal{ID: "owner"}}, &fakeSessions{})
	request := httptest.NewRequest(http.MethodPost, "/api/v1/datasets/prepare", strings.NewReader(`{"purpose":"screen","user_id":"foreign-owner"}`))
	request.Header.Set("Authorization", "Bearer identity")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusBadRequest, "INVALID_REQUEST")
}
