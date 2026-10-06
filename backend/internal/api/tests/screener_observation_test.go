package apitests

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/platform/observability"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/coder/websocket"
)

// Events are sent after the logger finishes. Tests wait for handler completion,
// not HTTP 101 or a frame, before reading the log buffer or asserting outcomes.
type screeningProbe struct {
	events   chan screener.Observation
	logs     bytes.Buffer
	observer *observability.ScreenerObserver
}

func newScreeningProbe() *screeningProbe {
	probe := &screeningProbe{events: make(chan screener.Observation, 4)}
	probe.observer = observability.NewScreenerObserver(slog.New(slog.NewJSONHandler(&probe.logs, nil)))
	return probe
}

func (probe *screeningProbe) Record(event screener.Observation) {
	probe.observer.Record(event)
	probe.events <- event
}

func (probe *screeningProbe) await(t *testing.T) screener.Observation {
	t.Helper()
	select {
	case event := <-probe.events:
		return event
	case <-time.After(3 * time.Second):
		t.Fatal("screening handler did not finish its observation")
		return screener.Observation{}
	}
}

func TestScreenerObservesInvalidFramesWithoutLoggingPayloads(t *testing.T) {
	for _, tc := range []struct {
		name  string
		kind  websocket.MessageType
		body  string
		stage screener.Stage
	}{
		{"malformed", websocket.MessageText, `{"secret":"private-feature-payload"`, screener.StageValidate},
		{"binary", websocket.MessageBinary, "private-feature-payload", screener.StageRead},
		{"oversized", websocket.MessageText, strings.Repeat("x", int(screener.MaxMessageBytes)+1), screener.StageRead},
	} {
		t.Run(tc.name, func(t *testing.T) {
			probe := newScreeningProbe()
			manifest := screenerTestManifest()
			server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}},
				&fakeSessions{verified: session.Session{ID: "ses-1", UserID: "user-a"}},
				&fakeAccess{features: []string{access.FeatureScreener}}, &fakeDatasets{manifest: manifest},
				&fakeCompute{grant: compute.Grant{ID: "cgr-1", Purpose: "screen", RuleID: core.BaselineRuleID,
					DefinitionHash: core.BaselineRuleHash, EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion,
					DatasetID: manifest.DatasetID, DatasetVersion: manifest.Version, DatasetChecksum: manifest.Checksum}},
				api.WithScreeningObserver(probe))
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest(http.MethodPost, "/api/v1/screener/socket-tickets", strings.NewReader(`{"compute_grant_id":"cgr-1","protocol":"screener-private-1"}`))
			req.Header.Set("Authorization", "Bearer private-bearer")
			req.Header.Set("X-App-Session", "private-session")
			res := httptest.NewRecorder()
			server.ServeHTTP(res, req)
			if res.Code != http.StatusCreated {
				t.Fatalf("ticket = %d", res.Code)
			}
			var ticket struct {
				Token string `json:"ticket"`
			}
			if err := json.Unmarshal(res.Body.Bytes(), &ticket); err != nil {
				t.Fatal(err)
			}
			httpServer := httptest.NewServer(server)
			defer httpServer.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			conn, response, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(httpServer.URL, "http")+"/api/v1/screener/ws?ticket="+ticket.Token, &websocket.DialOptions{HTTPHeader: http.Header{"X-Request-ID": {"private-client-correlation"}}})
			if err != nil {
				t.Fatal(err)
			}
			defer conn.CloseNow()
			// An oversized write may fail while the peer closes with 1009.
			writeErr := conn.Write(ctx, tc.kind, []byte(tc.body))
			if writeErr != nil && tc.name != "oversized" {
				t.Fatal(writeErr)
			}
			_, _, _ = conn.Read(ctx)
			_ = conn.Close(websocket.StatusNormalClosure, "test complete")
			event := probe.await(t)
			if event.Outcome != screener.OutcomeInvalid || event.FailedStage != tc.stage || !event.Upgraded || event.Candidates != 0 {
				t.Fatalf("frame observation = %+v", event)
			}
			if event.RequestID != response.Header.Get("X-Request-ID") || !strings.HasPrefix(event.RequestID, "req_") {
				t.Fatal("lost server correlation")
			}
			if probe.observer.Snapshot().Outcomes[string(screener.OutcomeWritten)] != 0 {
				t.Fatal("invalid frame counted as result")
			}
			for _, value := range []string{ticket.Token, "private-feature-payload", "private-bearer", "private-session", "private-client-correlation", "user-a", "BBCA.JK"} {
				if strings.Contains(probe.logs.String(), value) {
					t.Fatalf("screening logs leaked %s", value)
				}
			}
		})
	}
}

func TestNilScreeningObserverRejected(t *testing.T) {
	if _, err := api.NewServer(fakeIdentity{}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{}, api.WithScreeningObserver(nil)); err == nil {
		t.Fatal("nil screening observer accepted")
	}
}
