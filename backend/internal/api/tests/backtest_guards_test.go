package apitests

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/backtest"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

type denyBacktestLimiter struct{}

func (denyBacktestLimiter) Allow(string) (bool, time.Duration) { return false, 3 * time.Second }

func TestBacktestHTTPRechecksIdentitySessionSnapshotAndRateGuards(t *testing.T) {
	raw, err := os.ReadFile("../../../core/testdata/backtest_next_open_v1.json")
	if err != nil {
		t.Fatal(err)
	}
	fixture, err := core.DecodeBacktestRequest(raw)
	if err != nil {
		t.Fatal(err)
	}
	features, err := core.ComputeBacktestFeatures(core.FeatureRequest{Purpose: "backtest", Symbol: "TEST", Candles: fixture.Series[0].Candles})
	if err != nil {
		t.Fatal(err)
	}
	content, _ := json.Marshal(map[string]any{"series": fixture.Series})
	for _, scenario := range []string{"owner", "entitled-foreign-owner", "other-session", "expired-session", "suspended", "missing-snapshot", "changed-checksum", "rate-limit"} {
		t.Run(scenario, func(t *testing.T) {
			manifest := dataset.Manifest{DatasetID: "snapshot", Version: "v1", Purpose: "backtest", Checksum: "sha256:test", Timeframe: "1d", Backtest: &dataset.BacktestScope{Mode: "rule", From: "2026-01-20", To: "2026-01-26", NSteps: 3, RuleID: core.BaselineRuleID}}
			grants := &backtestGrants{owner: "user-a", session: "ses-a", grant: compute.Grant{ID: "grant", Purpose: "backtest", DatasetID: manifest.DatasetID, DatasetVersion: manifest.Version, DatasetChecksum: manifest.Checksum, RuleID: core.BaselineRuleID, DefinitionHash: core.BaselineRuleHash, EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion, ExpiresAt: time.Now().Add(time.Minute)}}
			identity := fakeIdentity{principal: auth.Principal{ID: "user-a"}}
			sessions := &fakeSessions{verified: session.Session{ID: "ses-a"}}
			permissions := &fakeAccess{features: []string{access.FeatureBacktest}}
			datasets := &fakeDatasets{manifest: manifest, content: content}
			var options []api.ServerOption
			wantStatus, wantCode := 200, ""
			switch scenario {
			case "entitled-foreign-owner":
				identity.principal.ID = "user-b"
				wantStatus, wantCode = 403, "GRANT_INVALID"
			case "other-session":
				sessions.verified.ID = "ses-b"
				wantStatus, wantCode = 403, "GRANT_INVALID"
			case "expired-session":
				sessions.verifyError = session.ErrExpired
				wantStatus, wantCode = 403, "SESSION_EXPIRED"
			case "suspended":
				permissions.err = access.ErrAccountSuspended
				wantStatus, wantCode = 403, "ACCOUNT_SUSPENDED"
			case "missing-snapshot":
				datasets.err = dataset.ErrNotFound
				wantStatus, wantCode = 404, "RESOURCE_NOT_FOUND"
			case "changed-checksum":
				datasets.manifest.Checksum = "sha256:changed"
				wantStatus, wantCode = 422, "VERSION_MISMATCH"
			case "rate-limit":
				options = append(options, api.WithRateLimiter(denyBacktestLimiter{}))
				wantStatus, wantCode = 429, "RATE_LIMITED"
			}
			server, err := api.NewServer(identity, sessions, permissions, datasets, grants, options...)
			if err != nil {
				t.Fatal(err)
			}
			response := backtestHTTP(t, server, "POST", "/api/v1/backtests/signals", backtest.SignalInput{ComputeGrantID: "grant", FeatureSchemaVersion: core.FeatureSchemaVersion, PolicyVersion: core.BacktestPolicyVersion, Candidates: features.Candidates})
			if wantStatus == 200 {
				if response.Code != wantStatus {
					t.Fatalf("valid context failed: %d %s", response.Code, response.Body)
				}
			} else {
				assertErrorCode(t, response, wantStatus, wantCode)
			}
			if response.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatal("private analysis response was cacheable")
			}
			if scenario == "rate-limit" && response.Header().Get("Retry-After") != "3" {
				t.Fatal("missing rate-limit retry guidance")
			}
		})
	}
}
