package datasetsapi

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
)

func TestDatasetErrorMappingPreservesContract(t *testing.T) {
	private := errors.New("private-provider-secret")
	for _, tc := range []struct {
		action      operation
		err         error
		status      int
		code, retry string
	}{
		{operationPrepare, dataset.ErrUnsupportedPurpose, 422, "UNSUPPORTED_CAPABILITY", ""},
		{operationPrepare, &dataset.AccessError{Err: access.ErrEntitlementMissing}, 403, "ENTITLEMENT_REQUIRED", ""},
		{operationPrepare, &dataset.RuleError{Err: rules.ErrNotFound}, 404, "RESOURCE_NOT_FOUND", ""},
		{operationPrepare, dataset.ErrCapacity, 503, "SERVICE_UNAVAILABLE", "60"},
		{operationPrepare, dataset.ErrInvalidRequest, 422, "INVALID_REQUEST", ""},
		{operationPrepare, dataset.ErrNotFound, 404, "RESOURCE_NOT_FOUND", ""},
		{operationPrepare, private, 503, "SERVICE_UNAVAILABLE", ""},
		{operationManifest, dataset.ErrNotFound, 404, "RESOURCE_NOT_FOUND", ""},
		{operationManifest, private, 503, "SERVICE_UNAVAILABLE", ""},
		{operationContent, dataset.ErrNotFound, 404, "RESOURCE_NOT_FOUND", ""},
		{operationContent, &dataset.AccessError{Err: access.ErrEntitlementMissing}, 403, "ENTITLEMENT_REQUIRED", ""},
		{operationContent, private, 503, "SERVICE_UNAVAILABLE", ""},
	} {
		response := httptest.NewRecorder()
		writeDatasetError(response, httptest.NewRequest("GET", "/dataset-test", nil), tc.err, tc.action)
		var body struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if response.Code != tc.status || body.Error.Code != tc.code || response.Header().Get("Retry-After") != tc.retry {
			t.Fatalf("status=%d code=%s retry=%s", response.Code, body.Error.Code, response.Header().Get("Retry-After"))
		}
		if strings.Contains(response.Body.String(), private.Error()) {
			t.Fatal("provider detail leaked")
		}
	}
}
