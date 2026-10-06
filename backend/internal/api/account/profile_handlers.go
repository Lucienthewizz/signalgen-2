package accountapi

import (
	"errors"
	"net/http"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/account"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
)

// AccountProfile reads presentation fields for the verified owner, not the
// Supabase identity or privileged account state returned by other endpoints.
func (server *Handler) AccountProfile(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	if server.Profiles == nil {
		writeProfileError(writer, request, nil)
		return
	}
	profile, err := server.Profiles.Profile(request.Context(), principal.ID)
	if err != nil {
		writeProfileError(writer, request, err)
		return
	}
	shared.WriteJSON(writer, http.StatusOK, profile)
}

// UpdateAccountProfile maps a bounded partial update to the repository. The
// principal supplies ownership; version checking protects concurrent editors.
func (server *Handler) UpdateAccountProfile(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	if !server.AllowRate(writer, request, "profile:write", principal.ID) {
		return
	}
	var input account.UpdateProfileInput
	// Strict decoding rejects role, user_id, email and other unexpected fields.
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Perubahan profil tidak valid.")
		return
	}
	input, err := account.NormalizeProfileUpdate(input)
	if err != nil {
		writeProfileError(writer, request, err)
		return
	}
	if server.Profiles == nil {
		writeProfileError(writer, request, nil)
		return
	}
	profile, err := server.Profiles.UpdateProfile(request.Context(), principal.ID, input)
	if err != nil {
		writeProfileError(writer, request, err)
		return
	}
	shared.WriteJSON(writer, http.StatusOK, profile)
}

func writeProfileError(writer http.ResponseWriter, request *http.Request, err error) {
	switch {
	case errors.Is(err, account.ErrProfileInvalid):
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Kirim version dan nama maksimal 100 karakter atau bio maksimal 280 karakter.")
	case errors.Is(err, account.ErrProfileConflict):
		shared.WriteError(writer, request, http.StatusConflict, "VERSION_CONFLICT", "Profil sudah berubah. Muat ulang sebelum menyimpan.")
	case errors.Is(err, access.ErrAccountNotFound), errors.Is(err, access.ErrAccountSuspended):
		shared.WriteAccessError(writer, request, err)
	default:
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Profil belum dapat diakses.")
	}
}
