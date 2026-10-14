package operatorapi

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/account"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
)

// ListAccounts returns bounded administration metadata. An operator does not
// gain access to another user's private rules/datasets by visiting this route.
func (server *Handler) ListAccounts(writer http.ResponseWriter, request *http.Request) {
	principal, _, ok := server.RequireOperator(writer, request)
	if !ok || !server.managementReady(writer, request) {
		return
	}
	limit, ok := listLimit(writer, request, "limit", "after", "role", "status")
	if !ok {
		return
	}
	query, err := account.NormalizeAccountQuery(account.AccountQuery{Limit: limit,
		After: request.URL.Query().Get("after"), Role: request.URL.Query().Get("role"), Status: request.URL.Query().Get("status")})
	if err != nil {
		writeManagementError(writer, request, err)
		return
	}
	page, err := server.Management.ListAccounts(request.Context(), principal.ID, query)
	if err != nil {
		writeManagementError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusOK, page)
}

func (server *Handler) ChangeAccountStatus(writer http.ResponseWriter, request *http.Request) {
	principal, _, ok := server.RequireOperator(writer, request)
	if !ok || !server.managementReady(writer, request) {
		return
	}
	if !server.AllowRate(writer, request, "operator:write", principal.ID) {
		return
	}
	var input account.StatusUpdate
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Body status akun tidak valid.")
		return
	}
	input, err := account.NormalizeStatusUpdate(input)
	if err != nil || !account.ValidUserID(request.PathValue("user_id")) {
		writeManagementError(writer, request, access.ErrInvalidValue)
		return
	}
	item, err := server.Management.SetStatusAudited(request.Context(), principal.ID, shared.RequestID(request.Context()), request.PathValue("user_id"), input)
	if err != nil {
		writeManagementError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusOK, item)
}

func (server *Handler) ListAccountAudit(writer http.ResponseWriter, request *http.Request) {
	principal, _, ok := server.RequireOperator(writer, request)
	if !ok || !server.managementReady(writer, request) {
		return
	}
	limit, ok := listLimit(writer, request, "limit", "user_id", "before")
	if !ok {
		return
	}
	var before int64
	if raw, present := request.URL.Query()["before"]; present {
		var err error
		before, err = strconv.ParseInt(raw[0], 10, 64)
		if err != nil || before < 1 {
			writeManagementError(writer, request, access.ErrInvalidValue)
			return
		}
	}
	query, err := account.NormalizeAuditQuery(account.AuditQuery{UserID: request.URL.Query().Get("user_id"), Limit: limit, Before: before})
	if err != nil {
		writeManagementError(writer, request, err)
		return
	}
	page, err := server.Management.ListAccountAudit(request.Context(), principal.ID, query)
	if err != nil {
		writeManagementError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusOK, page)
}

func (server *Handler) managementReady(writer http.ResponseWriter, request *http.Request) bool {
	if server.Management == nil {
		writeManagementError(writer, request, errors.New("management unavailable"))
		return false
	}
	return true
}

// Reject ambiguous/unknown filters before the repository; all SQL values remain
// bound parameters. Cursor IDs are data, never dynamically interpolated SQL.
func listLimit(writer http.ResponseWriter, request *http.Request, allowed ...string) (int, bool) {
	values, err := url.ParseQuery(request.URL.RawQuery)
	if err != nil {
		writeManagementError(writer, request, access.ErrInvalidValue)
		return 0, false
	}
	for name, entries := range values {
		known := false
		for _, field := range allowed {
			if name == field {
				known = true
				break
			}
		}
		if !known || len(entries) != 1 || entries[0] == "" {
			writeManagementError(writer, request, access.ErrInvalidValue)
			return 0, false
		}
	}
	limit := 25
	if raw := values.Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > 100 {
			writeManagementError(writer, request, access.ErrInvalidValue)
			return 0, false
		}
	}
	return limit, true
}

func writeManagementError(writer http.ResponseWriter, request *http.Request, err error) {
	switch {
	case errors.Is(err, access.ErrInvalidValue):
		shared.WriteError(writer, request, 422, "INVALID_REQUEST", "Parameter, status, atau alasan tidak valid.")
	case errors.Is(err, access.ErrAccountNotFound):
		shared.WriteError(writer, request, 404, "RESOURCE_NOT_FOUND", "Akun target tidak ditemukan.")
	case errors.Is(err, access.ErrLastOperator):
		shared.WriteError(writer, request, 409, "LAST_OPERATOR_REQUIRED", "Operator aktif terakhir tidak dapat dinonaktifkan.")
	case errors.Is(err, account.ErrStatusConflict):
		shared.WriteError(writer, request, 409, "STATUS_CONFLICT", "Status akun sudah berubah; muat ulang sebelum melanjutkan.")
	case errors.Is(err, access.ErrRoleRequired), errors.Is(err, access.ErrAccountSuspended):
		shared.WriteAccessError(writer, request, err)
	default:
		shared.WriteError(writer, request, 503, "SERVICE_UNAVAILABLE", "Pengelolaan akun belum dapat diproses.")
	}
}
