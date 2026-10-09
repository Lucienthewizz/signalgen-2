package sessionsapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

// CreateSession turns a verified Supabase identity into a device-bound
// SignalGen app session and enforces the configured device limit/cooldown.
func (server *Handler) CreateSession(writer http.ResponseWriter, request *http.Request) {
	principal, ok := server.RequirePrincipal(writer, request)
	if !ok {
		return
	}
	if !server.AllowRate(writer, request, "sessions:create", principal.ID) {
		return
	}
	var input struct {
		InstallationID string `json:"installation_id"`
		Label          string `json:"label"`
		Client         struct {
			AppVersion      string `json:"app_version"`
			UserAgentFamily string `json:"user_agent_family"`
		} `json:"client"`
	}
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Body sesi tidak valid.")
		return
	}
	if _, err := server.Access.EnsureProfile(request.Context(), principal.ID, principal.Email); err != nil {
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Profil akun belum dapat disiapkan.")
		return
	}
	created, err := server.Sessions.Create(request.Context(), principal.ID, input.InstallationID, input.Label)
	if errors.Is(err, session.ErrInvalidRequest) {
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Installation ID dan label wajib diisi.")
		return
	}
	if errors.Is(err, session.ErrSessionLimit) {
		shared.WriteError(writer, request, http.StatusConflict, "DEVICE_LIMIT_REACHED", "Batas sesi aktif sudah tercapai.")
		return
	}
	if errors.Is(err, session.ErrDeviceCooldown) {
		if metadata, supported := server.Sessions.(interface {
			CooldownUntil(context.Context, string) (time.Time, error)
		}); supported {
			if until, metadataErr := metadata.CooldownUntil(request.Context(), principal.ID); metadataErr == nil && until.After(time.Now()) {
				writer.Header().Set("Retry-After", strconv.FormatInt(int64(time.Until(until).Seconds())+1, 10))
			}
		}
		shared.WriteError(writer, request, http.StatusConflict, "DEVICE_SWITCH_COOLDOWN", "Perangkat hanya dapat dipindahkan sekali dalam 24 jam.")
		return
	}
	if err != nil {
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Sesi belum dapat dibuat.")
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusCreated, created)
}

// RevokeAccountSession remotely signs out one session owned by the user.
func (server *Handler) RevokeAccountSession(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	if err := server.Sessions.RevokeByID(request.Context(), principal.ID, request.PathValue("id")); err != nil {
		switch {
		case errors.Is(err, session.ErrNotFound):
			shared.WriteError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Sesi tidak ditemukan.")
		case errors.Is(err, session.ErrInvalidRequest):
			shared.WriteError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "ID sesi tidak valid.")
		default:
			shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Sesi belum dapat dicabut.")
		}
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

// RevokeCurrentSession logs out the exact X-App-Session used for this request.
func (server *Handler) RevokeCurrentSession(writer http.ResponseWriter, request *http.Request) {
	principal, _, token, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	if err := server.Sessions.Revoke(request.Context(), principal.ID, token); err != nil {
		shared.WriteSessionError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writer.WriteHeader(http.StatusNoContent)
}
