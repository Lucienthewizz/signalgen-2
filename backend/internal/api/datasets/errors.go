package datasetsapi

import (
	"errors"
	"net/http"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
)

type operation string

const (
	operationPrepare  operation = "prepare"
	operationManifest operation = "manifest"
	operationContent  operation = "content"
)

// writeDatasetError keeps error text, statuses and retry headers compatible.
// Raw dependency errors never enter the public response.
func writeDatasetError(writer http.ResponseWriter, request *http.Request, err error, action operation) {
	var denied *dataset.AccessError
	if errors.As(err, &denied) {
		shared.WriteAccessError(writer, request, denied.Err)
		return
	}
	var rule *dataset.RuleError
	if errors.As(err, &rule) {
		shared.WriteRuleError(writer, request, rule.Err)
		return
	}
	if action == operationPrepare {
		switch {
		case errors.Is(err, dataset.ErrUnsupportedPurpose):
			shared.WriteError(writer, request, http.StatusUnprocessableEntity, "UNSUPPORTED_CAPABILITY", "Purpose dataset belum didukung.")
		case errors.Is(err, dataset.ErrCapacity):
			writer.Header().Set("Retry-After", "60")
			shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Kapasitas dataset sementara penuh. Coba kembali nanti.")
		case errors.Is(err, dataset.ErrInvalidRequest):
			shared.WriteError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Rule atau stock universe tidak valid.")
		case errors.Is(err, dataset.ErrNotFound):
			shared.WriteError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Stock universe tidak ditemukan.")
		default:
			shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Dataset belum dapat disiapkan.")
		}
		return
	}
	if errors.Is(err, dataset.ErrNotFound) {
		shared.WriteError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Dataset tidak ditemukan.")
		return
	}
	message := "Manifest dataset belum dapat dibaca."
	if action == operationContent {
		message = "Konten dataset belum dapat dibaca."
	}
	shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", message)
}
