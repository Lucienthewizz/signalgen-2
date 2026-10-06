package systemapi

import (
	"net/http"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

// Capabilities reports the exact protocol and engine versions supported by
// this backend. The frontend checks this before loading WASM so incompatible
// client and server builds fail early instead of producing incorrect signals.
func (server *Handler) Capabilities(writer http.ResponseWriter, request *http.Request) {
	_, _, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}

	writer.Header().Set("Cache-Control", "private, no-store")
	// Portable core still accepts one symbol per invocation. A web screening
	// batch can contain several series, computed separately by the WASM worker.
	// Advertise those different limits explicitly instead of changing the frozen
	// core contract or pretending that backtest/accounting is implemented.
	shared.WriteJSON(writer, http.StatusOK, struct {
		core.Capabilities
		Screening screeningCapabilities `json:"screening"`
	}{core.GetCapabilities(), screeningCapabilities{
		Model: screener.Model, FeatureExecution: "client_wasm",
		DecisionExecution: "server_private", DatasetContent: "series",
		RequiresUniverse: true, MaxSymbols: universe.MaxSymbols,
		MaxCandidates: screener.MaxCandidates, MaxMessageBytes: screener.MaxMessageBytes,
	}})
}

// Deployment-level orchestration is deliberately outside the portable core.
type screeningCapabilities struct {
	Model             string `json:"model"`
	FeatureExecution  string `json:"feature_execution"`
	DecisionExecution string `json:"decision_execution"`
	DatasetContent    string `json:"dataset_content"`
	RequiresUniverse  bool   `json:"requires_universe"`
	MaxSymbols        int    `json:"max_symbols_per_batch"`
	MaxCandidates     int    `json:"max_candidates"`
	MaxMessageBytes   int    `json:"max_message_bytes"`
}
