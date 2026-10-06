package apitests

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
)

// The new typed input must stay just as strict as the old anonymous HTTP struct:
// owner/session fields in JSON are rejected before the issuance service is called.
func TestComputeGrantRejectsClientSuppliedIdentity(t *testing.T) {
	for _, field := range []string{"user_id", "session_id"} {
		store := &fakeCompute{}
		server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "verified-owner"}}, &fakeSessions{},
			&fakeAccess{features: []string{access.FeatureScreener}}, &fakeDatasets{}, store)
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodPost, "/api/v1/compute-grants", strings.NewReader(`{"purpose":"screen","`+field+`":"foreign-owner"}`))
		request.Header.Set("Authorization", "Bearer identity")
		request.Header.Set("X-App-Session", "sgs_session")
		response := httptest.NewRecorder()
		server.ServeHTTP(response, request)
		assertErrorCode(t, response, http.StatusBadRequest, "INVALID_REQUEST")
		if store.created.UserID != "" {
			t.Fatal("client-supplied identity reached grant persistence")
		}
	}
}
