package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

// File ini menangani siklus sesi aplikasi dan perangkat pengguna.
// Supabase membuktikan identitas; handler di sini mengikat identitas tersebut
// ke instalasi SignalGen yang diizinkan oleh server.

// createSession turns a verified Supabase identity into a device-bound
// SignalGen app session and enforces the configured device limit/cooldown.
func (server *Server) createSession(writer http.ResponseWriter, request *http.Request) {
	principal, ok := server.requirePrincipal(writer, request)
	if !ok {
		return
	}
	if !server.allowRate(writer, request, "sessions:create", principal.ID) {
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
	if err := decodeJSON(request, &input); err != nil {
		writeJSONInputError(writer, request, err, "Body sesi tidak valid.")
		return
	}
	if _, err := server.access.EnsureProfile(request.Context(), principal.ID, principal.Email); err != nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Profil akun belum dapat disiapkan.")
		return
	}
	created, err := server.sessions.Create(request.Context(), principal.ID, input.InstallationID, input.Label)
	if errors.Is(err, session.ErrInvalidRequest) {
		writeError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Installation ID dan label wajib diisi.")
		return
	}
	if errors.Is(err, session.ErrSessionLimit) {
		writeError(writer, request, http.StatusConflict, "DEVICE_LIMIT_REACHED", "Batas sesi aktif sudah tercapai.")
		return
	}
	if errors.Is(err, session.ErrDeviceCooldown) {
		writeError(writer, request, http.StatusConflict, "DEVICE_SWITCH_COOLDOWN", "Perangkat hanya dapat dipindahkan sekali dalam 24 jam.")
		return
	}
	if err != nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Sesi belum dapat dibuat.")
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusCreated, created)
}

// accountMe combines identity, authorization profile, and active features for
// the signed-in account page.
func (server *Server) accountMe(writer http.ResponseWriter, request *http.Request) {
	principal, appSession, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}
	account, err := server.access.RequireActive(request.Context(), principal.ID)
	if err != nil {
		writeAccessError(writer, request, err)
		return
	}
	features, err := server.access.Features(request.Context(), principal.ID)
	if err != nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Fitur akun belum dapat dibaca.")
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusOK, map[string]interface{}{
		"user": map[string]string{
			"id": account.UserID, "email": account.Email, "role": account.Role, "status": account.Status,
		},
		"features": features,
		"session": map[string]interface{}{
			"id": appSession.ID, "expires_at": appSession.ExpiresAt,
		},
		"device": map[string]interface{}{
			"installation_id": appSession.InstallationID, "label": appSession.Label, "current": true,
		},
		"capabilities_version": core.CapabilitiesVersion,
	})
}

// accountSessions lists only sessions owned by the authenticated user.
func (server *Server) accountSessions(writer http.ResponseWriter, request *http.Request) {
	principal, currentSession, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}
	sessions, err := server.sessions.List(request.Context(), principal.ID)
	if err != nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Daftar sesi belum dapat dibaca.")
		return
	}
	now := time.Now().UTC()
	items := make([]map[string]interface{}, 0, len(sessions))
	for _, item := range sessions {
		status := "active"
		if item.RevokedAt != nil {
			status = "revoked"
		} else if !now.Before(item.ExpiresAt) {
			status = "expired"
		}
		items = append(items, map[string]interface{}{
			"id":              item.ID,
			"installation_id": item.InstallationID,
			"label":           item.Label,
			"created_at":      item.CreatedAt,
			"expires_at":      item.ExpiresAt,
			"last_seen_at":    item.LastSeenAt,
			"revoked_at":      item.RevokedAt,
			"status":          status,
			"current":         item.ID == currentSession.ID,
		})
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusOK, map[string]interface{}{
		"items": items, "max_items": 100, "active_session_limit": server.sessions.ActiveLimit(),
		"device_switch_cooldown_seconds": int64(server.sessions.DeviceSwitchCooldown().Seconds()),
	})
}

// revokeAccountSession remotely signs out one session owned by the user.
func (server *Server) revokeAccountSession(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}
	if err := server.sessions.RevokeByID(request.Context(), principal.ID, request.PathValue("id")); err != nil {
		switch {
		case errors.Is(err, session.ErrNotFound):
			writeError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Sesi tidak ditemukan.")
		case errors.Is(err, session.ErrInvalidRequest):
			writeError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "ID sesi tidak valid.")
		default:
			writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Sesi belum dapat dicabut.")
		}
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

// accountDevices projects app sessions into the user's device-management view.
func (server *Server) accountDevices(writer http.ResponseWriter, request *http.Request) {
	principal, currentSession, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}
	devices, err := server.sessions.ListDevices(request.Context(), principal.ID)
	if err != nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Daftar perangkat belum dapat dibaca.")
		return
	}
	items := make([]map[string]interface{}, 0, len(devices))
	for _, device := range devices {
		items = append(items, map[string]interface{}{
			"id": device.ID, "label": device.Label, "status": device.Status,
			"created_at": device.CreatedAt, "last_seen_at": device.LastSeenAt,
			"current": device.ID == currentSession.InstallationID,
		})
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusOK, map[string]interface{}{"items": items})
}

// updateAccountDevice either renames or revokes a device selected by path ID.
func (server *Server) updateAccountDevice(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}
	if !server.allowRate(writer, request, "devices:write", principal.ID) {
		return
	}
	var input struct {
		Label  *string `json:"label"`
		Status *string `json:"status"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeJSONInputError(writer, request, err, "Perubahan perangkat tidak valid.")
		return
	}
	installationID := request.PathValue("id")
	var err error
	switch {
	case input.Label != nil && input.Status == nil:
		err = server.sessions.RenameDevice(request.Context(), principal.ID, installationID, *input.Label)
	case input.Label == nil && input.Status != nil && *input.Status == "revoked":
		err = server.sessions.RevokeDevice(request.Context(), principal.ID, installationID)
	default:
		writeError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Kirim tepat satu perubahan: label atau status revoked.")
		return
	}
	if err != nil {
		switch {
		case errors.Is(err, session.ErrNotFound):
			writeError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Perangkat tidak ditemukan.")
		case errors.Is(err, session.ErrInvalidRequest):
			writeError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Perubahan perangkat tidak valid.")
		default:
			writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Perangkat belum dapat diubah.")
		}
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writer.WriteHeader(http.StatusNoContent)
}

// revokeCurrentSession logs out the exact X-App-Session used for this request.
func (server *Server) revokeCurrentSession(writer http.ResponseWriter, request *http.Request) {
	principal, _, token, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}
	if err := server.sessions.Revoke(request.Context(), principal.ID, token); err != nil {
		writeSessionError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writer.WriteHeader(http.StatusNoContent)
}
