package operatorapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
)

// ListOperatorGrants lets an operator inspect one account's feature grants.
func (server *Handler) ListOperatorGrants(writer http.ResponseWriter, request *http.Request) {
	if _, _, ok := server.RequireOperator(writer, request); !ok {
		return
	}
	userID := strings.TrimSpace(request.URL.Query().Get("user_id"))
	if userID == "" {
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "User ID target wajib diisi.")
		return
	}
	grants, err := server.Access.FeatureGrants(request.Context(), userID)
	if err != nil {
		writeOperatorGrantError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusOK, map[string]interface{}{"items": grants})
}

// CreateOperatorGrant activates a feature and records who did it and why.
func (server *Handler) CreateOperatorGrant(writer http.ResponseWriter, request *http.Request) {
	principal, _, ok := server.RequireOperator(writer, request)
	if !ok {
		return
	}
	if !server.AllowRate(writer, request, "operator:write", principal.ID) {
		return
	}
	var input struct {
		UserID     string    `json:"user_id"`
		Feature    string    `json:"feature"`
		ValidUntil time.Time `json:"valid_until"`
		Reason     string    `json:"reason"`
	}
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Body grant tidak valid.")
		return
	}
	if _, err := server.Access.RequireActive(request.Context(), input.UserID); err != nil {
		writeOperatorGrantError(writer, request, err)
		return
	}
	grant, err := server.Access.GrantFeatureAudited(
		request.Context(), principal.ID, shared.RequestID(request.Context()), input.UserID,
		input.Feature, input.ValidUntil, input.Reason,
	)
	if err != nil {
		writeOperatorGrantError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusCreated, grant)
}

// RevokeOperatorGrant removes feature access through an audited mutation.
func (server *Handler) RevokeOperatorGrant(writer http.ResponseWriter, request *http.Request) {
	principal, _, ok := server.RequireOperator(writer, request)
	if !ok {
		return
	}
	if !server.AllowRate(writer, request, "operator:write", principal.ID) {
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Body revoke tidak valid.")
		return
	}
	if err := server.Access.RevokeFeatureAudited(
		request.Context(), principal.ID, shared.RequestID(request.Context()),
		request.PathValue("user_id"), request.PathValue("feature"), input.Reason,
	); err != nil {
		writeOperatorGrantError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writer.WriteHeader(http.StatusNoContent)
}

func writeOperatorGrantError(writer http.ResponseWriter, request *http.Request, err error) {
	switch {
	case errors.Is(err, access.ErrAccountNotFound), errors.Is(err, access.ErrEntitlementMissing):
		shared.WriteError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Akun atau grant tidak ditemukan.")
	case errors.Is(err, access.ErrAccountSuspended):
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "TARGET_ACCOUNT_INACTIVE", "Akun target tidak aktif.")
	case errors.Is(err, access.ErrInvalidValue):
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Data grant tidak valid.")
	default:
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Grant belum dapat diproses.")
	}
}

// ChangeOperatorAccountRole changes server-owned role state and protects the
// system from demoting its last active operator.
func (server *Handler) ChangeOperatorAccountRole(writer http.ResponseWriter, request *http.Request) {
	principal, _, ok := server.RequireOperator(writer, request)
	if !ok {
		return
	}
	if !server.AllowRate(writer, request, "operator:write", principal.ID) {
		return
	}
	var input struct {
		Role   string `json:"role"`
		Reason string `json:"reason"`
	}
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Body perubahan role tidak valid.")
		return
	}
	accountRole, err := server.Access.SetRoleAudited(
		request.Context(), principal.ID, shared.RequestID(request.Context()),
		request.PathValue("user_id"), input.Role, input.Reason,
	)
	if err != nil {
		writeOperatorRoleError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusOK, accountRole)
}

func writeOperatorRoleError(writer http.ResponseWriter, request *http.Request, err error) {
	switch {
	case errors.Is(err, access.ErrAccountNotFound):
		shared.WriteError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Akun target tidak ditemukan.")
	case errors.Is(err, access.ErrLastOperator):
		shared.WriteError(writer, request, http.StatusConflict, "LAST_OPERATOR_REQUIRED", "Operator aktif terakhir tidak dapat diturunkan rolenya.")
	case errors.Is(err, access.ErrInvalidValue):
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Role atau alasan tidak valid.")
	default:
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Role akun belum dapat diubah.")
	}
}
