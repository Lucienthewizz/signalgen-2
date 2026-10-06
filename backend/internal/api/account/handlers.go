package accountapi

import (
	"errors"
	"net/http"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

// AccountMe combines identity, authorization profile, and active features for
// the signed-in account page.
func (server *Handler) AccountMe(writer http.ResponseWriter, request *http.Request) {
	principal, appSession, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	account, err := server.Access.RequireActive(request.Context(), principal.ID)
	if err != nil {
		shared.WriteAccessError(writer, request, err)
		return
	}
	features, err := server.Access.Features(request.Context(), principal.ID)
	if err != nil {
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Fitur akun belum dapat dibaca.")
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusOK, map[string]interface{}{
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

// AccountSessions lists only sessions owned by the authenticated user.
func (server *Handler) AccountSessions(writer http.ResponseWriter, request *http.Request) {
	principal, currentSession, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	sessions, err := server.Sessions.List(request.Context(), principal.ID)
	if err != nil {
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Daftar sesi belum dapat dibaca.")
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
	shared.WriteJSON(writer, http.StatusOK, map[string]interface{}{
		"items": items, "max_items": 100, "active_session_limit": server.Sessions.ActiveLimit(),
		"device_switch_cooldown_seconds": int64(server.Sessions.DeviceSwitchCooldown().Seconds()),
	})
}

// AccountDevices projects app sessions into the user's device-management view.
func (server *Handler) AccountDevices(writer http.ResponseWriter, request *http.Request) {
	principal, currentSession, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	devices, err := server.Sessions.ListDevices(request.Context(), principal.ID)
	if err != nil {
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Daftar perangkat belum dapat dibaca.")
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
	shared.WriteJSON(writer, http.StatusOK, map[string]interface{}{"items": items})
}

// UpdateAccountDevice either renames or revokes a device selected by path ID.
func (server *Handler) UpdateAccountDevice(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	if !server.AllowRate(writer, request, "devices:write", principal.ID) {
		return
	}
	var input struct {
		Label  *string `json:"label"`
		Status *string `json:"status"`
	}
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Perubahan perangkat tidak valid.")
		return
	}
	installationID := request.PathValue("id")
	var err error
	switch {
	case input.Label != nil && input.Status == nil:
		err = server.Sessions.RenameDevice(request.Context(), principal.ID, installationID, *input.Label)
	case input.Label == nil && input.Status != nil && *input.Status == "revoked":
		err = server.Sessions.RevokeDevice(request.Context(), principal.ID, installationID)
	default:
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Kirim tepat satu perubahan: label atau status revoked.")
		return
	}
	if err != nil {
		switch {
		case errors.Is(err, session.ErrNotFound):
			shared.WriteError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Perangkat tidak ditemukan.")
		case errors.Is(err, session.ErrInvalidRequest):
			shared.WriteError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Perubahan perangkat tidak valid.")
		default:
			shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Perangkat belum dapat diubah.")
		}
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writer.WriteHeader(http.StatusNoContent)
}
