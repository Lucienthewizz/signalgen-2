package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	platformws "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/websocket"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
)

const (
	maxScreenerCandidates = 1000
	maxScreenerMessage    = 256 << 10
	screenerSocketTimeout = 10 * time.Second
)

type screenerEvaluateMessage struct {
	Type                 string                  `json:"type"`
	Protocol             string                  `json:"protocol"`
	RequestID            string                  `json:"request_id"`
	EngineVersion        string                  `json:"engine_version"`
	FeatureSchemaVersion string                  `json:"feature_schema_version"`
	Candidates           []core.FeatureCandidate `json:"candidates"`
}

type screenerDecision struct {
	Symbol      string   `json:"symbol"`
	Timestamp   string   `json:"timestamp"`
	Matched     bool     `json:"matched"`
	ReasonCodes []string `json:"reason_codes"`
}

type screenerResultMessage struct {
	Type            string             `json:"type"`
	Protocol        string             `json:"protocol"`
	RequestID       string             `json:"request_id"`
	DecisionVersion string             `json:"decision_version"`
	Results         []screenerDecision `json:"results"`
}

type screenerErrorMessage struct {
	Type      string `json:"type"`
	Protocol  string `json:"protocol"`
	RequestID string `json:"request_id,omitempty"`
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

// createScreenerSocketTicket converts a verified compute grant into a random,
// short-lived, one-use credential suitable for a browser WebSocket URL.
func (server *Server) createScreenerSocketTicket(writer http.ResponseWriter, request *http.Request) {
	principal, appSession, _, ok := server.requireAppSession(writer, request)
	if !ok {
		return
	}
	if !server.allowRate(writer, request, "screener-tickets:create", principal.ID) {
		return
	}
	var input struct {
		ComputeGrantID string `json:"compute_grant_id"`
		Protocol       string `json:"protocol"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeJSONInputError(writer, request, err, "Permintaan socket ticket tidak valid.")
		return
	}
	if input.Protocol != core.PrivateProtocol || strings.TrimSpace(input.ComputeGrantID) == "" {
		writeError(writer, request, http.StatusUnprocessableEntity, "UNSUPPORTED_CAPABILITY", "Protokol private scoring tidak didukung.")
		return
	}
	if err := server.access.RequireFeature(request.Context(), principal.ID, access.FeatureScreener); err != nil {
		writeAccessError(writer, request, err)
		return
	}
	grant, err := server.compute.Verify(request.Context(), principal.ID, appSession.ID, input.ComputeGrantID)
	if err != nil {
		writeComputeGrantError(writer, request, err)
		return
	}
	if grant.Purpose != "screen" || grant.EngineVersion != core.EngineVersion || grant.SchemaVersion != core.SchemaVersion {
		writeError(writer, request, http.StatusUnprocessableEntity, "VERSION_MISMATCH", "Versi compute grant tidak cocok dengan private scoring.")
		return
	}
	created, err := server.tickets.Create(request.Context(), screener.Binding{
		UserID: principal.ID, SessionID: appSession.ID, ComputeGrantID: grant.ID,
		RuleID: grant.RuleID, DefinitionHash: grant.DefinitionHash,
		EngineVersion: grant.EngineVersion, SchemaVersion: grant.SchemaVersion,
		FeatureSchema: core.FeatureSchemaVersion,
	})
	if err != nil {
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Socket ticket belum dapat dibuat.")
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	writeJSON(writer, http.StatusCreated, map[string]interface{}{
		"ticket": created.Token, "expires_at": created.ExpiresAt,
		"websocket_path": "/api/v1/screener/ws", "protocol": core.PrivateProtocol,
		"feature_schema_version": core.FeatureSchemaVersion,
		"max_candidates":         maxScreenerCandidates,
	})
}

// screenerWebSocket consumes the ticket before upgrading, rechecks every
// authorization binding, receives one feature batch, evaluates the private
// rule on the server, writes one result, and closes the connection.
func (server *Server) screenerWebSocket(writer http.ResponseWriter, request *http.Request) {
	binding, err := server.tickets.Consume(request.Context(), request.URL.Query().Get("ticket"))
	if err != nil {
		code := "TICKET_INVALID"
		if errors.Is(err, screener.ErrExpired) {
			code = "TICKET_EXPIRED"
		}
		writeError(writer, request, http.StatusUnauthorized, code, "Socket ticket tidak valid atau sudah kedaluwarsa.")
		return
	}
	if _, err := server.sessions.VerifyByID(request.Context(), binding.UserID, binding.SessionID); err != nil {
		writeSessionError(writer, request, err)
		return
	}
	if _, err := server.access.RequireActive(request.Context(), binding.UserID); err != nil {
		writeAccessError(writer, request, err)
		return
	}
	if err := server.access.RequireFeature(request.Context(), binding.UserID, access.FeatureScreener); err != nil {
		writeAccessError(writer, request, err)
		return
	}
	grant, err := server.compute.Verify(request.Context(), binding.UserID, binding.SessionID, binding.ComputeGrantID)
	if err != nil {
		writeComputeGrantError(writer, request, err)
		return
	}
	if grant.RuleID != binding.RuleID || grant.DefinitionHash != binding.DefinitionHash ||
		grant.EngineVersion != binding.EngineVersion || grant.SchemaVersion != binding.SchemaVersion ||
		binding.FeatureSchema != core.FeatureSchemaVersion {
		writeError(writer, request, http.StatusUnprocessableEntity, "VERSION_MISMATCH", "Binding private scoring tidak cocok.")
		return
	}
	rule, err := server.privateDecisionRule(request.Context(), binding)
	if err != nil {
		writeRuleError(writer, request, err)
		return
	}

	connection, err := platformws.Accept(writer, request, server.originPatterns)
	if err != nil {
		return
	}
	defer connection.CloseCompleted()
	connection.SetReadLimit(maxScreenerMessage)
	ctx, cancel := context.WithTimeout(context.Background(), screenerSocketTimeout)
	defer cancel()

	raw, textMessage := connection.ReadText(ctx)
	if !textMessage {
		writeScreenerSocketError(ctx, connection, "", "INVALID_MESSAGE", "Pesan screener harus berupa JSON text.", false)
		return
	}
	var message screenerEvaluateMessage
	if err := decodeStrictJSON(raw, &message); err != nil {
		writeScreenerSocketError(ctx, connection, "", "INVALID_MESSAGE", "Pesan screener tidak valid.", false)
		return
	}
	if message.Type != "screener.evaluate" || message.Protocol != core.PrivateProtocol ||
		message.EngineVersion != binding.EngineVersion || message.FeatureSchemaVersion != binding.FeatureSchema ||
		strings.TrimSpace(message.RequestID) == "" || len(message.RequestID) > 100 ||
		len(message.Candidates) == 0 || len(message.Candidates) > maxScreenerCandidates {
		writeScreenerSocketError(ctx, connection, message.RequestID, "VERSION_MISMATCH", "Kontrak private scoring tidak cocok.", false)
		return
	}
	decision, err := core.EvaluateDecision(core.DecisionRequest{Rule: rule, Candidates: message.Candidates})
	if err != nil {
		writeScreenerSocketError(ctx, connection, message.RequestID, "INVALID_MESSAGE", "Feature candidate tidak valid.", false)
		return
	}
	matched := make(map[string]struct{}, len(decision.Signals))
	for _, signal := range decision.Signals {
		matched[signal.Symbol+"\x00"+signal.Timestamp] = struct{}{}
	}
	results := make([]screenerDecision, 0, len(message.Candidates))
	for _, candidate := range message.Candidates {
		_, isMatch := matched[candidate.Symbol+"\x00"+candidate.Timestamp]
		reasons := []string{"CONDITIONS_NOT_MET"}
		if isMatch {
			reasons = []string{"RULE_MATCHED"}
		}
		results = append(results, screenerDecision{
			Symbol: candidate.Symbol, Timestamp: candidate.Timestamp,
			Matched: isMatch, ReasonCodes: reasons,
		})
	}
	_ = connection.WriteJSON(ctx, screenerResultMessage{
		Type: "screener.result", Protocol: core.PrivateProtocol,
		RequestID: message.RequestID, DecisionVersion: decision.DecisionVersion,
		Results: results,
	})
}

// privateDecisionRule resolves the exact rule version/hash bound to the ticket.
func (server *Server) privateDecisionRule(ctx context.Context, binding screener.Binding) (core.RuleSnapshot, error) {
	if binding.RuleID == core.BaselineRuleID {
		if binding.DefinitionHash != core.BaselineRuleHash {
			return core.RuleSnapshot{}, rules.ErrNotFound
		}
		definition := core.GetBaselineRuleDefinition()
		return core.RuleSnapshot{
			Name: definition.Name, Logic: definition.Logic, SignalType: definition.SignalType,
			CooldownSec: definition.CooldownSec, Conditions: definition.Conditions,
		}, nil
	}
	rule, err := server.rules.Get(ctx, binding.UserID, binding.RuleID)
	if err != nil {
		return core.RuleSnapshot{}, err
	}
	if rule.DefinitionHash != binding.DefinitionHash || rule.EngineVersion != binding.EngineVersion || rule.SchemaVersion != binding.SchemaVersion {
		return core.RuleSnapshot{}, rules.ErrNotFound
	}
	return rule.Definition, nil
}

func writeComputeGrantError(writer http.ResponseWriter, request *http.Request, err error) {
	switch {
	case errors.Is(err, compute.ErrExpired):
		writeError(writer, request, http.StatusForbidden, "GRANT_EXPIRED", "Compute grant sudah kedaluwarsa.")
	case errors.Is(err, compute.ErrInvalid):
		writeError(writer, request, http.StatusForbidden, "GRANT_INVALID", "Compute grant tidak valid.")
	default:
		writeError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Compute grant belum dapat diverifikasi.")
	}
}

func writeScreenerSocketError(ctx context.Context, connection *platformws.Connection, requestID, code, message string, retryable bool) {
	_ = connection.WriteJSON(ctx, screenerErrorMessage{
		Type: "screener.error", Protocol: core.PrivateProtocol, RequestID: requestID,
		Code: code, Message: message, Retryable: retryable,
	})
	_ = connection.ClosePolicy(code)
}

// decodeStrictJSON rejects unknown fields and multiple JSON values so protocol
// drift or malformed WebSocket messages fail closed.
func decodeStrictJSON(raw []byte, target interface{}) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("multiple JSON values")
	}
	return nil
}
