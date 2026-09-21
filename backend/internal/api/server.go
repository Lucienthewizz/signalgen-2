package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

const maxJSONBody = 64 << 10

var errJSONBodyTooLarge = errors.New("JSON body exceeds limit")

type IdentityVerifier interface {
	Verify(ctx context.Context, accessToken string) (auth.Principal, error)
}

type SessionStore interface {
	Create(ctx context.Context, userID, installationID, label string) (session.Created, error)
	Verify(ctx context.Context, userID, token string) (session.Session, error)
	Revoke(ctx context.Context, userID, token string) error
	List(ctx context.Context, userID string) ([]session.Session, error)
	RevokeByID(ctx context.Context, userID, sessionID string) error
	ActiveLimit() int
}

type AccessStore interface {
	EnsureProfile(ctx context.Context, userID, email string) (access.Account, error)
	RequireActive(ctx context.Context, userID string) (access.Account, error)
	RequireOperator(ctx context.Context, userID string) (access.Account, error)
	Features(ctx context.Context, userID string) ([]string, error)
	FeatureGrants(ctx context.Context, userID string) ([]access.FeatureGrant, error)
	RequireFeature(ctx context.Context, userID, feature string) error
	GrantFeatureAudited(ctx context.Context, actor, requestID, userID, feature string, validUntil time.Time, reason string) (access.FeatureGrant, error)
	RevokeFeatureAudited(ctx context.Context, actor, requestID, userID, feature, reason string) error
	SetRoleAudited(ctx context.Context, actor, requestID, userID, role, reason string) (access.AccountRole, error)
}

type DatasetStore interface {
	Prepare(request dataset.PrepareRequest) (dataset.Manifest, error)
	Manifest(id string) (dataset.Manifest, error)
	Content(id string) ([]byte, dataset.Manifest, error)
}

type ComputeStore interface {
	Create(ctx context.Context, request compute.CreateRequest) (compute.Grant, error)
}

type RuleStore interface {
	List(ctx context.Context, ownerUserID string) ([]rules.Rule, error)
	Get(ctx context.Context, ownerUserID, id string) (rules.Rule, error)
	Create(ctx context.Context, ownerUserID string, definition core.RuleSnapshot) (rules.Rule, error)
	Update(ctx context.Context, ownerUserID, id string, expectedVersion int, definition core.RuleSnapshot) (rules.Rule, error)
	Delete(ctx context.Context, ownerUserID, id string, expectedVersion int) error
}

var errRuleStoreUnavailable = errors.New("user rule store is unavailable")

type noUserRuleStore struct{}

func (noUserRuleStore) List(context.Context, string) ([]rules.Rule, error) {
	return []rules.Rule{}, nil
}
func (noUserRuleStore) Get(context.Context, string, string) (rules.Rule, error) {
	return rules.Rule{}, rules.ErrNotFound
}
func (noUserRuleStore) Create(context.Context, string, core.RuleSnapshot) (rules.Rule, error) {
	return rules.Rule{}, errRuleStoreUnavailable
}
func (noUserRuleStore) Update(context.Context, string, string, int, core.RuleSnapshot) (rules.Rule, error) {
	return rules.Rule{}, errRuleStoreUnavailable
}
func (noUserRuleStore) Delete(context.Context, string, string, int) error {
	return errRuleStoreUnavailable
}

type ReadinessChecker interface {
	Ready(ctx context.Context) error
}

type Server struct {
	identity IdentityVerifier
	sessions SessionStore
	access   AccessStore
	datasets DatasetStore
	compute  ComputeStore
	rules    RuleStore
	handler  http.Handler
}

type systemRuleResource struct {
	ID             string                      `json:"id"`
	Name           string                      `json:"name"`
	OwnerType      string                      `json:"owner_type"`
	ReadOnly       bool                        `json:"read_only"`
	Definition     core.BaselineRuleDefinition `json:"definition"`
	DefinitionHash string                      `json:"definition_hash"`
	SchemaVersion  string                      `json:"schema_version"`
	EngineVersion  string                      `json:"engine_version"`
	Version        int                         `json:"version"`
}

type serverConfig struct {
	allowedOrigins  map[string]struct{}
	readinessChecks []ReadinessChecker
	ruleStore       RuleStore
}

func WithReadinessChecks(checkers ...ReadinessChecker) ServerOption {
	return func(config *serverConfig) error {
		for _, checker := range checkers {
			if checker == nil {
				return fmt.Errorf("readiness checker is required")
			}
			config.readinessChecks = append(config.readinessChecks, checker)
		}
		return nil
	}
}

func WithRuleStore(store RuleStore) ServerOption {
	return func(config *serverConfig) error {
		if store == nil {
			return fmt.Errorf("rule store is required")
		}
		config.ruleStore = store
		return nil
	}
}

type ServerOption func(*serverConfig) error

// WithCORSOrigins enables browser access only for the exact HTTP(S) origins provided.
// An empty list keeps cross-origin browser access disabled.
func WithCORSOrigins(origins []string) ServerOption {
	return func(config *serverConfig) error {
		for _, rawOrigin := range origins {
			origin := strings.TrimSpace(rawOrigin)
			if origin == "" {
				continue
			}
			parsed, err := url.Parse(origin)
			if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
				return fmt.Errorf("invalid CORS origin %q", rawOrigin)
			}
			config.allowedOrigins[origin] = struct{}{}
		}
		return nil
	}
}

func NewServer(identity IdentityVerifier, sessions SessionStore, accessStore AccessStore, datasets DatasetStore, computeStore ComputeStore, options ...ServerOption) (*Server, error) {
	if identity == nil || sessions == nil || accessStore == nil || datasets == nil || computeStore == nil {
		return nil, fmt.Errorf("identity verifier, session store, access store, dataset store, and compute store are required")
	}
	config := serverConfig{allowedOrigins: make(map[string]struct{})}
	for _, option := range options {
		if option == nil {
			continue
		}
		if err := option(&config); err != nil {
			return nil, err
		}
	}
	if config.ruleStore == nil {
		config.ruleStore = noUserRuleStore{}
	}
	server := &Server{
		identity: identity, sessions: sessions, access: accessStore,
		datasets: datasets, compute: computeStore, rules: config.ruleStore,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", server.health)
	mux.HandleFunc("GET /ready", server.ready(config.readinessChecks))
	mux.HandleFunc("POST /api/v1/sessions", server.createSession)
	mux.HandleFunc("DELETE /api/v1/sessions/current", server.revokeCurrentSession)
	mux.HandleFunc("GET /api/v1/account/me", server.accountMe)
	mux.HandleFunc("GET /api/v1/account/sessions", server.accountSessions)
	mux.HandleFunc("DELETE /api/v1/account/sessions/{id}", server.revokeAccountSession)
	mux.HandleFunc("GET /api/v1/capabilities", server.capabilities)
	mux.HandleFunc("GET /api/v1/rules", server.listRules)
	mux.HandleFunc("POST /api/v1/rules", server.createRule)
	mux.HandleFunc("GET /api/v1/rules/{id}", server.getRule)
	mux.HandleFunc("PATCH /api/v1/rules/{id}", server.updateRule)
	mux.HandleFunc("DELETE /api/v1/rules/{id}", server.deleteRule)
	mux.HandleFunc("POST /api/v1/datasets/prepare", server.prepareDataset)
	mux.HandleFunc("GET /api/v1/datasets/{id}/manifest", server.datasetManifest)
	mux.HandleFunc("GET /api/v1/datasets/{id}/content", server.datasetContent)
	mux.HandleFunc("POST /api/v1/compute-grants", server.createComputeGrant)
	mux.HandleFunc("GET /api/v1/operator/grants", server.listOperatorGrants)
	mux.HandleFunc("POST /api/v1/operator/grants", server.createOperatorGrant)
	mux.HandleFunc("DELETE /api/v1/operator/grants/{user_id}/{feature}", server.revokeOperatorGrant)
	mux.HandleFunc("PATCH /api/v1/operator/accounts/{user_id}/role", server.changeOperatorAccountRole)
	server.handler = requestContext(corsAllowlist(mux, config.allowedOrigins))
	return server, nil
}

func (server *Server) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	server.handler.ServeHTTP(writer, request)
}

func (server *Server) health(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
}

func (server *Server) ready(checkers []ReadinessChecker) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		ctx, cancel := context.WithTimeout(request.Context(), 2*time.Second)
		defer cancel()
		for _, checker := range checkers {
			if err := checker.Ready(ctx); err != nil {
				writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Service belum siap.")
				return
			}
		}
		writeJSON(writer, http.StatusOK, map[string]string{"status": "ready"})
	}
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

func (server *Server) listRules(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}
	if err := server.access.RequireFeature(request.Context(), principal.ID, access.FeatureScreener); err != nil {
		writeAccessError(writer, request, err)
		return
	}
	userRules, err := server.rules.List(request.Context(), principal.ID)
	if err != nil {
		writeRuleError(writer, request, err)
		return
	}
	items := make([]interface{}, 0, len(userRules)+1)
	items = append(items, baselineRuleResource())
	for _, rule := range userRules {
		items = append(items, rule)
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusOK, map[string]interface{}{"items": items, "next_cursor": nil})
}

func (server *Server) getRule(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}
	if err := server.access.RequireFeature(request.Context(), principal.ID, access.FeatureScreener); err != nil {
		writeAccessError(writer, request, err)
		return
	}
	if request.PathValue("id") == core.BaselineRuleID {
		writer.Header().Set("Cache-Control", "private, no-store")
		writeJSON(writer, http.StatusOK, baselineRuleResource())
		return
	}
	rule, err := server.rules.Get(request.Context(), principal.ID, request.PathValue("id"))
	if err != nil {
		writeRuleError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusOK, rule)
}

func (server *Server) createRule(writer http.ResponseWriter, request *http.Request) {
	principal, ok := server.requireRuleAccess(writer, request)
	if !ok {
		return
	}
	var input struct {
		Definition core.RuleSnapshot `json:"definition"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeJSONInputError(writer, request, err, "Body rule tidak valid.")
		return
	}
	rule, err := server.rules.Create(request.Context(), principal.ID, input.Definition)
	if err != nil {
		writeRuleError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusCreated, rule)
}

func (server *Server) updateRule(writer http.ResponseWriter, request *http.Request) {
	principal, ok := server.requireRuleAccess(writer, request)
	if !ok {
		return
	}
	if request.PathValue("id") == core.BaselineRuleID {
		writeError(writer, request, http.StatusConflict, "RULE_READ_ONLY", "Rule bawaan tidak dapat diubah.")
		return
	}
	var input struct {
		Version    int               `json:"version"`
		Definition core.RuleSnapshot `json:"definition"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeJSONInputError(writer, request, err, "Body rule tidak valid.")
		return
	}
	rule, err := server.rules.Update(
		request.Context(), principal.ID, request.PathValue("id"), input.Version, input.Definition,
	)
	if err != nil {
		writeRuleError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusOK, rule)
}

func (server *Server) deleteRule(writer http.ResponseWriter, request *http.Request) {
	principal, ok := server.requireRuleAccess(writer, request)
	if !ok {
		return
	}
	if request.PathValue("id") == core.BaselineRuleID {
		writeError(writer, request, http.StatusConflict, "RULE_READ_ONLY", "Rule bawaan tidak dapat dihapus.")
		return
	}
	var input struct {
		Version int `json:"version"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeJSONInputError(writer, request, err, "Versi rule wajib diisi.")
		return
	}
	if err := server.rules.Delete(request.Context(), principal.ID, request.PathValue("id"), input.Version); err != nil {
		writeRuleError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writer.WriteHeader(http.StatusNoContent)
}

func (server *Server) requireRuleAccess(writer http.ResponseWriter, request *http.Request) (auth.Principal, bool) {
	principal, _, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return auth.Principal{}, false
	}
	if err := server.access.RequireFeature(request.Context(), principal.ID, access.FeatureScreener); err != nil {
		writeAccessError(writer, request, err)
		return auth.Principal{}, false
	}
	return principal, true
}

func writeRuleError(writer http.ResponseWriter, request *http.Request, err error) {
	switch {
	case errors.Is(err, rules.ErrNotFound):
		writeError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Rule tidak ditemukan.")
	case errors.Is(err, rules.ErrInvalid):
		writeError(writer, request, http.StatusUnprocessableEntity, "INVALID_RULE", "Definisi rule tidak didukung.")
	case errors.Is(err, rules.ErrVersionConflict):
		writeError(writer, request, http.StatusConflict, "VERSION_CONFLICT", "Rule sudah berubah; muat ulang versi terbaru.")
	case errors.Is(err, rules.ErrLimit):
		writeError(writer, request, http.StatusConflict, "RULE_LIMIT_REACHED", "Batas 100 rule per akun sudah tercapai.")
	default:
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Rule belum dapat diproses.")
	}
}

func baselineRuleResource() systemRuleResource {
	definition := core.GetBaselineRuleDefinition()
	return systemRuleResource{
		ID: core.BaselineRuleID, Name: definition.Name, OwnerType: "system", ReadOnly: true,
		Definition: definition, DefinitionHash: core.BaselineRuleHash,
		SchemaVersion: core.SchemaVersion, EngineVersion: core.EngineVersion, Version: 1,
	}
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
	})
}

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

func (server *Server) prepareDataset(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}
	var input dataset.PrepareRequest
	if err := decodeJSON(request, &input); err != nil {
		writeJSONInputError(writer, request, err, "Permintaan dataset tidak valid.")
		return
	}
	feature, ok := featureForPurpose(input.Purpose)
	if !ok {
		writeError(writer, request, http.StatusUnprocessableEntity, "UNSUPPORTED_CAPABILITY", "Purpose dataset belum didukung.")
		return
	}
	if err := server.access.RequireFeature(request.Context(), principal.ID, feature); err != nil {
		writeAccessError(writer, request, err)
		return
	}
	manifest, err := server.datasets.Prepare(input)
	if errors.Is(err, dataset.ErrInvalidRequest) {
		writeError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Market, simbol, timeframe, atau rentang dataset tidak didukung.")
		return
	}
	if err != nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Dataset belum dapat disiapkan.")
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusOK, manifest)
}

func (server *Server) datasetManifest(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}
	manifest, err := server.datasets.Manifest(request.PathValue("id"))
	if errors.Is(err, dataset.ErrNotFound) {
		writeError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Dataset tidak ditemukan.")
		return
	}
	if err != nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Manifest dataset belum dapat dibaca.")
		return
	}
	if err := server.requireDatasetFeature(request, principal.ID, manifest); err != nil {
		writeAccessError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusOK, manifest)
}

func (server *Server) datasetContent(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}
	content, manifest, err := server.datasets.Content(request.PathValue("id"))
	if errors.Is(err, dataset.ErrNotFound) {
		writeError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Dataset tidak ditemukan.")
		return
	}
	if err != nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Konten dataset belum dapat dibaca.")
		return
	}
	if err := server.requireDatasetFeature(request, principal.ID, manifest); err != nil {
		writeAccessError(writer, request, err)
		return
	}
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.Header().Set("Cache-Control", "private, no-store")
	writer.Header().Set("ETag", `"`+manifest.Checksum+`"`)
	writer.WriteHeader(http.StatusOK)
	_, _ = writer.Write(content)
}

func (server *Server) createComputeGrant(writer http.ResponseWriter, request *http.Request) {
	principal, appSession, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}
	var input struct {
		Purpose         string `json:"purpose"`
		DatasetID       string `json:"dataset_id"`
		DatasetVersion  string `json:"dataset_version"`
		DatasetChecksum string `json:"dataset_checksum"`
		RuleID          string `json:"rule_id"`
		DefinitionHash  string `json:"definition_hash"`
		EngineVersion   string `json:"engine_version"`
		SchemaVersion   string `json:"schema_version"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeJSONInputError(writer, request, err, "Permintaan compute grant tidak valid.")
		return
	}
	feature, supported := featureForPurpose(input.Purpose)
	if !supported {
		writeError(writer, request, http.StatusUnprocessableEntity, "UNSUPPORTED_CAPABILITY", "Purpose compute belum didukung.")
		return
	}
	if err := server.access.RequireFeature(request.Context(), principal.ID, feature); err != nil {
		writeAccessError(writer, request, err)
		return
	}
	manifest, err := server.datasets.Manifest(input.DatasetID)
	if errors.Is(err, dataset.ErrNotFound) {
		writeError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Dataset tidak ditemukan.")
		return
	}
	if err != nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Dataset belum dapat diverifikasi.")
		return
	}
	expectedRuleHash := core.BaselineRuleHash
	if input.RuleID != core.BaselineRuleID {
		rule, err := server.rules.Get(request.Context(), principal.ID, input.RuleID)
		if err != nil {
			writeRuleError(writer, request, err)
			return
		}
		expectedRuleHash = rule.DefinitionHash
	}
	if input.Purpose != manifest.Purpose || input.DatasetVersion != manifest.Version ||
		input.DatasetChecksum != manifest.Checksum || input.DefinitionHash != expectedRuleHash ||
		input.EngineVersion != core.EngineVersion || input.SchemaVersion != core.SchemaVersion {
		writeError(writer, request, http.StatusUnprocessableEntity, "UNSUPPORTED_CAPABILITY", "Versi dataset, rule, atau engine tidak cocok.")
		return
	}
	grant, err := server.compute.Create(request.Context(), compute.CreateRequest{
		UserID: principal.ID, SessionID: appSession.ID, Purpose: input.Purpose,
		DatasetID: input.DatasetID, DatasetVersion: input.DatasetVersion, DatasetChecksum: input.DatasetChecksum,
		RuleID: input.RuleID, DefinitionHash: input.DefinitionHash,
		EngineVersion: input.EngineVersion, SchemaVersion: input.SchemaVersion,
	})
	if errors.Is(err, compute.ErrInvalid) {
		writeError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Binding compute grant tidak valid.")
		return
	}
	if err != nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Compute grant belum dapat dibuat.")
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusCreated, grant)
}

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

func (server *Server) createOperatorGrant(writer http.ResponseWriter, request *http.Request) {
	principal, _, ok := server.requireOperator(writer, request)
	if !ok {
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

func (server *Server) revokeOperatorGrant(writer http.ResponseWriter, request *http.Request) {
	principal, _, ok := server.requireOperator(writer, request)
	if !ok {
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

func (server *Server) changeOperatorAccountRole(writer http.ResponseWriter, request *http.Request) {
	principal, _, ok := server.requireOperator(writer, request)
	if !ok {
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

func (server *Server) requireDatasetFeature(request *http.Request, userID string, manifest dataset.Manifest) error {
	feature, ok := featureForPurpose(manifest.Purpose)
	if !ok {
		return access.ErrEntitlementMissing
	}
	return server.access.RequireFeature(request.Context(), userID, feature)
}

func featureForPurpose(purpose string) (string, bool) {
	switch purpose {
	case "screen":
		return access.FeatureScreener, true
	case "backtest":
		return access.FeatureBacktest, true
	default:
		return "", false
	}
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

// requireOperator is the single guard for future operator routes. It requires
// both the normal bearer/app-session chain and an active server-side operator
// role. No public operator route is registered yet.
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

func decodeJSON(request *http.Request, target interface{}) error {
	raw, err := io.ReadAll(io.LimitReader(request.Body, maxJSONBody+1))
	if err != nil {
		return err
	}
	if len(raw) > maxJSONBody {
		return errJSONBodyTooLarge
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("request must contain one JSON object")
	}
	return nil
}

func writeJSONInputError(writer http.ResponseWriter, request *http.Request, err error, invalidMessage string) {
	if errors.Is(err, errJSONBodyTooLarge) {
		writeError(writer, request, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "Body JSON melebihi batas 64 KiB.")
		return
	}
	writeError(writer, request, http.StatusBadRequest, "INVALID_REQUEST", invalidMessage)
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

func corsAllowlist(next http.Handler, allowedOrigins map[string]struct{}) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		origin := request.Header.Get("Origin")
		if origin == "" {
			next.ServeHTTP(writer, request)
			return
		}
		writer.Header().Add("Vary", "Origin")
		if _, allowed := allowedOrigins[origin]; !allowed {
			if request.Method == http.MethodOptions {
				writeError(writer, request, http.StatusForbidden, "ORIGIN_NOT_ALLOWED", "Origin browser tidak diizinkan.")
				return
			}
			next.ServeHTTP(writer, request)
			return
		}

		writer.Header().Set("Access-Control-Allow-Origin", origin)
		if request.Method != http.MethodOptions {
			next.ServeHTTP(writer, request)
			return
		}
		writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		writer.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-App-Session")
		writer.Header().Set("Access-Control-Max-Age", "600")
		writer.WriteHeader(http.StatusNoContent)
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
