package computeapi

import (
	"errors"
	"net/http"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
)

// writeIssuanceError preserves the existing HTTP contract after service extraction.
// Dependency errors are never serialized; users receive stable, safe messages.
func writeIssuanceError(writer http.ResponseWriter, request *http.Request, err error) {
	switch {
	case errors.Is(err, compute.ErrUnsupportedPurpose):
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "UNSUPPORTED_CAPABILITY", "Purpose compute belum didukung.")
	case errors.Is(err, compute.ErrBindingMismatch):
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "UNSUPPORTED_CAPABILITY", "Versi dataset, rule, atau engine tidak cocok.")
	default:
		var failure *compute.IssuanceError
		if errors.As(err, &failure) {
			switch failure.Stage {
			case compute.StageEntitlement:
				shared.WriteAccessError(writer, request, failure.Err)
				return
			case compute.StageRule:
				shared.WriteRuleError(writer, request, failure.Err)
				return
			case compute.StageDataset:
				if errors.Is(failure.Err, dataset.ErrNotFound) {
					shared.WriteError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Dataset tidak ditemukan.")
				} else {
					shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Dataset belum dapat diverifikasi.")
				}
				return
			case compute.StageGrant:
				if errors.Is(failure.Err, compute.ErrInvalid) {
					shared.WriteError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Binding compute grant tidak valid.")
				} else {
					shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Compute grant belum dapat dibuat.")
				}
				return
			}
		}
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Compute grant belum dapat dibuat.")
	}
}
