package systemapi

import (
	"context"
	"net/http"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
)

// Health is a lightweight liveness endpoint. It does not touch dependencies.
func (server *Handler) Health(writer http.ResponseWriter, _ *http.Request) {
	shared.WriteJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
}

// Ready verifies dependencies such as Postgres and the dataset source before
// accepting real traffic.
func (server *Handler) Ready(checkers []shared.ReadinessChecker) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		ctx, cancel := context.WithTimeout(request.Context(), 2*time.Second)
		defer cancel()
		for _, checker := range checkers {
			if err := checker.Ready(ctx); err != nil {
				shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service belum siap.")
				return
			}
		}
		shared.WriteJSON(writer, http.StatusOK, map[string]string{"status": "ready"})
	}
}
