package sessionsapi

import (
	"errors"
	"net/http"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

// RotateSession replaces only the current installation's opaque secret.
// Supabase identity refresh is a different endpoint and cannot call this for a
// revoked or expired session. The response token must replace X-App-Session.
func (server *Handler) RotateSession(writer http.ResponseWriter, request *http.Request) {
	principal, current, token, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	if !server.AllowRate(writer, request, "sessions:rotate", principal.ID) {
		return
	}
	if request.PathValue("id") != current.ID {
		shared.WriteError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Sesi tidak ditemukan.")
		return
	}
	if request.ContentLength != 0 {
		var input struct{}
		if err := shared.DecodeJSON(request, &input); err != nil {
			shared.WriteJSONInputError(writer, request, err, "Rotasi sesi tidak menerima perubahan masa berlaku atau perangkat.")
			return
		}
	}
	rotator, ok := server.Sessions.(session.TokenRotator)
	if !ok {
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Rotasi sesi belum tersedia.")
		return
	}
	created, err := rotator.Rotate(request.Context(), principal.ID, current.ID, token)
	if err != nil {
		if errors.Is(err, session.ErrInvalid) {
			shared.WriteError(writer, request, http.StatusForbidden, "SESSION_REVOKED", "Sesi berubah atau sudah tidak aktif.")
		} else {
			shared.WriteSessionError(writer, request, err)
		}
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusOK, created)
}
