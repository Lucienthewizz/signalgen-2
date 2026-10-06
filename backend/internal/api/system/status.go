package systemapi

import (
	"net/http"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
)

// apiStatus returns public metadata used to identify the active Go API.
func (server *Handler) APIStatus(writer http.ResponseWriter, _ *http.Request) {
	shared.WriteJSON(writer, http.StatusOK, map[string]string{
		"name":        "SignalGen Go API",
		"version":     "0.9.0",
		"description": "Go authentication, account access, and hybrid analysis API.",
		"docs":        "/backend/openapi.yaml",
		"status":      "ok",
	})
}
