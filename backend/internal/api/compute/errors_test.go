package computeapi

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
)

func TestIssuanceErrorMappingPreservesContract(t *testing.T) {
	private := errors.New("private-store-password-detail")
	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{
		{compute.ErrUnsupportedPurpose, 422, "UNSUPPORTED_CAPABILITY"},
		{compute.ErrBindingMismatch, 422, "UNSUPPORTED_CAPABILITY"},
		{&compute.IssuanceError{Stage: compute.StageEntitlement, Err: access.ErrEntitlementMissing}, 403, "ENTITLEMENT_REQUIRED"},
		{&compute.IssuanceError{Stage: compute.StageDataset, Err: dataset.ErrNotFound}, 404, "RESOURCE_NOT_FOUND"},
		{&compute.IssuanceError{Stage: compute.StageDataset, Err: private}, 503, "SERVICE_UNAVAILABLE"},
		{&compute.IssuanceError{Stage: compute.StageRule, Err: rules.ErrNotFound}, 404, "RESOURCE_NOT_FOUND"},
		{&compute.IssuanceError{Stage: compute.StageGrant, Err: compute.ErrInvalid}, 422, "INVALID_REQUEST"},
		{&compute.IssuanceError{Stage: compute.StageGrant, Err: private}, 503, "SERVICE_UNAVAILABLE"},
	} {
		response := httptest.NewRecorder()
		writeIssuanceError(response, httptest.NewRequest("POST", "/api/v1/compute-grants", nil), tc.err)
		var body struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if response.Code != tc.status || body.Error.Code != tc.code {
			t.Fatalf("status=%d code=%s want=%d %s", response.Code, body.Error.Code, tc.status, tc.code)
		}
		if strings.Contains(response.Body.String(), private.Error()) {
			t.Fatal("private dependency details leaked")
		}
	}
}
