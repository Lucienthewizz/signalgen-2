package apitests

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	screenerapi "github.com/Lucienthewizz/signalgen-2/backend/internal/api/screener"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestHybridScreenerTicketAndWebSocketLifecycle(t *testing.T) {
	sessions := &fakeSessions{verified: session.Session{ID: "ses-1", UserID: "user-a"}}
	computeStore := &fakeCompute{grant: compute.Grant{
		ID: "cgr-1", Purpose: "screen", RuleID: core.BaselineRuleID,
		DefinitionHash: core.BaselineRuleHash, EngineVersion: core.EngineVersion,
		SchemaVersion: core.SchemaVersion,
		DatasetID:     "ds-test", DatasetVersion: "v1", DatasetChecksum: "sha256:test",
	}}
	server, err := api.NewServer(
		fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions,
		&fakeAccess{features: []string{access.FeatureScreener}},
		&fakeDatasets{manifest: screenerTestManifest()}, computeStore,
	)
	if err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()

	ticketRequest, _ := http.NewRequest(
		http.MethodPost, httpServer.URL+"/api/v1/screener/socket-tickets",
		strings.NewReader(`{"compute_grant_id":"cgr-1","protocol":"screener-private-1"}`),
	)
	ticketRequest.Header.Set("Authorization", "Bearer user-token")
	ticketRequest.Header.Set("X-App-Session", "sgs_session")
	ticketResponse, err := http.DefaultClient.Do(ticketRequest)
	if err != nil {
		t.Fatal(err)
	}
	defer ticketResponse.Body.Close()
	if ticketResponse.StatusCode != http.StatusCreated {
		raw, _ := io.ReadAll(ticketResponse.Body)
		t.Fatalf("ticket status = %d, body = %s", ticketResponse.StatusCode, raw)
	}
	var ticket struct {
		Token         string `json:"ticket"`
		WebSocketPath string `json:"websocket_path"`
		Protocol      string `json:"protocol"`
	}
	if err := json.NewDecoder(ticketResponse.Body).Decode(&ticket); err != nil {
		t.Fatal(err)
	}
	if ticket.Token == "" || ticket.WebSocketPath != "/api/v1/screener/ws" || ticket.Protocol != core.PrivateProtocol {
		t.Fatalf("ticket = %+v", ticket)
	}

	websocketURL := "ws" + strings.TrimPrefix(httpServer.URL, "http") + ticket.WebSocketPath + "?ticket=" + ticket.Token
	connection, response, err := websocket.Dial(context.Background(), websocketURL, nil)
	if err != nil {
		if response != nil {
			t.Fatalf("websocket status = %d, error = %v", response.StatusCode, err)
		}
		t.Fatal(err)
	}
	requestID := "scr_test_request"
	err = wsjson.Write(context.Background(), connection, screenerapi.EvaluateMessage{
		Type: "screener.evaluate", Protocol: core.PrivateProtocol, RequestID: requestID,
		EngineVersion: core.EngineVersion, FeatureSchemaVersion: core.FeatureSchemaVersion,
		Candidates: []core.FeatureCandidate{{
			Symbol: "BBCA.JK", Timestamp: "2026-02-07T00:00:00Z",
			Features: core.FeatureVector{Price: 128, EMA9: 125, EMA20: 121, RSI14: 72},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	var result screenerapi.ResultMessage
	if err := wsjson.Read(context.Background(), connection, &result); err != nil {
		t.Fatal(err)
	}
	_ = connection.Close(websocket.StatusNormalClosure, "test complete")
	if result.RequestID != requestID || result.DecisionVersion != core.DecisionVersion ||
		len(result.Results) != 1 || !result.Results[0].Matched {
		t.Fatalf("result = %+v", result)
	}

	_, replayResponse, replayErr := websocket.Dial(context.Background(), websocketURL, nil)
	if replayErr == nil || replayResponse == nil || replayResponse.StatusCode != http.StatusUnauthorized {
		t.Fatalf("replay response = %+v, error = %v", replayResponse, replayErr)
	}
}

func TestScreenerWebSocketRechecksRevokedSession(t *testing.T) {
	sessions := &fakeSessions{verified: session.Session{ID: "ses-1", UserID: "user-a"}}
	computeStore := &fakeCompute{grant: compute.Grant{
		ID: "cgr-1", Purpose: "screen", RuleID: core.BaselineRuleID,
		DefinitionHash: core.BaselineRuleHash, EngineVersion: core.EngineVersion,
		SchemaVersion: core.SchemaVersion,
		DatasetID:     "ds-test", DatasetVersion: "v1", DatasetChecksum: "sha256:test",
	}}
	server, err := api.NewServer(
		fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions,
		&fakeAccess{features: []string{access.FeatureScreener}},
		&fakeDatasets{manifest: screenerTestManifest()}, computeStore,
	)
	if err != nil {
		t.Fatal(err)
	}
	ticketRequest := httptest.NewRequest(http.MethodPost, "/api/v1/screener/socket-tickets",
		strings.NewReader(`{"compute_grant_id":"cgr-1","protocol":"screener-private-1"}`))
	ticketRequest.Header.Set("Authorization", "Bearer user-token")
	ticketRequest.Header.Set("X-App-Session", "sgs_session")
	ticketResponse := httptest.NewRecorder()
	server.ServeHTTP(ticketResponse, ticketRequest)
	if ticketResponse.Code != http.StatusCreated {
		t.Fatalf("ticket status = %d, body = %s", ticketResponse.Code, ticketResponse.Body.String())
	}
	var ticket struct {
		Token string `json:"ticket"`
	}
	_ = json.Unmarshal(ticketResponse.Body.Bytes(), &ticket)
	sessions.verifyError = session.ErrRevoked
	request := httptest.NewRequest(http.MethodGet, "/api/v1/screener/ws?ticket="+ticket.Token, nil)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusForbidden, "SESSION_REVOKED")
}
