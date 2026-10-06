package screenerapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	platformws "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/websocket"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
)

func (server *Handler) CreateScreenerSocketTicket(writer http.ResponseWriter, request *http.Request) {
	principal, appSession, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	if !server.AllowRate(writer, request, "screener-tickets:create", principal.ID) {
		return
	}
	var input struct {
		ComputeGrantID string `json:"compute_grant_id"`
		Protocol       string `json:"protocol"`
	}
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Permintaan socket ticket tidak valid.")
		return
	}
	if input.Protocol != core.PrivateProtocol || strings.TrimSpace(input.ComputeGrantID) == "" {
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "UNSUPPORTED_CAPABILITY", "Protokol private scoring tidak didukung.")
		return
	}
	if err := server.Access.RequireFeature(request.Context(), principal.ID, access.FeatureScreener); err != nil {
		shared.WriteAccessError(writer, request, err)
		return
	}
	grant, err := server.Compute.Verify(request.Context(), principal.ID, appSession.ID, input.ComputeGrantID)
	if err != nil {
		shared.WriteComputeGrantError(writer, request, err)
		return
	}
	if grant.Purpose != "screen" || grant.EngineVersion != core.EngineVersion || grant.SchemaVersion != core.SchemaVersion {
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "VERSION_MISMATCH", "Versi compute grant tidak cocok dengan private scoring.")
		return
	}
	if _, ok := server.verifiedScreenerDataset(writer, request, principal.ID, grant); !ok {
		return
	}
	created, err := server.Tickets.Create(request.Context(), screener.Binding{
		UserID: principal.ID, SessionID: appSession.ID, ComputeGrantID: grant.ID,
		RuleID: grant.RuleID, DefinitionHash: grant.DefinitionHash,
		EngineVersion: grant.EngineVersion, SchemaVersion: grant.SchemaVersion,
		FeatureSchema: core.FeatureSchemaVersion,
	})
	if err != nil {
		if errors.Is(err, screener.ErrCapacity) {
			writer.Header().Set("Retry-After", "1")
			shared.WriteError(writer, request, http.StatusTooManyRequests, "TICKET_CAPACITY_REACHED", "Batas ticket screening sedang penuh. Coba kembali nanti.")
			return
		}
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Socket ticket belum dapat dibuat.")
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusCreated, map[string]interface{}{
		"ticket": created.Token, "expires_at": created.ExpiresAt,
		"websocket_path": "/api/v1/screener/ws", "protocol": core.PrivateProtocol,
		"feature_schema_version": core.FeatureSchemaVersion,
		"max_candidates":         maxScreenerCandidates,
	})
}

// ScreenerWebSocket consumes the ticket before upgrading, rechecks every
// authorization binding, receives one feature batch, evaluates the private
// rule on the server, writes one result, and closes the connection.
func (server *Handler) ScreenerWebSocket(writer http.ResponseWriter, request *http.Request) {
	binding, err := server.Tickets.Consume(request.Context(), request.URL.Query().Get("ticket"))
	if err != nil {
		code := "TICKET_INVALID"
		if errors.Is(err, screener.ErrExpired) {
			code = "TICKET_EXPIRED"
		}
		shared.WriteError(writer, request, http.StatusUnauthorized, code, "Socket ticket tidak valid atau sudah kedaluwarsa.")
		return
	}
	if _, err := server.Sessions.VerifyByID(request.Context(), binding.UserID, binding.SessionID); err != nil {
		shared.WriteSessionError(writer, request, err)
		return
	}
	if _, err := server.Access.RequireActive(request.Context(), binding.UserID); err != nil {
		shared.WriteAccessError(writer, request, err)
		return
	}
	if err := server.Access.RequireFeature(request.Context(), binding.UserID, access.FeatureScreener); err != nil {
		shared.WriteAccessError(writer, request, err)
		return
	}
	grant, err := server.Compute.Verify(request.Context(), binding.UserID, binding.SessionID, binding.ComputeGrantID)
	if err != nil {
		shared.WriteComputeGrantError(writer, request, err)
		return
	}
	if grant.RuleID != binding.RuleID || grant.DefinitionHash != binding.DefinitionHash ||
		grant.EngineVersion != binding.EngineVersion || grant.SchemaVersion != binding.SchemaVersion ||
		binding.FeatureSchema != core.FeatureSchemaVersion {
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "VERSION_MISMATCH", "Binding private scoring tidak cocok.")
		return
	}
	manifest, ok := server.verifiedScreenerDataset(writer, request, binding.UserID, grant)
	if !ok {
		return
	}
	rule, err := server.screeningAuthorization().ResolveRule(request.Context(), binding)
	if err != nil {
		shared.WriteRuleError(writer, request, err)
		return
	}

	release, admitted := server.SocketLimiter.Acquire(binding.UserID)
	if !admitted {
		writer.Header().Set("Retry-After", "1")
		shared.WriteError(writer, request, http.StatusTooManyRequests, "SOCKET_CAPACITY_REACHED", "Batas koneksi screening sedang penuh. Buat ticket baru dan coba kembali.")
		return
	}
	defer release()
	connection, err := platformws.Accept(writer, request, server.OriginPatterns)
	if err != nil {
		return
	}
	defer connection.CloseCompleted()
	connection.SetReadLimit(maxScreenerMessage)
	ctx, cancel := context.WithTimeout(server.SocketContext, screenerSocketTimeout)
	defer cancel()

	raw, textMessage := connection.ReadText(ctx)
	if !textMessage {
		writeScreenerSocketError(ctx, connection, "", "INVALID_MESSAGE", "Pesan screener harus berupa JSON text.", false)
		return
	}
	var message EvaluateMessage
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
	// Client think-time must not preserve permissions revoked after upgrade.
	rule, manifest, failure := server.screeningAuthorization().RecheckBatch(ctx, binding, grant)
	if failure != nil {
		writeScreenerSocketError(ctx, connection, message.RequestID, failure.Code, "Izin atau konteks screening berubah. Siapkan sesi dan dataset yang valid.", failure.Retryable)
		return
	}
	decision, err := screener.EvaluateBatch(rule, message.Candidates, screener.DatasetScope{
		Symbols: manifest.Symbols, From: manifest.AvailableRange.From, To: manifest.AvailableRange.To,
	})
	if err != nil {
		writeScreenerSocketError(ctx, connection, message.RequestID, "INVALID_MESSAGE", "Feature candidate tidak valid.", false)
		return
	}
	matched := make(map[string]struct{}, len(decision.Signals))
	for _, signal := range decision.Signals {
		matched[signal.Symbol+"\x00"+signal.Timestamp] = struct{}{}
	}
	results := make([]Decision, 0, len(message.Candidates))
	for _, candidate := range message.Candidates {
		_, isMatch := matched[candidate.Symbol+"\x00"+candidate.Timestamp]
		reasons := []string{"CONDITIONS_NOT_MET"}
		if isMatch {
			reasons = []string{"RULE_MATCHED"}
		}
		results = append(results, Decision{
			Symbol: candidate.Symbol, Timestamp: candidate.Timestamp,
			Matched: isMatch, ReasonCodes: reasons,
		})
	}
	_ = connection.WriteJSON(ctx, ResultMessage{
		Type: "screener.result", Protocol: core.PrivateProtocol,
		RequestID: message.RequestID, DecisionVersion: decision.DecisionVersion,
		Results: results,
	})
}

// A persisted compute grant can outlive an in-memory snapshot after restart or
// expiry. Verify the snapshot again at ticket issuance and WebSocket upgrade.
func (server *Handler) verifiedScreenerDataset(writer http.ResponseWriter, request *http.Request, owner string, grant compute.Grant) (dataset.Manifest, bool) {
	manifest, err := server.Datasets.Manifest(request.Context(), owner, grant.DatasetID)
	if errors.Is(err, dataset.ErrNotFound) {
		shared.WriteError(writer, request, http.StatusNotFound, "RESOURCE_NOT_FOUND", "Dataset sudah kedaluwarsa atau tidak ditemukan. Siapkan dataset kembali.")
		return dataset.Manifest{}, false
	}
	if err != nil {
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Dataset belum dapat diverifikasi.")
		return dataset.Manifest{}, false
	}
	if manifest.DatasetID == "" || manifest.DatasetID != grant.DatasetID || manifest.Version != grant.DatasetVersion || manifest.Checksum != grant.DatasetChecksum || manifest.Purpose != grant.Purpose {
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "VERSION_MISMATCH", "Dataset tidak cocok dengan compute grant.")
		return dataset.Manifest{}, false
	}
	return manifest, true
}

func writeScreenerSocketError(ctx context.Context, connection *platformws.Connection, requestID, code, message string, retryable bool) {
	_ = connection.WriteJSON(ctx, ErrorMessage{
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
