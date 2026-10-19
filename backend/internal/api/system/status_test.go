package systemapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	contract "github.com/Lucienthewizz/signalgen-2/backend"
)

func TestPublicStatusAndContractStayInSync(t *testing.T) {
	handler := &Handler{}
	status := httptest.NewRecorder()
	handler.APIStatus(status, httptest.NewRequest(http.MethodGet, "/api", nil))
	var metadata map[string]string
	if err := json.Unmarshal(status.Body.Bytes(), &metadata); err != nil {
		t.Fatal(err)
	}
	if metadata["version"] != contract.Version() || contract.Version() == "unknown" || metadata["docs"] != "/api/openapi.yaml" {
		t.Fatal("status drifted from embedded API contract")
	}
	document := httptest.NewRecorder()
	handler.OpenAPI(document, httptest.NewRequest(http.MethodGet, metadata["docs"], nil))
	if document.Code != 200 || document.Body.String() != contract.OpenAPI() || document.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("public contract cannot be served intact")
	}
}
