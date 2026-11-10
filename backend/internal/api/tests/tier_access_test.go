package apitests

import (
	"context"
	"encoding/json"
	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	screenerapi "github.com/Lucienthewizz/signalgen-2/backend/internal/api/screener"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/subscription"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type effectiveAccessFixture struct {
	mu sync.RWMutex
	fakeAccess
	policy subscription.EffectiveAccess
}

func (f *effectiveAccessFixture) EffectiveAccess(context.Context, string) (subscription.EffectiveAccess, error) {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.policy, nil
}
func (f *effectiveAccessFixture) RequireFeature(_ context.Context, _ string, feature string) error {
	a, _ := f.EffectiveAccess(context.Background(), "")
	return a.RequireFeature(feature)
}

func (f *effectiveAccessFixture) setPolicy(a subscription.EffectiveAccess) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.policy = a
}

func TestFreeHTTPAndSocketRecheckOldGrants(t *testing.T) {
	for _, stage := range []string{"ticket", "upgrade", "batch"} {
		for _, mode := range []string{"fourth", "intraday", "private"} {
			t.Run(stage+"/"+mode, func(t *testing.T) {
				manifest := screenerTestManifest()
				manifest.Timeframe = "1d"
				manifest.Symbols = []string{"BBCA.JK"}
				rule := core.BaselineRuleID
				if mode == "fourth" {
					manifest.Symbols = []string{"BBCA.JK", "BBRI.JK", "TLKM.JK", "ASII.JK"}
				}
				if mode == "intraday" {
					manifest.Timeframe = "5m"
				}
				if mode == "private" {
					rule = "owned-rule"
				}
				expectedCode := "PLAN_LIMIT_EXCEEDED"
				if mode == "private" {
					expectedCode = "FEATURE_NOT_INCLUDED"
				}
				grant := compute.Grant{ID: "grant", Purpose: "screen", RuleID: rule, DefinitionHash: core.BaselineRuleHash, EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion, DatasetID: manifest.DatasetID, DatasetVersion: manifest.Version, DatasetChecksum: manifest.Checksum}
				access := &effectiveAccessFixture{policy: subscription.ResolveAccess("pro", nil)}
				server, e := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{verified: session.Session{ID: "ses-1", UserID: "user-a"}}, access, &fakeDatasets{manifest: manifest}, &fakeCompute{grant: grant}, api.WithRuleStore(validationRuleStore{rule: rules.Rule{ID: rule, OwnerUserID: "user-a", EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion, DefinitionHash: core.BaselineRuleHash, Definition: core.RuleSnapshot{Name: "fixture", Logic: "AND", SignalType: "BUY", Conditions: []core.Condition{{Left: "PRICE", Op: ">", Right: 1.0}}}}}))
				if e != nil {
					t.Fatal(e)
				}
				if stage == "ticket" {
					access.setPolicy(subscription.ResolveAccess("free", nil))
				}
				req := httptest.NewRequest("POST", "/api/v1/screener/socket-tickets", strings.NewReader(`{"compute_grant_id":"grant","protocol":"screener-private-1"}`))
				req.Header.Set("Authorization", "Bearer test")
				req.Header.Set("X-App-Session", "session")
				res := httptest.NewRecorder()
				server.ServeHTTP(res, req)
				if stage == "ticket" {
					assertErrorCode(t, res, 403, expectedCode)
					return
				}
				if res.Code != 201 {
					t.Fatalf("ticket %d: %s", res.Code, res.Body.String())
				}
				var ticket struct {
					Token string `json:"ticket"`
				}
				json.Unmarshal(res.Body.Bytes(), &ticket)
				if stage == "upgrade" {
					access.setPolicy(subscription.ResolveAccess("free", nil))
				}
				httpServer := httptest.NewServer(server)
				defer httpServer.Close()
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				defer cancel()
				conn, response, e := websocket.Dial(ctx, "ws"+strings.TrimPrefix(httpServer.URL, "http")+"/api/v1/screener/ws?ticket="+ticket.Token, nil)
				if stage == "upgrade" {
					if e == nil || response == nil || response.StatusCode != 403 {
						t.Fatal("downgrade allowed websocket upgrade")
					}
					return
				}
				if e != nil {
					t.Fatal(e)
				}
				defer conn.CloseNow()
				// State change happens after the connection is established. Authorization
				// is re-evaluated for the message, not frozen in its old ticket/grant.
				access.setPolicy(subscription.ResolveAccess("free", nil))
				msg := screenerapi.EvaluateMessage{Type: "screener.evaluate", Protocol: core.PrivateProtocol, RequestID: "tier", EngineVersion: core.EngineVersion, FeatureSchemaVersion: core.FeatureSchemaVersion, Candidates: []core.FeatureCandidate{{Symbol: manifest.Symbols[0], Timestamp: "2026-02-07T00:00:00Z", Features: core.FeatureVector{Price: 128, EMA9: 125, EMA20: 121, RSI14: 72}}}}
				if e = wsjson.Write(ctx, conn, msg); e != nil {
					t.Fatal(e)
				}
				var result struct{ Type, Code string }
				if e = wsjson.Read(ctx, conn, &result); e != nil {
					t.Fatal(e)
				}
				if result.Type != "screener.error" || result.Code != expectedCode {
					t.Fatalf("batch after downgrade: %+v", result)
				}
			})
		}
	}
}
func TestAccountMeReportsFreeAccessWithoutPaidSubscription(t *testing.T) {
	access := &effectiveAccessFixture{policy: subscription.ResolveAccess("free", nil)}
	server, e := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{}, access, &fakeDatasets{}, &fakeCompute{})
	if e != nil {
		t.Fatal(e)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/account/me", nil)
	req.Header.Set("Authorization", "Bearer test")
	req.Header.Set("X-App-Session", "session")
	res := httptest.NewRecorder()
	server.ServeHTTP(res, req)
	if res.Code != 200 {
		t.Fatal(res.Body.String())
	}
	var body struct {
		Access   subscription.EffectiveAccess `json:"access"`
		Features []string                     `json:"features"`
	}
	if e = json.Unmarshal(res.Body.Bytes(), &body); e != nil {
		t.Fatal(e)
	}
	if body.Access.PlanCode != "free" || body.Access.Screening.MaxSymbols != 3 || len(body.Features) != 1 || body.Features[0] != "screener" {
		t.Fatalf("new account not usable: %+v", body)
	}
}
