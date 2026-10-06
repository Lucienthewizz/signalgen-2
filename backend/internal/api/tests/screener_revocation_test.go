package apitests

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"sync/atomic"
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

// Atomic phase changes happen only after the HTTP upgrade has succeeded.
// This avoids data races while simulating a revoke during client think-time.
type phaseSessions struct {
	*fakeSessions
	phase   *atomic.Bool
	failure error
}

func (s *phaseSessions) VerifyByID(ctx context.Context, u, id string) (session.Session, error) {
	if s.phase.Load() && s.failure != nil {
		return session.Session{}, s.failure
	}
	return s.fakeSessions.VerifyByID(ctx, u, id)
}

type phaseAccess struct {
	*fakeAccess
	phase       *atomic.Bool
	failure     error
	entitlement bool
}

func (s *phaseAccess) RequireActive(ctx context.Context, u string) (access.Account, error) {
	if s.phase.Load() && s.failure != nil && !s.entitlement {
		return access.Account{}, s.failure
	}
	return s.fakeAccess.RequireActive(ctx, u)
}

func (s *phaseAccess) RequireFeature(ctx context.Context, u, f string) error {
	if s.phase.Load() && s.failure != nil && s.entitlement {
		return s.failure
	}
	return s.fakeAccess.RequireFeature(ctx, u, f)
}

type phaseCompute struct {
	*fakeCompute
	phase    *atomic.Bool
	failure  error
	mismatch bool
}

func (s *phaseCompute) Verify(ctx context.Context, u, id, g string) (compute.Grant, error) {
	if s.phase.Load() && s.failure != nil {
		return compute.Grant{}, s.failure
	}
	item, err := s.fakeCompute.Verify(ctx, u, id, g)
	if s.phase.Load() && s.mismatch {
		item.DatasetVersion = "changed-after-upgrade"
	}
	return item, err
}

type phaseDatasets struct {
	*fakeDatasets
	phase   *atomic.Bool
	failure error
}

func (s *phaseDatasets) Manifest(ctx context.Context, u, id string) (dataset.Manifest, error) {
	if s.phase.Load() && s.failure != nil {
		return dataset.Manifest{}, s.failure
	}
	return s.fakeDatasets.Manifest(ctx, u, id)
}

func TestScreenerRechecksAccessAfterUpgrade(t *testing.T) {
	for _, tc := range []struct {
		mode, code string
		retryable  bool
	}{
		{"session-revoked", "SESSION_REVOKED", false},
		{"session-expired", "SESSION_EXPIRED", false},
		{"account-suspended", "ACCOUNT_SUSPENDED", false},
		{"entitlement-revoked", "ENTITLEMENT_REQUIRED", false},
		{"grant-expired", "GRANT_EXPIRED", false},
		{"grant-invalid", "GRANT_INVALID", false},
		{"binding-changed", "VERSION_MISMATCH", false},
		{"dataset-expired", "RESOURCE_NOT_FOUND", false},
		{"database-unavailable", "SERVICE_UNAVAILABLE", true},
		{"shutdown", "", false},
	} {
		t.Run(tc.mode, func(t *testing.T) {
			phase := &atomic.Bool{}
			manifest := screenerTestManifest()
			sessions := &phaseSessions{fakeSessions: &fakeSessions{verified: session.Session{ID: "ses-1", UserID: "user-a"}}, phase: phase}
			accounts := &phaseAccess{fakeAccess: &fakeAccess{features: []string{access.FeatureScreener}}, phase: phase}
			grants := &phaseCompute{fakeCompute: &fakeCompute{grant: compute.Grant{
				ID: "cgr-1", Purpose: "screen", RuleID: core.BaselineRuleID, DefinitionHash: core.BaselineRuleHash,
				EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion,
				DatasetID: manifest.DatasetID, DatasetVersion: manifest.Version, DatasetChecksum: manifest.Checksum}}, phase: phase}
			datasets := &phaseDatasets{fakeDatasets: &fakeDatasets{manifest: manifest}, phase: phase}
			switch tc.mode {
			case "session-revoked":
				sessions.failure = session.ErrRevoked
			case "session-expired":
				sessions.failure = session.ErrExpired
			case "account-suspended":
				accounts.failure = access.ErrAccountSuspended
			case "entitlement-revoked":
				accounts.failure = access.ErrEntitlementMissing
				accounts.entitlement = true
			case "grant-expired":
				grants.failure = compute.ErrExpired
			case "grant-invalid":
				grants.failure = compute.ErrInvalid
			case "binding-changed":
				grants.mismatch = true
			case "dataset-expired":
				datasets.failure = dataset.ErrNotFound
			case "database-unavailable":
				sessions.failure = errors.New("private database details")
			}
			lifetime, shutdown := context.WithCancel(context.Background())
			defer shutdown()
			server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions, accounts, datasets, grants, api.WithSocketContext(lifetime))
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest("POST", "/api/v1/screener/socket-tickets", strings.NewReader(`{"compute_grant_id":"cgr-1","protocol":"screener-private-1"}`))
			req.Header.Set("Authorization", "Bearer identity")
			req.Header.Set("X-App-Session", "app")
			res := httptest.NewRecorder()
			server.ServeHTTP(res, req)
			if res.Code != 201 {
				t.Fatalf("ticket=%d", res.Code)
			}
			var ticket struct {
				Token string `json:"ticket"`
			}
			if json.Unmarshal(res.Body.Bytes(), &ticket) != nil {
				t.Fatal("invalid ticket")
			}
			httpServer := httptest.NewServer(server)
			defer httpServer.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(httpServer.URL, "http")+"/api/v1/screener/ws?ticket="+ticket.Token, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer conn.CloseNow()
			phase.Store(true)
			if tc.mode == "shutdown" {
				shutdown()
				var value any
				if wsjson.Read(ctx, conn, &value) == nil {
					t.Fatal("shutdown returned a scoring result")
				}
				return
			}
			message := screenerapi.EvaluateMessage{Type: "screener.evaluate", Protocol: core.PrivateProtocol, RequestID: "recheck-test",
				EngineVersion: core.EngineVersion, FeatureSchemaVersion: core.FeatureSchemaVersion,
				Candidates: []core.FeatureCandidate{{Symbol: "BBCA.JK", Timestamp: "2026-02-07T00:00:00Z",
					Features: core.FeatureVector{Price: 128, EMA9: 125, EMA20: 121, RSI14: 72}}}}
			if wsjson.Write(ctx, conn, message) != nil {
				t.Fatal("send batch")
			}
			var result screenerapi.ErrorMessage
			if wsjson.Read(ctx, conn, &result) != nil {
				t.Fatal("read error")
			}
			if result.Type != "screener.error" || result.Code != tc.code || result.Retryable != tc.retryable ||
				result.RequestID != "recheck-test" || strings.Contains(result.Message, "private database") {
				t.Fatalf("unexpected error=%+v", result)
			}
		})
	}
}
