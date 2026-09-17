package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

const maxJSONBody = 64 << 10

type IdentityVerifier interface {
	Verify(ctx context.Context, accessToken string) (auth.Principal, error)
}

type SessionStore interface {
	Create(ctx context.Context, userID, installationID, label string) (session.Created, error)
	Verify(ctx context.Context, userID, token string) (session.Session, error)
	Revoke(ctx context.Context, userID, token string) error
}

type AccessStore interface {
	EnsureProfile(ctx context.Context, userID, email string) (access.Account, error)
	RequireActive(ctx context.Context, userID string) (access.Account, error)
	Features(ctx context.Context, userID string) ([]string, error)
}

type Server struct {
	identity IdentityVerifier
	sessions SessionStore
	access   AccessStore
	handler  http.Handler
}

func NewServer(identity IdentityVerifier, sessions SessionStore, accessStore AccessStore) (*Server, error) {
	if identity == nil || sessions == nil || accessStore == nil {
		return nil, fmt.Errorf("identity verifier, session store, and access store are required")
	}
	server := &Server{identity: identity, sessions: sessions, access: accessStore}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", server.health)
	mux.HandleFunc("POST /api/v1/sessions", server.createSession)
	mux.HandleFunc("DELETE /api/v1/sessions/current", server.revokeCurrentSession)
	mux.HandleFunc("GET /api/v1/account/me", server.accountMe)
	mux.HandleFunc("GET /api/v1/capabilities", server.capabilities)
	server.handler = requestContext(mux)
	return server, nil
}

func (server *Server) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	server.handler.ServeHTTP(writer, request)
}

func (server *Server) health(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
}

func (server *Server) createSession(writer http.ResponseWriter, request *http.Request) {
	principal, ok := server.requirePrincipal(writer, request)
	if !ok {
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
		writeError(writer, request, http.StatusBadRequest, "INVALID_REQUEST", "Body sesi tidak valid.")
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
	if err != nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Sesi belum dapat dibuat.")
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusCreated, created)
}

func (server *Server) capabilities(writer http.ResponseWriter, request *http.Request) {
	_, _, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}
	capabilities := core.GetCapabilities()
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusOK, capabilities)
}

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

func writeAccessError(writer http.ResponseWriter, request *http.Request, err error) {
	switch {
	case errors.Is(err, access.ErrAccountSuspended), errors.Is(err, access.ErrAccountNotFound):
		writeError(writer, request, http.StatusForbidden, "ACCOUNT_SUSPENDED", "Akun tidak aktif.")
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

func decodeJSON(request *http.Request, target interface{}) error {
	decoder := json.NewDecoder(io.LimitReader(request.Body, maxJSONBody))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("request must contain one JSON object")
	}
	return nil
}

func writeJSON(writer http.ResponseWriter, status int, value interface{}) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func writeError(writer http.ResponseWriter, request *http.Request, status int, code, message string) {
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, status, map[string]interface{}{
		"error": map[string]string{
			"code":       code,
			"message":    message,
			"request_id": requestID(request.Context()),
		},
	})
}

type requestIDKey struct{}

func requestContext(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestID := newRequestID()
		writer.Header().Set("X-Request-ID", requestID)
		next.ServeHTTP(writer, request.WithContext(context.WithValue(request.Context(), requestIDKey{}, requestID)))
	})
}

func requestID(ctx context.Context) string {
	value, _ := ctx.Value(requestIDKey{}).(string)
	return value
}

func newRequestID() string {
	raw := make([]byte, 12)
	if _, err := rand.Read(raw); err != nil {
		return "req_unavailable"
	}
	return "req_" + hex.EncodeToString(raw)
}
