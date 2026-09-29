package api

import (
	"errors"
	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"net/http"
)

// File ini berisi HTTP handler untuk rule milik pengguna.
// Handler hanya menerjemahkan HTTP; validasi dan penyimpanan rule tetap
// didelegasikan ke core dan RuleStore.

// listRules returns the read-only baseline plus rules owned by this user.
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

// getRule prevents cross-user access by always querying with principal.ID.
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

// createRule validates entitlement and stores a new owner-scoped rule.
func (server *Server) createRule(writer http.ResponseWriter, request *http.Request) {
	principal, ok := server.requireRuleAccess(writer, request)
	if !ok {
		return
	}
	if !server.allowRate(writer, request, "rules:write", principal.ID) {
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

// updateRule uses optimistic versioning so concurrent edits cannot overwrite
// one another silently.
func (server *Server) updateRule(writer http.ResponseWriter, request *http.Request) {
	principal, ok := server.requireRuleAccess(writer, request)
	if !ok {
		return
	}
	if !server.allowRate(writer, request, "rules:write", principal.ID) {
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

// deleteRule removes an owned custom rule but never the baseline system rule.
func (server *Server) deleteRule(writer http.ResponseWriter, request *http.Request) {
	principal, ok := server.requireRuleAccess(writer, request)
	if !ok {
		return
	}
	if !server.allowRate(writer, request, "rules:write", principal.ID) {
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

// requireRuleAccess composes app-session and screener-entitlement checks.
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
		DefinitionHash: core.BaselineRuleHash,
		SchemaVersion:  core.SchemaVersion, EngineVersion: core.EngineVersion, Version: 1,
	}
}
