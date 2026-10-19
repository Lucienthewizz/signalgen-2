package apitests

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	screenerapi "github.com/Lucienthewizz/signalgen-2/backend/internal/api/screener"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestScreeningBatchOverWebSocketUsesAuthorizedDataset(t *testing.T) {
	for _, mode := range []string{"three-symbols", "ten-symbols", "eleven-symbols", "unauthorized-symbol", "outside-dates", "expired-snapshot", "version-mismatch", "socket-capacity"} {
		t.Run(mode, func(t *testing.T) {
			manifest := screenerTestManifest()
			manifest.Symbols = []string{"BBCA.JK", "BBRI.JK", "TLKM.JK"}
			if mode == "ten-symbols" || mode == "eleven-symbols" {
				count := 10
				if mode == "eleven-symbols" {
					count = 11
				}
				for i := len(manifest.Symbols); i < count; i++ {
					manifest.Symbols = append(manifest.Symbols, fmt.Sprintf("TEST%d.JK", i))
				}
			}
			datasets := &fakeDatasets{manifest: manifest}
			grants := &fakeCompute{grant: compute.Grant{ID: "cgr-1", Purpose: "screen", RuleID: core.BaselineRuleID,
				DefinitionHash: core.BaselineRuleHash, EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion,
				DatasetID: manifest.DatasetID, DatasetVersion: manifest.Version, DatasetChecksum: manifest.Checksum}}
			server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}},
				&fakeSessions{verified: session.Session{ID: "ses-1", UserID: "user-a"}},
				&fakeAccess{features: []string{access.FeatureScreener}}, datasets, grants)
			if err != nil {
				t.Fatal(err)
			}
			if mode == "version-mismatch" {
				datasets.manifest.Version = "other"
			}
			request := httptest.NewRequest(http.MethodPost, "/api/v1/screener/socket-tickets", strings.NewReader(`{"compute_grant_id":"cgr-1","protocol":"screener-private-1"}`))
			request.Header.Set("Authorization", "Bearer test")
			request.Header.Set("X-App-Session", "test-session")
			response := httptest.NewRecorder()
			server.ServeHTTP(response, request)
			if mode == "version-mismatch" {
				assertErrorCode(t, response, 422, "VERSION_MISMATCH")
				return
			}
			if response.Code != 201 {
				t.Fatalf("ticket status=%d body=%s", response.Code, response.Body.String())
			}
			var ticket struct {
				Token string `json:"ticket"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &ticket); err != nil {
				t.Fatal(err)
			}
			if mode == "expired-snapshot" {
				datasets.err = dataset.ErrNotFound
			}
			if mode == "socket-capacity" {
				for i := 0; i < 2; i++ {
					release, ok := server.SocketLimiter.Acquire("user-a")
					if !ok {
						t.Fatal("reserve capacity")
					}
					defer release()
				}
			}
			httpServer := httptest.NewServer(server)
			defer httpServer.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			connection, upgrade, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(httpServer.URL, "http")+"/api/v1/screener/ws?ticket="+ticket.Token, nil)
			if mode == "socket-capacity" {
				if err == nil || upgrade == nil || upgrade.StatusCode != 429 || upgrade.Header.Get("Retry-After") != "1" {
					t.Fatal("capacity did not reject upgrade safely")
				}
				return
			}
			if mode == "expired-snapshot" {
				if err == nil || upgrade == nil || upgrade.StatusCode != 404 {
					t.Fatalf("expired dataset upgrade=%+v error=%v", upgrade, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer connection.Close(websocket.StatusNormalClosure, "test done")
			candidates := make([]core.FeatureCandidate, 0, 3)
			for _, symbol := range manifest.Symbols {
				candidates = append(candidates, core.FeatureCandidate{Symbol: symbol, Timestamp: "2026-02-07T00:00:00Z", Features: core.FeatureVector{Price: 128, EMA9: 125, EMA20: 121, RSI14: 72}})
			}
			if mode == "unauthorized-symbol" {
				candidates[0].Symbol = "UNAUTHORIZED.JK"
			}
			if mode == "outside-dates" {
				candidates[0].Timestamp = "2025-01-01T00:00:00Z"
			}
			if err := wsjson.Write(ctx, connection, screenerapi.EvaluateMessage{Type: "screener.evaluate", Protocol: core.PrivateProtocol, RequestID: "batch-test", EngineVersion: core.EngineVersion, FeatureSchemaVersion: core.FeatureSchemaVersion, Candidates: candidates}); err != nil {
				t.Fatal(err)
			}
			var result struct {
				Type    string                 `json:"type"`
				Code    string                 `json:"code"`
				Results []screenerapi.Decision `json:"results"`
			}
			if err := wsjson.Read(ctx, connection, &result); err != nil {
				t.Fatal(err)
			}
			if mode != "three-symbols" && mode != "ten-symbols" {
				if result.Type != "screener.error" || result.Code != "INVALID_MESSAGE" {
					t.Fatalf("unexpected result=%+v", result)
				}
				return
			}
			if result.Type != "screener.result" || len(result.Results) != len(manifest.Symbols) {
				t.Fatalf("result=%+v", result)
			}
			for index, decision := range result.Results {
				if decision.Symbol != candidates[index].Symbol || !decision.Matched {
					t.Fatalf("decision=%+v", decision)
				}
			}
		})
	}
}

func TestDatasetCapacityReturnsRetryableServiceError(t *testing.T) {
	server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{verified: session.Session{ID: "ses-1"}},
		&fakeAccess{features: []string{access.FeatureScreener}}, &fakeDatasets{err: dataset.ErrCapacity}, &fakeCompute{})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/datasets/prepare", strings.NewReader(`{"purpose":"screen","rule_id":"default-scalping-v1","universe_id":"univ-a"}`))
	request.Header.Set("Authorization", "Bearer test")
	request.Header.Set("X-App-Session", "test-session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE")
	if response.Header().Get("Retry-After") != "60" {
		t.Fatal("missing retry hint")
	}
}

func TestScreenerWebSocketReturnsCooldownActive(t *testing.T) {
	manifest := dataset.Manifest{
		DatasetID: "dataset-scope", Version: "v1", Checksum: "sha256:111", Purpose: "screen",
		Symbols: []string{"BBCA.JK"}, AvailableRange: dataset.Range{From: "2026-02-01", To: "2026-02-10"},
	}
	datasets := &fakeDatasets{manifest: manifest}
	sessions := &fakeSessions{verified: session.Session{ID: "ses-1"}}
	grants := &fakeCompute{grant: compute.Grant{
		ID: "cgr_cooldown", UserID: "user-a", SessionID: "ses-1", Purpose: "screen",
		DatasetID: manifest.DatasetID, DatasetVersion: manifest.Version, DatasetChecksum: manifest.Checksum,
		RuleID: core.BaselineRuleID, DefinitionHash: core.BaselineRuleHash, EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion,
	}}
	server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions,
		&fakeAccess{features: []string{access.FeatureScreener}}, datasets, grants)
	if err != nil {
		t.Fatal(err)
	}
	ticket, err := server.Tickets.Create(context.Background(), screener.Binding{
		UserID: "user-a", SessionID: "ses-1", ComputeGrantID: "cgr_cooldown", RuleID: core.BaselineRuleID,
		DefinitionHash: core.BaselineRuleHash, SchemaVersion: core.SchemaVersion, EngineVersion: core.EngineVersion,
		FeatureSchema: core.FeatureSchemaVersion,
	})
	if err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	connection, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(httpServer.URL, "http")+"/api/v1/screener/ws?ticket="+ticket.Token, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close(websocket.StatusNormalClosure, "test done")

	candidates := []core.FeatureCandidate{
		// Candidate 1: price 130, ema9 125, ema20 121, rsi14 65 -> matches baseline rule (cooldown 60s)
		{Symbol: "BBCA.JK", Timestamp: "2026-02-07T00:00:00Z", Features: core.FeatureVector{Price: 130, EMA9: 125, EMA20: 121, RSI14: 65}},
		// Candidate 2: 30s later (< 60s cooldown), conditions met -> COOLDOWN_ACTIVE
		{Symbol: "BBCA.JK", Timestamp: "2026-02-07T00:00:30Z", Features: core.FeatureVector{Price: 132, EMA9: 126, EMA20: 121, RSI14: 65}},
		// Candidate 3: conditions not met (price 120 < ema9 126) -> CONDITIONS_NOT_MET
		{Symbol: "BBCA.JK", Timestamp: "2026-02-07T00:00:45Z", Features: core.FeatureVector{Price: 120, EMA9: 126, EMA20: 121, RSI14: 65}},
	}
	if err := wsjson.Write(ctx, connection, screenerapi.EvaluateMessage{
		Type: "screener.evaluate", Protocol: core.PrivateProtocol, RequestID: "cooldown-test",
		EngineVersion: core.EngineVersion, FeatureSchemaVersion: core.FeatureSchemaVersion, Candidates: candidates,
	}); err != nil {
		t.Fatal(err)
	}
	var result struct {
		Type    string                 `json:"type"`
		Results []screenerapi.Decision `json:"results"`
	}
	if err := wsjson.Read(ctx, connection, &result); err != nil {
		t.Fatal(err)
	}
	if result.Type != "screener.result" || len(result.Results) != 3 {
		t.Fatalf("unexpected result: %+v", result)
	}
	// Candidate 1: RULE_MATCHED
	if !result.Results[0].Matched || len(result.Results[0].ReasonCodes) == 0 || result.Results[0].ReasonCodes[0] != "RULE_MATCHED" {
		t.Fatalf("result[0] want RULE_MATCHED, got %+v", result.Results[0])
	}
	// Candidate 2: COOLDOWN_ACTIVE
	if result.Results[1].Matched || len(result.Results[1].ReasonCodes) == 0 || result.Results[1].ReasonCodes[0] != "COOLDOWN_ACTIVE" {
		t.Fatalf("result[1] want COOLDOWN_ACTIVE, got %+v", result.Results[1])
	}
	// Candidate 3: CONDITIONS_NOT_MET
	if result.Results[2].Matched || len(result.Results[2].ReasonCodes) == 0 || result.Results[2].ReasonCodes[0] != "CONDITIONS_NOT_MET" {
		t.Fatalf("result[2] want CONDITIONS_NOT_MET, got %+v", result.Results[2])
	}
}
