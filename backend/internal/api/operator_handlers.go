package api

import (
	"errors"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"net/http"
	"strings"
	"time"
)

// File ini hanya untuk operasi administratif yang membutuhkan role operator.
// Semua perubahan sensitif diteruskan ke AccessStore versi audited agar actor,
// request ID, target, alasan, dan waktu perubahan dapat dilacak.

// listOperatorGrants lets an operator inspect one account's feature grants.
func (server *Server) listOperatorGrants(writer http.ResponseWriter, request *http.Request) {
	if _, _, ok := server.requireOperator(writer, request); !ok {
		return
	}
	userID := strings.TrimSpace(request.URL.Query().Get("user_id"))
	if userID == "" {
		writeError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "User ID target wajib diisi.")
		return
	}
	grants, err := server.access.FeatureGrants(request.Context(), userID)
	if err != nil {
		writeOperatorGrantError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusOK, map[string]interface{}{"items": grants})
}

// createOperatorGrant activates a feature and records who did it and why.
func (server *Server) createOperatorGrant(writer http.ResponseWriter, request *http.Request) {
	principal, _, ok := server.requireOperator(writer, request)
	if !ok {
		return
	}
	if !server.allowRate(writer, request, "operator:write", principal.ID) {
		return
	}
	var input struct {
		UserID     string    `json:"user_id"`
		Feature    string    `json:"feature"`
		ValidUntil time.Time `json:"valid_until"`
		Reason     string    `json:"reason"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeJSONInputError(writer, request, err, "Body grant tidak valid.")
		return
	}
	if _, err := server.access.RequireActive(request.Context(), input.UserID); err != nil {
		writeOperatorGrantError(writer, request, err)
		return
	}
	grant, err := server.access.GrantFeatureAudited(
		request.Context(), principal.ID, requestID(request.Context()), input.UserID,
		input.Feature, input.ValidUntil, input.Reason,
	)
	if err != nil {
		writeOperatorGrantError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusCreated, grant)
}

// revokeOperatorGrant removes feature access through an audited mutation.
func (server *Server) revokeOperatorGrant(writer http.ResponseWriter, request *http.Request) {
	principal, _, ok := server.requireOperator(writer, request)
	if !ok {
		return
	}
	if !server.allowRate(writer, request, "operator:write", principal.ID) {
		return
	}
	var input struct {
		Reason string `json:"reason"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeJSONInputError(writer, request, err, "Body revoke tidak valid.")
		return
	}
	if err := server.access.RevokeFeatureAudited(
		request.Context(), principal.ID, requestID(request.Context()),
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
		writeError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Akun atau grant tidak ditemukan.")
	case errors.Is(err, access.ErrAccountSuspended):
		writeError(writer, request, http.StatusUnprocessableEntity, "TARGET_ACCOUNT_INACTIVE", "Akun target tidak aktif.")
	case errors.Is(err, access.ErrInvalidValue):
		writeError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Data grant tidak valid.")
	default:
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Grant belum dapat diproses.")
	}
}

// changeOperatorAccountRole changes server-owned role state and protects the
// system from demoting its last active operator.
func (server *Server) changeOperatorAccountRole(writer http.ResponseWriter, request *http.Request) {
	principal, _, ok := server.requireOperator(writer, request)
	if !ok {
		return
	}
	if !server.allowRate(writer, request, "operator:write", principal.ID) {
		return
	}
	var input struct {
		Role   string `json:"role"`
		Reason string `json:"reason"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeJSONInputError(writer, request, err, "Body perubahan role tidak valid.")
		return
	}
	accountRole, err := server.access.SetRoleAudited(
		request.Context(), principal.ID, requestID(request.Context()),
		request.PathValue("user_id"), input.Role, input.Reason,
	)
	if err != nil {
		writeOperatorRoleError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusOK, accountRole)
}

func writeOperatorRoleError(writer http.ResponseWriter, request *http.Request, err error) {
	switch {
	case errors.Is(err, access.ErrAccountNotFound):
		writeError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Akun target tidak ditemukan.")
	case errors.Is(err, access.ErrLastOperator):
		writeError(writer, request, http.StatusConflict, "LAST_OPERATOR_REQUIRED", "Operator aktif terakhir tidak dapat diturunkan rolenya.")
	case errors.Is(err, access.ErrInvalidValue):
		writeError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Role atau alasan tidak valid.")
	default:
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Role akun belum dapat diubah.")
	}
}
