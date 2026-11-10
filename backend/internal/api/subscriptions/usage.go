package subscriptionsapi

import (
	"net/http"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
)

func (server *Handler) ResourceUsage(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	if _, err := server.Access.RequireActive(request.Context(), principal.ID); err != nil {
		shared.WriteAccessError(writer, request, err)
		return
	}
	policy, err := server.EffectiveAccess(request.Context(), principal.ID)
	if err != nil {
		shared.WriteAccessError(writer, request, err)
		return
	}

	rules, err := server.Rules.List(request.Context(), principal.ID)
	if err != nil {
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Pemakaian rule belum dapat diperiksa.")
		return
	}
	universes, err := server.Universes.List(request.Context(), principal.ID)
	if err != nil {
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Pemakaian universe belum dapat diperiksa.")
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusOK, map[string]any{
		"limits": policy.Limits,
		"access": policy,
		"used":   map[string]int{"custom_rules": len(rules), "stock_universes": len(universes)},
	})
}
