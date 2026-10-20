package apitests

import (
	"context"
	"encoding/json"
	"fmt"
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
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/coder/websocket"
	"github.com/santhosh-tekuri/jsonschema/v6"
)

type validationRuleStore struct {
	rules.Repository
	rule rules.Rule
}

func TestDecisionSchemaRejectsMissingOrSpuriousSignalDirection(t *testing.T) {
	compiler := jsonschema.NewCompiler()
	schema, err := compiler.Compile("../../../contracts/hybrid-screener.schema.json#/$defs/decision")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		matched   bool
		direction string
		valid     bool
	}{
		{true, "BUY", true}, {true, "SELL", true}, {false, "", true},
		{true, "", false}, {true, "HOLD", false}, {false, "BUY", false},
	} {
		instance := map[string]any{"symbol": "BBCA.JK", "timestamp": "2026-02-07T00:00:00Z", "matched": tc.matched, "reason_codes": []any{"RULE_MATCHED"}}
		if tc.direction != "" {
			instance["signal_type"] = tc.direction
		}
		if valid := schema.Validate(instance) == nil; valid != tc.valid {
			t.Fatalf("matched=%v direction=%q schema valid=%v", tc.matched, tc.direction, valid)
		}
	}
}

func (store validationRuleStore) Get(_ context.Context, owner, id string) (rules.Rule, error) {
	if owner != store.rule.OwnerUserID || id != store.rule.ID {
		return rules.Rule{}, rules.ErrNotFound
	}
	return store.rule, nil
}

// Exercise the real wire boundary, not just structs with every field already set.
// Missing/null RSI must never become an apparently valid oversold BUY signal.
func TestScreenerRequiresCompleteNumericFeaturesAndMatchesJSONSchema(t *testing.T) {
	compiler := jsonschema.NewCompiler()
	compiler.AssertFormat()
	schema, err := compiler.Compile("../../../contracts/hybrid-screener.schema.json")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, features, direction string
		invalid, matched          bool
	}{
		{name: "no-match", features: `{"price":128,"ema9":125,"ema20":121,"rsi14":40}`, direction: "BUY"},
		{name: "zero-is-valid", features: `{"price":128,"ema9":125,"ema20":121,"rsi14":0}`, direction: "BUY", matched: true},
		{name: "sell", features: `{"price":128,"ema9":125,"ema20":121,"rsi14":10}`, direction: "SELL", matched: true},
		{name: "missing-rsi", features: `{"price":128,"ema9":125,"ema20":121}`, direction: "BUY", invalid: true},
		{name: "null-rsi", features: `{"price":128,"ema9":125,"ema20":121,"rsi14":null}`, direction: "BUY", invalid: true},
		{name: "null-price", features: `{"price":null,"ema9":125,"ema20":121,"rsi14":10}`, direction: "BUY", invalid: true},
		{name: "missing-ema9", features: `{"price":128,"ema20":121,"rsi14":10}`, direction: "BUY", invalid: true},
		{name: "missing-ema20", features: `{"price":128,"ema9":125,"rsi14":10}`, direction: "BUY", invalid: true},
		{name: "null-features", features: `null`, direction: "BUY", invalid: true},
		{name: "wrong-type", features: `{"price":128,"ema9":125,"ema20":121,"rsi14":"10"}`, direction: "BUY", invalid: true},
		{name: "unknown-field", features: `{"price":128,"ema9":125,"ema20":121,"rsi14":10,"extra":1}`, direction: "BUY", invalid: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			manifest := screenerTestManifest()
			rule := rules.Rule{ID: "rule-validation", OwnerUserID: "user-a", DefinitionHash: "sha256:validation", EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion,
				Definition: core.RuleSnapshot{Name: "RSI below 30", Logic: "AND", SignalType: tc.direction, Conditions: []core.Condition{{Left: "RSI14", Op: "<", Right: 30}}}}
			grant := compute.Grant{ID: "cgr-validation", Purpose: "screen", RuleID: rule.ID, DefinitionHash: rule.DefinitionHash,
				EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion, DatasetID: manifest.DatasetID, DatasetVersion: manifest.Version, DatasetChecksum: manifest.Checksum}
			server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{verified: session.Session{ID: "ses-1", UserID: "user-a"}},
				&fakeAccess{features: []string{access.FeatureScreener}}, &fakeDatasets{manifest: manifest}, &fakeCompute{grant: grant}, api.WithRuleStore(validationRuleStore{rule: rule}))
			if err != nil {
				t.Fatal(err)
			}
			created, err := server.Tickets.Create(context.Background(), screener.Binding{UserID: "user-a", SessionID: "ses-1", ComputeGrantID: grant.ID, RuleID: rule.ID,
				DefinitionHash: rule.DefinitionHash, EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion, FeatureSchema: core.FeatureSchemaVersion})
			if err != nil {
				t.Fatal(err)
			}
			httpServer := httptest.NewServer(server)
			defer httpServer.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(httpServer.URL, "http")+"/api/v1/screener/ws?ticket="+created.Token, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer conn.CloseNow()
			payload := fmt.Sprintf(`{"type":"screener.evaluate","protocol":"%s","request_id":"validation","engine_version":"%s","feature_schema_version":"%s","candidates":[{"symbol":"BBCA.JK","timestamp":"2026-02-07T00:00:00Z","features":%s}]}`, core.PrivateProtocol, core.EngineVersion, core.FeatureSchemaVersion, tc.features)
			if err := conn.Write(ctx, websocket.MessageText, []byte(payload)); err != nil {
				t.Fatal(err)
			}
			_, raw, err := conn.Read(ctx)
			if err != nil {
				t.Fatal(err)
			}
			var response struct {
				Type    string                 `json:"type"`
				Code    string                 `json:"code"`
				Results []screenerapi.Decision `json:"results"`
			}
			if err := json.Unmarshal(raw, &response); err != nil {
				t.Fatal(err)
			}
			if tc.invalid {
				if response.Type != "screener.error" || response.Code != "INVALID_MESSAGE" || len(response.Results) != 0 {
					t.Fatalf("incomplete input was evaluated: %s", raw)
				}
			} else {
				if response.Type != "screener.result" || len(response.Results) != 1 || response.Results[0].Matched != tc.matched {
					t.Fatalf("unexpected result: %s", raw)
				}
				wantDirection := ""
				if tc.matched {
					wantDirection = tc.direction
				}
				if response.Results[0].SignalType != wantDirection {
					t.Fatalf("incorrect signal direction: %s", raw)
				}
			}
			var instance any
			if err := json.Unmarshal(raw, &instance); err != nil {
				t.Fatal(err)
			}
			if err := schema.Validate(instance); err != nil {
				t.Fatalf("actual WebSocket response violates published schema: %v\n%s", err, raw)
			}
		})
	}
}
