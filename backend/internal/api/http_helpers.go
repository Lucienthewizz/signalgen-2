package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	platformhttp "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/http"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

// Compatibility aliases keep existing handler tests stable while generic
// transport behavior lives in internal/platform/http.
const maxJSONBody = platformhttp.MaxJSONBody

var errJSONBodyTooLarge = platformhttp.ErrJSONBodyTooLarge

func decodeJSON(request *http.Request, target any) error {
	return platformhttp.DecodeJSON(request, target)
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	platformhttp.WriteJSON(writer, status, value)
}

func writeError(writer http.ResponseWriter, request *http.Request, status int, code, message string) {
	// Package-local tests from the pre-platform split still inject the old
	// context key directly. Preserve that seam while production requests use
	// platform/http.RequestContext.
	if platformhttp.RequestID(request.Context()) == "" {
		if legacyID, _ := request.Context().Value(requestIDKey{}).(string); legacyID != "" {
			writer.Header().Set("Cache-Control", "private, no-store")
			platformhttp.WriteJSON(writer, status, map[string]any{
				"error": map[string]string{
					"code": code, "message": message, "request_id": legacyID,
				},
			})
			return
		}
	}
	platformhttp.WriteError(writer, request, status, code, message)
}

// requestIDKey remains only for package-local compatibility tests. Production
// request IDs are created and read by platform/http.
type requestIDKey struct{}

func requestID(ctx context.Context) string {
	if value, _ := ctx.Value(requestIDKey{}).(string); value != "" {
		return value
	}
	return platformhttp.RequestID(ctx)
}

func (server *Server) requirePrincipal(writer http.ResponseWriter, request *http.Request) (auth.Principal, bool) {
	token, err := auth.BearerToken(request.Header.Get("Authorization"))
	if err != nil {
		writeError(writer, request, http.StatusUnauthorized, "AUTH_REQUIRED", "Login diperlukan.")
		return auth.Principal{}, false
	}
	principal, err := server.identity.Verify(request.Context(), token)
	switch {
	case err == nil:
		return principal, true
	case errors.Is(err, auth.ErrTokenInvalid), errors.Is(err, auth.ErrTokenRequired):
		writeError(writer, request, http.StatusUnauthorized, "AUTH_INVALID", "Token login tidak valid atau sudah kedaluwarsa.")
	default:
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Layanan identitas sedang tidak tersedia.")
	}
	return auth.Principal{}, false
}

func (server *Server) requireAppSession(writer http.ResponseWriter, request *http.Request) (auth.Principal, session.Session, string, bool) {
	principal, ok := server.requirePrincipal(writer, request)
	if !ok {
		return auth.Principal{}, session.Session{}, "", false
	}
	token := strings.TrimSpace(request.Header.Get("X-App-Session"))
	if token == "" {
		writeError(writer, request, http.StatusUnauthorized, "AUTH_REQUIRED", "Sesi aplikasi diperlukan.")
		return auth.Principal{}, session.Session{}, "", false
	}
	appSession, err := server.sessions.Verify(request.Context(), principal.ID, token)
	if err != nil {
		writeSessionError(writer, request, err)
		return auth.Principal{}, session.Session{}, "", false
	}
	if _, err := server.access.RequireActive(request.Context(), principal.ID); err != nil {
		writeAccessError(writer, request, err)
		return auth.Principal{}, session.Session{}, "", false
	}
	return principal, appSession, token, true
}

func (server *Server) requireOperator(writer http.ResponseWriter, request *http.Request) (auth.Principal, session.Session, bool) {
	principal, appSession, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return auth.Principal{}, session.Session{}, false
	}
	if _, err := server.access.RequireOperator(request.Context(), principal.ID); err != nil {
		writeAccessError(writer, request, err)
		return auth.Principal{}, session.Session{}, false
	}
	return principal, appSession, true
}

func writeAccessError(writer http.ResponseWriter, request *http.Request, err error) {
	switch {
	case errors.Is(err, access.ErrAccountSuspended), errors.Is(err, access.ErrAccountNotFound):
		writeError(writer, request, http.StatusForbidden, "ACCOUNT_SUSPENDED", "Akun tidak aktif.")
	case errors.Is(err, access.ErrRoleRequired):
		writeError(writer, request, http.StatusForbidden, "ROLE_REQUIRED", "Akses operator diperlukan.")
	case errors.Is(err, access.ErrEntitlementMissing):
		writeError(writer, request, http.StatusForbidden, "ENTITLEMENT_REQUIRED", "Fitur belum aktif untuk akun ini.")
	default:
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Status akun belum dapat diverifikasi.")
	}
}

func writeSessionError(writer http.ResponseWriter, request *http.Request, err error) {
	switch {
	case errors.Is(err, session.ErrExpired):
		writeError(writer, request, http.StatusForbidden, "SESSION_EXPIRED", "Sesi aplikasi sudah kedaluwarsa.")
	case errors.Is(err, session.ErrRevoked), errors.Is(err, session.ErrInvalid):
		writeError(writer, request, http.StatusForbidden, "SESSION_REVOKED", "Sesi aplikasi tidak aktif.")
	default:
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Sesi belum dapat diverifikasi.")
	}
}

func writeJSONInputError(writer http.ResponseWriter, request *http.Request, err error, invalidMessage string) {
	if errors.Is(err, errJSONBodyTooLarge) {
		writeError(writer, request, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "Body JSON melebihi batas 64 KiB.")
		return
	}
	writeError(writer, request, http.StatusBadRequest, "INVALID_REQUEST", invalidMessage)
}

func (server *Server) allowRate(writer http.ResponseWriter, request *http.Request, operation, userID string) bool {
	allowed, retryAfter := server.limiter.Allow(operation + ":" + userID)
	if allowed {
		return true
	}
	retrySeconds := int64((retryAfter + time.Second - 1) / time.Second)
	if retrySeconds < 1 {
		retrySeconds = 1
	}
	writer.Header().Set("Retry-After", strconv.FormatInt(retrySeconds, 10))
	writeError(writer, request, http.StatusTooManyRequests, "RATE_LIMITED", "Terlalu banyak permintaan; coba lagi nanti.")
	return false
}
