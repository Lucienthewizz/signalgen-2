package screenerapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
)

func (server *Handler) CreateScreenerSocketTicket(writer http.ResponseWriter, request *http.Request) {
	principal, appSession, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	if !server.AllowRate(writer, request, "screener-tickets:create", principal.ID) {
		return
	}
	var input struct {
		ComputeGrantID string `json:"compute_grant_id"`
		Protocol       string `json:"protocol"`
	}
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Permintaan socket ticket tidak valid.")
		return
	}
	if input.Protocol != core.PrivateProtocol || strings.TrimSpace(input.ComputeGrantID) == "" {
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "UNSUPPORTED_CAPABILITY", "Protokol private scoring tidak didukung.")
		return
	}
	if err := server.Access.RequireFeature(request.Context(), principal.ID, access.FeatureScreener); err != nil {
		shared.WriteAccessError(writer, request, err)
		return
	}
	grant, err := server.Compute.Verify(request.Context(), principal.ID, appSession.ID, input.ComputeGrantID)
	if err != nil {
		shared.WriteComputeGrantError(writer, request, err)
		return
	}
	if grant.Purpose != "screen" || grant.EngineVersion != core.EngineVersion || grant.SchemaVersion != core.SchemaVersion {
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "VERSION_MISMATCH", "Versi compute grant tidak cocok dengan private scoring.")
		return
	}
	if _, ok, _ := server.verifiedScreenerDataset(writer, request, principal.ID, grant); !ok {
		return
	}
	created, err := server.Tickets.Create(request.Context(), screener.Binding{
		UserID: principal.ID, SessionID: appSession.ID, ComputeGrantID: grant.ID,
		RuleID: grant.RuleID, DefinitionHash: grant.DefinitionHash,
		EngineVersion: grant.EngineVersion, SchemaVersion: grant.SchemaVersion,
		FeatureSchema: core.FeatureSchemaVersion,
	})
	if err != nil {
		if errors.Is(err, screener.ErrCapacity) {
			writer.Header().Set("Retry-After", "1")
			shared.WriteError(writer, request, http.StatusTooManyRequests, "TICKET_CAPACITY_REACHED", "Batas ticket screening sedang penuh. Coba kembali nanti.")
			return
		}
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Socket ticket belum dapat dibuat.")
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusCreated, map[string]interface{}{
		"ticket": created.Token, "expires_at": created.ExpiresAt,
		"websocket_path": "/api/v1/screener/ws", "protocol": core.PrivateProtocol,
		"feature_schema_version": core.FeatureSchemaVersion,
		"max_candidates":         maxScreenerCandidates,
	})
}

// A persisted compute grant can outlive an in-memory snapshot after restart or
// expiry. Verify the snapshot again at ticket issuance and WebSocket upgrade.
func (server *Handler) verifiedScreenerDataset(writer http.ResponseWriter, request *http.Request, owner string, grant compute.Grant) (dataset.Manifest, bool, screener.Outcome) {
	manifest, err := server.Datasets.Manifest(request.Context(), owner, grant.DatasetID)
	if errors.Is(err, dataset.ErrNotFound) {
		shared.WriteError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Dataset sudah kedaluwarsa atau tidak ditemukan. Siapkan dataset kembali.")
		return dataset.Manifest{}, false, screener.OutcomeRejected
	}
	if err != nil {
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Dataset belum dapat diverifikasi.")
		return dataset.Manifest{}, false, screener.OutcomeUnavailable
	}
	if manifest.DatasetID == "" || manifest.DatasetID != grant.DatasetID || manifest.Version != grant.DatasetVersion || manifest.Checksum != grant.DatasetChecksum || manifest.Purpose != grant.Purpose {
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "VERSION_MISMATCH", "Dataset tidak cocok dengan compute grant.")
		return dataset.Manifest{}, false, screener.OutcomeRejected
	}
	return manifest, true, ""
}
