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
	platformhttp "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/http"
	platformws "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/websocket"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

// ScreenerWebSocket mengonsumsi satu socket ticket, memverifikasi ulang otorisasi dan sesi pengguna,
// menerima satu batch kandidat fitur dari client/WASM, menulis satu keputusan evaluasi privat, lalu menutup koneksi.
func (server *Handler) ScreenerWebSocket(writer http.ResponseWriter, request *http.Request) {
	trace := newEvaluationTrace(server.ScreeningObserver, platformhttp.RequestID(request.Context()))
	defer trace.finish()
	binding, err := server.Tickets.Consume(request.Context(), request.URL.Query().Get("ticket"))
	if err != nil {
		outcome := screener.OutcomeRejected
		if !errors.Is(err, screener.ErrInvalid) && !errors.Is(err, screener.ErrExpired) {
			outcome = screener.OutcomeUnavailable
		}
		trace.transportFailure(request.Context(), outcome)
		code := "TICKET_INVALID"
		if errors.Is(err, screener.ErrExpired) {
			code = "TICKET_EXPIRED"
		}
		shared.WriteError(writer, request, http.StatusUnauthorized, code, "Socket ticket tidak valid atau sudah kedaluwarsa.")
		return
	}
	if _, err := server.Sessions.VerifyByID(request.Context(), binding.UserID, binding.SessionID); err != nil {
		trace.fail(authorizationOutcome(err))
		shared.WriteSessionError(writer, request, err)
		return
	}
	if _, err := server.Access.RequireActive(request.Context(), binding.UserID); err != nil {
		trace.fail(authorizationOutcome(err))
		shared.WriteAccessError(writer, request, err)
		return
	}
	if err := server.Access.RequireFeature(request.Context(), binding.UserID, access.FeatureScreener); err != nil {
		trace.fail(authorizationOutcome(err))
		shared.WriteAccessError(writer, request, err)
		return
	}
	grant, err := server.Compute.Verify(request.Context(), binding.UserID, binding.SessionID, binding.ComputeGrantID)
	if err != nil {
		trace.fail(authorizationOutcome(err))
		shared.WriteComputeGrantError(writer, request, err)
		return
	}
	if grant.RuleID != binding.RuleID || grant.DefinitionHash != binding.DefinitionHash ||
		grant.EngineVersion != binding.EngineVersion || grant.SchemaVersion != binding.SchemaVersion ||
		binding.FeatureSchema != core.FeatureSchemaVersion {
		trace.fail(screener.OutcomeRejected)
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "VERSION_MISMATCH", "Binding private scoring tidak cocok.")
		return
	}
	manifest, ok, outcome := server.verifiedScreenerDataset(writer, request, binding.UserID, grant)
	if !ok {
		trace.fail(outcome)
		return
	}
	rule, err := server.screeningAuthorization().ResolveRule(request.Context(), binding)
	if err != nil {
		trace.fail(authorizationOutcome(err))
		shared.WriteRuleError(writer, request, err)
		return
	}
	release, admitted := server.SocketLimiter.Acquire(binding.UserID)
	if !admitted {
		trace.fail(screener.OutcomeCapacity)
		writer.Header().Set("Retry-After", "1")
		shared.WriteError(writer, request, http.StatusTooManyRequests, "SOCKET_CAPACITY_REACHED", "Batas koneksi screening sedang penuh. Buat ticket baru dan coba kembali.")
		return
	}
	defer release()
	trace.begin(screener.StageUpgrade)
	connection, err := platformws.Accept(writer, request, server.OriginPatterns)
	if err != nil {
		trace.fail(screener.OutcomeUpgrade)
		return
	}
	trace.event.Upgraded = true
	defer trace.closeCompleted(connection)
	connection.SetReadLimit(maxScreenerMessage)
	ctx, cancel := context.WithTimeout(server.SocketContext, screenerSocketTimeout)
	defer cancel()

	trace.begin(screener.StageRead)
	raw, err := connection.ReadTextMessage(ctx)
	if err != nil {
		if errors.Is(err, platformws.ErrNonTextMessage) || errors.Is(err, platformws.ErrMessageTooLarge) {
			trace.fail(screener.OutcomeInvalid)
		} else {
			trace.transportFailure(ctx, screener.OutcomeRead)
		}
		writeObservedSocketError(trace, ctx, connection, "", "INVALID_MESSAGE", "Pesan screener harus berupa JSON text.", false)
		return
	}
	trace.event.ReceivedBytes = len(raw)
	trace.begin(screener.StageValidate)
	var message EvaluateMessage
	if err := decodeStrictJSON(raw, &message); err != nil {
		trace.fail(screener.OutcomeInvalid)
		writeObservedSocketError(trace, ctx, connection, "", "INVALID_MESSAGE", "Pesan screener tidak valid.", false)
		return
	}
	if message.Type != "screener.evaluate" || message.Protocol != core.PrivateProtocol ||
		message.EngineVersion != binding.EngineVersion || message.FeatureSchemaVersion != binding.FeatureSchema ||
		strings.TrimSpace(message.RequestID) == "" || len(message.RequestID) > 100 ||
		len(message.Candidates) == 0 || len(message.Candidates) > maxScreenerCandidates {
		trace.fail(screener.OutcomeInvalid)
		writeObservedSocketError(trace, ctx, connection, message.RequestID, "VERSION_MISMATCH", "Kontrak private scoring tidak cocok.", false)
		return
	}
	// Hitung kandidat yang sesuai kontrak, bukan komputasi mentah client.
	trace.event.Candidates = len(message.Candidates)
	trace.begin(screener.StageRecheck)
	rule, manifest, failure := server.screeningAuthorization().RecheckBatch(ctx, binding, grant)
	if failure != nil {
		outcome := screener.OutcomeRejected
		if failure.Retryable {
			outcome = screener.OutcomeUnavailable
		}
		trace.transportFailure(ctx, outcome)
		writeObservedSocketError(trace, ctx, connection, message.RequestID, failure.Code, "Izin atau konteks screening berubah. Siapkan sesi dan dataset yang valid.", failure.Retryable)
		return
	}
	trace.begin(screener.StageEvaluate)
	decision, err := screener.EvaluateBatch(rule, message.Candidates, screener.DatasetScope{
		Symbols: manifest.Symbols, From: manifest.AvailableRange.From, To: manifest.AvailableRange.To,
	})
	if err != nil {
		trace.fail(screener.OutcomeInvalid)
		writeObservedSocketError(trace, ctx, connection, message.RequestID, "INVALID_MESSAGE", "Feature candidate tidak valid.", false)
		return
	}
	// Petakan hasil evaluasi ke map untuk menjaga urutan kandidat sama persis dengan yang dikirim client
	evalMap := make(map[string]core.CandidateEvaluation, len(decision.Evaluations))
	for _, eval := range decision.Evaluations {
		evalMap[eval.Symbol+"\x00"+eval.Timestamp] = eval
	}
	results := make([]Decision, 0, len(message.Candidates))
	for _, candidate := range message.Candidates {
		key := candidate.Symbol + "\x00" + candidate.Timestamp
		if eval, ok := evalMap[key]; ok {
			results = append(results, Decision{
				Symbol:      candidate.Symbol,
				Timestamp:   candidate.Timestamp,
				Matched:     eval.Matched,
				SignalType:  eval.SignalType,
				ReasonCodes: eval.ReasonCodes,
			})
		} else {
			results = append(results, Decision{
				Symbol:      candidate.Symbol,
				Timestamp:   candidate.Timestamp,
				Matched:     false,
				ReasonCodes: []string{"CONDITIONS_NOT_MET"},
			})
		}
	}
	if !trace.writeResult(ctx, connection, ResultMessage{
		Type: "screener.result", Protocol: core.PrivateProtocol, RequestID: message.RequestID,
		DecisionVersion: decision.DecisionVersion, Results: results,
	}) {
		return
	}
}

func authorizationOutcome(err error) screener.Outcome {
	if errors.Is(err, session.ErrInvalid) || errors.Is(err, session.ErrRevoked) || errors.Is(err, session.ErrExpired) ||
		errors.Is(err, access.ErrAccountNotFound) || errors.Is(err, access.ErrAccountSuspended) ||
		errors.Is(err, access.ErrEntitlementMissing) || errors.Is(err, compute.ErrInvalid) ||
		errors.Is(err, compute.ErrExpired) || errors.Is(err, rules.ErrNotFound) {
		return screener.OutcomeRejected
	}
	return screener.OutcomeUnavailable
}

// writeObservedSocketError menulis balasan error JSON sesuai protokol screener dan menutup koneksi dengan rapi.
func writeObservedSocketError(trace *evaluationTrace, ctx context.Context, connection *platformws.Connection, requestID, code, message string, retryable bool) {
	trace.begin(screener.StageWrite)
	err := connection.WriteJSON(ctx, ErrorMessage{
		Type: "screener.error", Protocol: core.PrivateProtocol, RequestID: requestID,
		Code: code, Message: message, Retryable: retryable,
	})
	trace.event.ReplyWritten = err == nil
	trace.begin(screener.StageClose)
	_ = connection.ClosePolicy(code)
}

// decodeStrictJSON mem-parsing JSON secara ketat: menolak atribut tak dikenal dan mencegah multiple JSON values.
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
