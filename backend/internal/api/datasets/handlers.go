package datasetsapi

import (
	"net/http"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
)

// PrepareDataset validates purpose and entitlement before creating a stable
// manifest for the market data the browser is allowed to process.
func (server *Handler) PrepareDataset(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	if !server.AllowRate(writer, request, "datasets:prepare", principal.ID) {
		return
	}
	var input dataset.PrepareRequest
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Permintaan dataset tidak valid.")
		return
	}
	manifest, err := server.datasetService().Prepare(request.Context(), principal.ID, input)
	if err != nil {
		writeDatasetError(writer, request, err, operationPrepare)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusOK, manifest)
}

// DatasetManifest returns version/checksum metadata after rechecking access.
func (server *Handler) DatasetManifest(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	manifest, err := server.datasetService().Manifest(request.Context(), principal.ID, request.PathValue("id"))
	if err != nil {
		writeDatasetError(writer, request, err, operationManifest)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusOK, manifest)
}

// DatasetContent serves protected OHLCV JSON with a checksum-based ETag.
func (server *Handler) DatasetContent(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	content, manifest, err := server.datasetService().Content(request.Context(), principal.ID, request.PathValue("id"))
	if err != nil {
		writeDatasetError(writer, request, err, operationContent)
		return
	}
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.Header().Set("Cache-Control", "private, no-store")
	writer.Header().Set("ETag", `"`+manifest.Checksum+`"`)
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write(content)
}
