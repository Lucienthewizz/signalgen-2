package computeapi

import (
	"net/http"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
)

// CreateComputeGrant owns HTTP concerns only: verified identity/session, rate
// limiting, strict JSON input, domain error mapping, and the response envelope.
func (server *Handler) CreateComputeGrant(writer http.ResponseWriter, request *http.Request) {
	principal, appSession, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	if !server.AllowRate(writer, request, "compute-grants:create", principal.ID) {
		return
	}
	var input compute.IssueInput
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Permintaan compute grant tidak valid.")
		return
	}
	service := compute.IssuanceService{Features: server.Access, Datasets: server.Datasets, Rules: server.Rules, Grants: server.Compute}
	grant, err := service.Issue(request.Context(), principal.ID, appSession.ID, input)
	if err != nil {
		writeIssuanceError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusCreated, grant)
}
