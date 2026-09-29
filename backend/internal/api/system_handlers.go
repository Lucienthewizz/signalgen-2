package api

import (
	"net/http"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
)

// capabilities reports the exact protocol and engine versions supported by
// this backend. The frontend checks this before loading WASM so incompatible
// client and server builds fail early instead of producing incorrect signals.
func (server *Server) capabilities(writer http.ResponseWriter, request *http.Request) {
	_, _, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}

	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusOK, core.GetCapabilities())
}
