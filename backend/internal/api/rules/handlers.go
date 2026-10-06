package rulesapi

import (
	"net/http"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
)

// ListRules returns the read-only baseline plus rules owned by this user.
func (server *Handler) ListRules(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	if err := server.Access.RequireFeature(request.Context(), principal.ID, access.FeatureScreener); err != nil {
		shared.WriteAccessError(writer, request, err)
		return
	}
	userRules, err := server.Rules.List(request.Context(), principal.ID)
	if err != nil {
		shared.WriteRuleError(writer, request, err)
		return
	}
	items := make([]interface{}, 0, len(userRules)+1)
	items = append(items, baselineRuleResource())
	for _, rule := range userRules {
		items = append(items, rule)
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusOK, map[string]interface{}{"items": items, "next_cursor": nil})
}

// GetRule prevents cross-user access by always querying with principal.ID.
func (server *Handler) GetRule(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	if err := server.Access.RequireFeature(request.Context(), principal.ID, access.FeatureScreener); err != nil {
		shared.WriteAccessError(writer, request, err)
		return
	}
	if request.PathValue("id") == core.BaselineRuleID {
		writer.Header().Set("Cache-Control", "private, no-store")
		shared.WriteJSON(writer, http.StatusOK, baselineRuleResource())
		return
	}
	rule, err := server.Rules.Get(request.Context(), principal.ID, request.PathValue("id"))
	if err != nil {
		shared.WriteRuleError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusOK, rule)
}

// CreateRule validates entitlement and stores a new owner-scoped rule.
func (server *Handler) CreateRule(writer http.ResponseWriter, request *http.Request) {
	principal, ok := server.requireRuleAccess(writer, request)
	if !ok {
		return
	}
	if !server.AllowRate(writer, request, "rules:write", principal.ID) {
		return
	}
	var input struct {
		Definition core.RuleSnapshot `json:"definition"`
	}
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Body rule tidak valid.")
		return
	}
	rule, err := server.Rules.Create(request.Context(), principal.ID, input.Definition)
	if err != nil {
		shared.WriteRuleError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusCreated, rule)
}

// UpdateRule uses optimistic versioning so concurrent edits cannot overwrite
// one another silently.
func (server *Handler) UpdateRule(writer http.ResponseWriter, request *http.Request) {
	principal, ok := server.requireRuleAccess(writer, request)
	if !ok {
		return
	}
	if !server.AllowRate(writer, request, "rules:write", principal.ID) {
		return
	}
	if request.PathValue("id") == core.BaselineRuleID {
		shared.WriteError(writer, request, http.StatusConflict, "RULE_READ_ONLY", "Rule bawaan tidak dapat diubah.")
		return
	}
	var input struct {
		Version    int               `json:"version"`
		Definition core.RuleSnapshot `json:"definition"`
	}
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Body rule tidak valid.")
		return
	}
	rule, err := server.Rules.Update(
		request.Context(), principal.ID, request.PathValue("id"), input.Version, input.Definition,
	)
	if err != nil {
		shared.WriteRuleError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusOK, rule)
}

// DeleteRule removes an owned custom rule but never the baseline system rule.
func (server *Handler) DeleteRule(writer http.ResponseWriter, request *http.Request) {
	principal, ok := server.requireRuleAccess(writer, request)
	if !ok {
		return
	}
	if !server.AllowRate(writer, request, "rules:write", principal.ID) {
		return
	}
	if request.PathValue("id") == core.BaselineRuleID {
		shared.WriteError(writer, request, http.StatusConflict, "RULE_READ_ONLY", "Rule bawaan tidak dapat dihapus.")
		return
	}
	var input struct {
		Version int `json:"version"`
	}
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Versi rule wajib diisi.")
		return
	}
	if err := server.Rules.Delete(request.Context(), principal.ID, request.PathValue("id"), input.Version); err != nil {
		shared.WriteRuleError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writer.WriteHeader(http.StatusNoContent)
}

// requireRuleAccess composes app-session and screener-entitlement checks.
func (server *Handler) requireRuleAccess(writer http.ResponseWriter, request *http.Request) (auth.Principal, bool) {
	principal, _, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return auth.Principal{}, false
	}
	if err := server.Access.RequireFeature(request.Context(), principal.ID, access.FeatureScreener); err != nil {
		shared.WriteAccessError(writer, request, err)
		return auth.Principal{}, false
	}
	return principal, true
}

func baselineRuleResource() systemRuleResource {
	definition := core.GetBaselineRuleDefinition()
	return systemRuleResource{
		ID: core.BaselineRuleID, Name: definition.Name, OwnerType: "system", ReadOnly: true,
		DefinitionHash: core.BaselineRuleHash,
		SchemaVersion:  core.SchemaVersion, EngineVersion: core.EngineVersion, Version: 1,
	}
}
