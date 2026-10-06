package apitests

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

func TestCapabilitiesRequiresBearerAndMatchingAppSession(t *testing.T) {
	sessions := &fakeSessions{}
	server := testServer(t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions)

	missingBearer := httptest.NewRecorder()
	server.ServeHTTP(missingBearer, httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil))
	assertErrorCode(t, missingBearer, http.StatusUnauthorized, "AUTH_REQUIRED")

	request := httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil)
	request.Header.Set("Authorization", "Bearer user-token")
	request.Header.Set("X-App-Session", "sgs_session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if sessions.verifiedUserID != "user-a" || sessions.verifiedToken != "sgs_session" {
		t.Fatalf("verification = user %q token %q", sessions.verifiedUserID, sessions.verifiedToken)
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["engine_version"] != core.EngineVersion {
		t.Fatalf("engine version = %v", payload["engine_version"])
	}
	var contract struct {
		core.Capabilities
		Screening struct {
			Model             string `json:"model"`
			FeatureExecution  string `json:"feature_execution"`
			DecisionExecution string `json:"decision_execution"`
			DatasetContent    string `json:"dataset_content"`
			RequiresUniverse  bool   `json:"requires_universe"`
			MaxSymbols        int    `json:"max_symbols_per_batch"`
			MaxCandidates     int    `json:"max_candidates"`
			MaxMessageBytes   int    `json:"max_message_bytes"`
		} `json:"screening"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &contract); err != nil {
		t.Fatal(err)
	}
	if contract.MaxSymbolsPerRun != 1 || contract.Screening.Model != screener.Model ||
		contract.Screening.FeatureExecution != "client_wasm" || contract.Screening.DecisionExecution != "server_private" ||
		contract.Screening.DatasetContent != "series" || !contract.Screening.RequiresUniverse ||
		contract.Screening.MaxSymbols != universe.MaxSymbols || contract.Screening.MaxCandidates != screener.MaxCandidates ||
		contract.Screening.MaxMessageBytes != screener.MaxMessageBytes {
		t.Fatalf("incorrect Model A discovery contract: %+v", contract)
	}
	if len(contract.Purposes) != 1 || contract.Purposes[0] != "screen" {
		t.Fatal("capabilities must not advertise undefined backtest/P&L behavior")
	}
}

func TestCapabilitiesRejectsExpiredSession(t *testing.T) {
	sessions := &fakeSessions{verifyError: session.ErrExpired}
	server := testServer(t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil)
	request.Header.Set("Authorization", "Bearer user-token")
	request.Header.Set("X-App-Session", "sgs_expired")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusForbidden, "SESSION_EXPIRED")
}
