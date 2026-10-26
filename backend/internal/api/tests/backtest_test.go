package apitests

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"math"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/backtest"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type backtestUniverse struct{ universe.Repository }

func (backtestUniverse) Instruments(_ context.Context, owner, id string) ([]universe.Instrument, error) {
	if owner != "user-a" || id != "univ-a" {
		return nil, universe.ErrNotFound
	}
	return []universe.Instrument{{Symbol: "TEST", ProviderSymbol: "TEST", Exchange: "XNAS", Currency: "USD"}}, nil
}

type backtestMarket struct{ calls atomic.Int32 }

func (p *backtestMarket) Daily(context.Context, []universe.Instrument, int) ([]marketdata.Series, error) {
	return nil, marketdata.ErrUnavailable
}
func (p *backtestMarket) DailyHistory(_ context.Context, instrument universe.Instrument, from, to time.Time) (marketdata.History, error) {
	p.calls.Add(1)
	series := marketdata.Series{Symbol: instrument.Symbol, Timezone: "UTC", Candles: []core.Candle{}}
	for stamp, i := from, 0; stamp.Before(to); stamp, i = stamp.AddDate(0, 0, 1), i+1 {
		price := 100 + float64(i)
		series.Candles = append(series.Candles, core.Candle{Timestamp: stamp.Format(time.RFC3339), Open: price, High: price + 3, Low: price - 1, Close: price + 1, Volume: 1})
	}
	return marketdata.History{Series: series}, nil
}

type backtestGrants struct {
	grant          compute.Grant
	owner, session string
}

func (s *backtestGrants) Create(_ context.Context, r compute.CreateRequest) (compute.Grant, error) {
	s.owner = r.UserID
	s.session = r.SessionID
	s.grant = compute.Grant{ID: "backtest-grant", Purpose: r.Purpose, DatasetID: r.DatasetID, DatasetVersion: r.DatasetVersion, DatasetChecksum: r.DatasetChecksum, RuleID: r.RuleID, DefinitionHash: r.DefinitionHash, EngineVersion: r.EngineVersion, SchemaVersion: r.SchemaVersion, ExpiresAt: time.Now().Add(time.Minute)}
	return s.grant, nil
}
func (s *backtestGrants) Verify(_ context.Context, owner, sess, id string) (compute.Grant, error) {
	if owner != s.owner || sess != s.session || id != s.grant.ID {
		return compute.Grant{}, compute.ErrInvalid
	}
	if !time.Now().Before(s.grant.ExpiresAt) {
		return compute.Grant{}, compute.ErrExpired
	}
	return s.grant, nil
}

func backtestHTTP(t *testing.T, server *api.Server, method, path string, input any) *httptest.ResponseRecorder {
	t.Helper()
	raw, _ := json.Marshal(input)
	request := httptest.NewRequest(method, path, bytes.NewReader(raw))
	request.Header.Set("Authorization", "Bearer test")
	request.Header.Set("X-App-Session", "test-session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	return response
}

func TestBacktestHTTPRuleAndManualHandoff(t *testing.T) {
	for _, mode := range []string{"rule", "manual"} {
		t.Run(mode, func(t *testing.T) {
			db, e := sql.Open("sqlite", ":memory:")
			if e != nil {
				t.Fatal(e)
			}
			defer db.Close()
			db.SetMaxOpenConns(1)
			accessStore, e := access.NewStore(db)
			if e != nil {
				t.Fatal(e)
			}
			if e = accessStore.Migrate(context.Background()); e != nil {
				t.Fatal(e)
			}
			if _, e = accessStore.EnsureProfile(context.Background(), "user-a", "test@example.com"); e != nil {
				t.Fatal(e)
			}
			ruleStore, e := rules.NewStore(db)
			if e != nil {
				t.Fatal(e)
			}
			if e = ruleStore.Migrate(context.Background()); e != nil {
				t.Fatal(e)
			}
			rule, e := ruleStore.Create(context.Background(), "user-a", core.RuleSnapshot{Name: "Historical test", Logic: "AND", SignalType: "BUY", Conditions: []core.Condition{{Left: "PRICE", Op: ">", Right: 1}}})
			if e != nil {
				t.Fatal(e)
			}
			provider := &backtestMarket{}
			cache, _ := marketdata.NewCachedProvider(provider, marketdata.DefaultCacheOptions())
			snapshots, _ := dataset.NewDynamicStore(cache, backtestUniverse{})
			grants := &backtestGrants{}
			features := &fakeAccess{features: []string{access.FeatureBacktest}}
			sessions := &fakeSessions{verified: session.Session{ID: "ses-a", UserID: "user-a"}}
			server, e := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions, features, snapshots, grants, api.WithRuleStore(ruleStore))
			if e != nil {
				t.Fatal(e)
			}
			input := dataset.PrepareRequest{Purpose: "backtest", Mode: mode, From: "2026-01-20", To: "2026-01-23", NSteps: 2, UniverseID: "univ-a"}
			if mode == "rule" {
				input.RuleID = rule.ID
				input.From = "2024-01-20"
			}
			response := backtestHTTP(t, server, "POST", "/api/v1/datasets/prepare", input)
			if response.Code != 200 {
				t.Fatalf("prepare=%d %s", response.Code, response.Body)
			}
			var manifest dataset.Manifest
			if e := json.Unmarshal(response.Body.Bytes(), &manifest); e != nil {
				t.Fatal(e)
			}
			response = backtestHTTP(t, server, "GET", "/api/v1/datasets/"+manifest.DatasetID+"/content", nil)
			if response.Code != 200 {
				t.Fatal(response.Body.String())
			}
			var payload struct {
				Series []core.BacktestSeries `json:"series"`
			}
			if e := json.Unmarshal(response.Body.Bytes(), &payload); e != nil {
				t.Fatal(e)
			}
			local, e := core.ComputeBacktestFeatures(core.FeatureRequest{Purpose: "backtest", Symbol: "TEST", Candles: payload.Series[0].Candles})
			if e != nil {
				t.Fatal(e)
			}
			entries := []core.BacktestEntry{{Symbol: "TEST", Timestamp: "2026-01-20T00:00:00Z", SignalType: "BUY"}}
			if mode == "rule" {
				response = backtestHTTP(t, server, "POST", "/api/v1/compute-grants", compute.IssueInput{Purpose: "backtest", DatasetID: manifest.DatasetID, DatasetVersion: manifest.Version, DatasetChecksum: manifest.Checksum, RuleID: rule.ID, DefinitionHash: rule.DefinitionHash, EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion})
				if response.Code != 201 {
					t.Fatalf("grant=%d %s", response.Code, response.Body)
				}
				signalInput := backtest.SignalInput{ComputeGrantID: grants.grant.ID, FeatureSchemaVersion: core.FeatureSchemaVersion, PolicyVersion: core.BacktestPolicyVersion, Candidates: local.Candidates}
				encodedInput, _ := json.Marshal(signalInput)
				if len(encodedInput) <= 64<<10 {
					t.Fatal("test must exercise the larger analysis input budget")
				}
				response = backtestHTTP(t, server, "POST", "/api/v1/backtests/signals", signalInput)
				if response.Code != 200 {
					t.Fatalf("signals=%d %s", response.Code, response.Body)
				}
				var result backtest.SignalResult
				if e := json.Unmarshal(response.Body.Bytes(), &result); e != nil {
					t.Fatal(e)
				}
				entries = result.Entries
				if len(entries) != 735 {
					t.Fatalf("entry count=%d", len(entries))
				}
				if response.Header().Get("Cache-Control") != "private, no-store" || response.Header().Get("X-Request-ID") == "" {
					t.Fatal("private response missing metadata")
				}
				grants.grant.ExpiresAt = time.Now().Add(-time.Second)
				response = backtestHTTP(t, server, "POST", "/api/v1/backtests/signals", signalInput)
				assertErrorCode(t, response, 403, "GRANT_EXPIRED")
				grants.grant.ExpiresAt = time.Now().Add(time.Minute)
				features.features = nil
				response = backtestHTTP(t, server, "POST", "/api/v1/backtests/signals", signalInput)
				assertErrorCode(t, response, 403, "ENTITLEMENT_REQUIRED")
				features.features = []string{access.FeatureBacktest}
				sessions.verifyError = session.ErrRevoked
				response = backtestHTTP(t, server, "POST", "/api/v1/backtests/signals", signalInput)
				assertErrorCode(t, response, 403, "SESSION_REVOKED")
				sessions.verifyError = nil
				_, e = ruleStore.Update(context.Background(), "user-a", rule.ID, rule.Version, core.RuleSnapshot{Name: "Changed", Logic: "AND", SignalType: "BUY", Conditions: []core.Condition{{Left: "PRICE", Op: ">", Right: 2000}}})
				if e != nil {
					t.Fatal(e)
				}
				response = backtestHTTP(t, server, "POST", "/api/v1/backtests/signals", signalInput)
				assertErrorCode(t, response, 404, "RESOURCE_NOT_FOUND")
			}
			config := core.DefaultBacktestConfig()
			config.Mode = mode
			config.From = input.From
			config.To = input.To
			config.NSteps = input.NSteps
			result, e := core.RunBacktest(core.BacktestRequest{SchemaVersion: core.BacktestSchemaVersion, Config: config, Series: payload.Series, Entries: entries})
			if e != nil || len(result.Horizons[1].Trades) == 0 || math.IsNaN(result.Horizons[1].Metrics.FinalEquity) {
				t.Fatalf("handoff=%+v %v", result, e)
			}
			// Losing entitlement blocks protected bytes and preparation before provider work.
			features.features = nil
			calls := provider.calls.Load()
			response = backtestHTTP(t, server, "POST", "/api/v1/datasets/prepare", input)
			assertErrorCode(t, response, 403, "ENTITLEMENT_REQUIRED")
			if provider.calls.Load() != calls {
				t.Fatal("denied fetch reached provider")
			}
			response = backtestHTTP(t, server, "GET", "/api/v1/datasets/"+manifest.DatasetID+"/content", nil)
			assertErrorCode(t, response, 403, "ENTITLEMENT_REQUIRED")
		})
	}
}

func TestBacktestSignalsHTTPInputAndAuthLimits(t *testing.T) {
	server := testServer(t, fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{})
	request := httptest.NewRequest("POST", "/api/v1/backtests/signals", strings.NewReader(`{}`))
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, 401, "AUTH_REQUIRED")
	response = backtestHTTP(t, server, "POST", "/api/v1/backtests/signals", map[string]any{"unexpected": true})
	assertErrorCode(t, response, 400, "INVALID_REQUEST")
	response = backtestHTTP(t, server, "POST", "/api/v1/backtests/signals", map[string]any{"compute_grant_id": strings.Repeat("x", 1<<20)})
	assertErrorCode(t, response, 413, "PAYLOAD_TOO_LARGE")
}
