package api

import (
	"errors"
	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"net/http"
)

// File ini menangani dataset terproteksi dan compute grant.
// Compute grant mengikat user, app session, dataset, rule, dan versi engine
// sebelum hasil WASM boleh diteruskan ke private scoring.

// prepareDataset validates purpose and entitlement before creating a stable
// manifest for the market data the browser is allowed to process.
func (server *Server) prepareDataset(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}
	if !server.allowRate(writer, request, "datasets:prepare", principal.ID) {
		return
	}
	var input dataset.PrepareRequest
	if err := decodeJSON(request, &input); err != nil {
		writeJSONInputError(writer, request, err, "Permintaan dataset tidak valid.")
		return
	}
	feature, ok := featureForPurpose(input.Purpose)
	if !ok {
		writeError(writer, request, http.StatusUnprocessableEntity, "UNSUPPORTED_CAPABILITY", "Purpose dataset belum didukung.")
		return
	}
	if err := server.access.RequireFeature(request.Context(), principal.ID, feature); err != nil {
		writeAccessError(writer, request, err)
		return
	}
	if input.RuleID != core.BaselineRuleID {
		if _, err := server.rules.Get(request.Context(), principal.ID, input.RuleID); err != nil {
			writeRuleError(writer, request, err)
			return
		}
	}
	manifest, err := server.datasets.Prepare(request.Context(), principal.ID, input)
	if errors.Is(err, dataset.ErrInvalidRequest) {
		writeError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Rule atau stock universe tidak valid.")
		return
	}
	if errors.Is(err, dataset.ErrNotFound) {
		writeError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Stock universe tidak ditemukan.")
		return
	}
	if err != nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Dataset belum dapat disiapkan.")
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusOK, manifest)
}

// datasetManifest returns version/checksum metadata after rechecking access.
func (server *Server) datasetManifest(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}
	manifest, err := server.datasets.Manifest(request.Context(), principal.ID, request.PathValue("id"))
	if errors.Is(err, dataset.ErrNotFound) {
		writeError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Dataset tidak ditemukan.")
		return
	}
	if err != nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Manifest dataset belum dapat dibaca.")
		return
	}
	if err := server.requireDatasetFeature(request, principal.ID, manifest); err != nil {
		writeAccessError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusOK, manifest)
}

// datasetContent serves protected OHLCV JSON with a checksum-based ETag.
func (server *Server) datasetContent(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}
	content, manifest, err := server.datasets.Content(request.Context(), principal.ID, request.PathValue("id"))
	if errors.Is(err, dataset.ErrNotFound) {
		writeError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Dataset tidak ditemukan.")
		return
	}
	if err != nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Konten dataset belum dapat dibaca.")
		return
	}
	if err := server.requireDatasetFeature(request, principal.ID, manifest); err != nil {
		writeAccessError(writer, request, err)
		return
	}
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.Header().Set("Cache-Control", "private, no-store")
	writer.Header().Set("ETag", `"`+manifest.Checksum+`"`)
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write(content)
}

// createComputeGrant verifies every client-supplied binding against server
// state. A grant is issued only when dataset, rule, session, and engine agree.
func (server *Server) createComputeGrant(writer http.ResponseWriter, request *http.Request) {
	principal, appSession, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}
	if !server.allowRate(writer, request, "compute-grants:create", principal.ID) {
		return
	}
	var input struct {
		Purpose         string `json:"purpose"`
		DatasetID       string `json:"dataset_id"`
		DatasetVersion  string `json:"dataset_version"`
		DatasetChecksum string `json:"dataset_checksum"`
		RuleID          string `json:"rule_id"`
		DefinitionHash  string `json:"definition_hash"`
		EngineVersion   string `json:"engine_version"`
		SchemaVersion   string `json:"schema_version"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeJSONInputError(writer, request, err, "Permintaan compute grant tidak valid.")
		return
	}
	feature, supported := featureForPurpose(input.Purpose)
	if !supported {
		writeError(writer, request, http.StatusUnprocessableEntity, "UNSUPPORTED_CAPABILITY", "Purpose compute belum didukung.")
		return
	}
	if err := server.access.RequireFeature(request.Context(), principal.ID, feature); err != nil {
		writeAccessError(writer, request, err)
		return
	}
	manifest, err := server.datasets.Manifest(request.Context(), principal.ID, input.DatasetID)
	if errors.Is(err, dataset.ErrNotFound) {
		writeError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Dataset tidak ditemukan.")
		return
	}
	if err != nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Dataset belum dapat diverifikasi.")
		return
	}
	expectedRuleHash := core.BaselineRuleHash
	if input.RuleID != core.BaselineRuleID {
		rule, err := server.rules.Get(request.Context(), principal.ID, input.RuleID)
		if err != nil {
			writeRuleError(writer, request, err)
			return
		}
		expectedRuleHash = rule.DefinitionHash
	}
	if input.Purpose != manifest.Purpose || input.DatasetVersion != manifest.Version ||
		input.DatasetChecksum != manifest.Checksum || input.DefinitionHash != expectedRuleHash ||
		input.EngineVersion != core.EngineVersion || input.SchemaVersion != core.SchemaVersion {
		writeError(writer, request, http.StatusUnprocessableEntity, "UNSUPPORTED_CAPABILITY", "Versi dataset, rule, atau engine tidak cocok.")
		return
	}
	grant, err := server.compute.Create(request.Context(), compute.CreateRequest{
		UserID: principal.ID, SessionID: appSession.ID, Purpose: input.Purpose,
		DatasetID: input.DatasetID, DatasetVersion: input.DatasetVersion, DatasetChecksum: input.DatasetChecksum,
		RuleID: input.RuleID, DefinitionHash: input.DefinitionHash,
		EngineVersion: input.EngineVersion, SchemaVersion: input.SchemaVersion,
	})
	if errors.Is(err, compute.ErrInvalid) {
		writeError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Binding compute grant tidak valid.")
		return
	}
	if err != nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Compute grant belum dapat dibuat.")
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusCreated, grant)
}

// requireDatasetFeature maps a dataset purpose to its required entitlement.
func (server *Server) requireDatasetFeature(request *http.Request, userID string, manifest dataset.Manifest) error {
	feature, ok := featureForPurpose(manifest.Purpose)
	if !ok {
		return access.ErrEntitlementMissing
	}
	return server.access.RequireFeature(request.Context(), userID, feature)
}

// featureForPurpose is the centralized purpose-to-entitlement allow-list.
func featureForPurpose(purpose string) (string, bool) {
	switch purpose {
	case "screen":
		return access.FeatureScreener, true
	case "backtest":
		return access.FeatureBacktest, true
	default:
		return "", false
	}
}
