package apitests

import (
	"context"
	"encoding/json"
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
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestScreeningBatchOverWebSocketUsesAuthorizedDataset(t *testing.T) {
	for _, mode := range []string{"three-symbols", "unauthorized-symbol", "outside-dates", "expired-snapshot", "version-mismatch", "socket-capacity"} {
		t.Run(mode, func(t *testing.T) {
			manifest := screenerTestManifest()
			manifest.Symbols = []string{"BBCA.JK", "BBRI.JK", "TLKM.JK"}
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
			if mode != "three-symbols" {
				if result.Type != "screener.error" || result.Code != "INVALID_MESSAGE" {
					t.Fatalf("unexpected result=%+v", result)
				}
				return
			}
			if result.Type != "screener.result" || len(result.Results) != 3 {
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
