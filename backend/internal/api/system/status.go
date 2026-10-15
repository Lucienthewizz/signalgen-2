package systemapi

import (
	"net/http"

	contract "github.com/Lucienthewizz/signalgen-2/backend"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
)

// apiStatus returns public metadata used to identify the active Go API.
func (server *Handler) APIStatus(writer http.ResponseWriter, _ *http.Request) {
	shared.WriteJSON(writer, http.StatusOK, map[string]string{
		"name":        "SignalGen Go API",
		"version":     contract.Version(),
		"description": "Go authentication, account access, and hybrid analysis API.",
		"docs":        "/api/openapi.yaml",
		"status":      "ok",
	})
}

// OpenAPI exposes only the public contract; no environment values or private
// rule definitions are part of the embedded document.
func (server *Handler) OpenAPI(writer http.ResponseWriter, _ *http.Request) {
	writer.Header().Set("Content-Type", "application/yaml; charset=utf-8")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	writer.Header().Set("Cache-Control", "no-cache")
	_, _ = writer.Write([]byte(contract.OpenAPI()))
}
