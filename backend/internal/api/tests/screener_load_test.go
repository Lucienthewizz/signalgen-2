package apitests

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"runtime/metrics"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	screenerapi "github.com/Lucienthewizz/signalgen-2/backend/internal/api/screener"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/coder/websocket"
)

const runScreenerLoadProfileEnv = "SIGNALGEN_RUN_SCREENER_LOAD_PROFILE"

// TestScreenerWebSocketLoadProfile exercises the complete private-decision
// transport path: ticket HTTP request, WebSocket upgrade, request validation,
// private decision evaluation, and response delivery.
//
// It is opt-in because its fixed number of concurrent network round trips is
// intended for local profiling, not the normal unit-test loop. The identity,
// session, entitlement, and compute-grant dependencies are in-memory fakes, so
// the result is a regression baseline rather than a production capacity claim.
func TestScreenerWebSocketLoadProfile(t *testing.T) {
	if os.Getenv(runScreenerLoadProfileEnv) != "1" {
		t.Skip("set " + runScreenerLoadProfileEnv + "=1 to run the WebSocket load profile")
	}

	for _, concurrentSessions := range []int{1, 10, 30} {
		t.Run(fmt.Sprintf("sessions_%d", concurrentSessions), func(t *testing.T) {
			const (
				warmupRounds   = 1
				measuredRounds = 8
			)

			server := newScreenerLoadServer(t)
			defer server.Close()
			payload := screenerLoadPayload(250)

			var coldLatencies []time.Duration
			for range warmupRounds {
				cold := runScreenerLoadRound(t, server.URL, concurrentSessions, payload)
				if cold.failures != 0 {
					t.Fatalf("cold failures=%d first_error=%v", cold.failures, cold.firstError)
				}
				coldLatencies = append(coldLatencies, cold.latencies...)
			}
			sort.Slice(coldLatencies, func(i, j int) bool { return coldLatencies[i] < coldLatencies[j] })

			runtime.GC()
			var beforeMemory runtime.MemStats
			runtime.ReadMemStats(&beforeMemory)
			beforeCPU := totalCPUSeconds()
			startedAt := time.Now()

			latencies := make([]time.Duration, 0, concurrentSessions*measuredRounds)
			var failures, bytesSent, bytesReceived int64
			var firstError error
			for range measuredRounds {
				round := runScreenerLoadRound(t, server.URL, concurrentSessions, payload)
				latencies = append(latencies, round.latencies...)
				failures += round.failures
				bytesSent += round.bytesSent
				bytesReceived += round.bytesReceived
				if firstError == nil {
					firstError = round.firstError
				}
			}

			wallTime := time.Since(startedAt)
			cpuSeconds := totalCPUSeconds() - beforeCPU
			var afterMemory runtime.MemStats
			runtime.ReadMemStats(&afterMemory)
			completed := int64(len(latencies))
			if failures != 0 || completed != int64(concurrentSessions*measuredRounds) {
				t.Fatalf("completed=%d failures=%d expected=%d first_error=%v", completed, failures, concurrentSessions*measuredRounds, firstError)
			}

			sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
			allocDelta := afterMemory.TotalAlloc - beforeMemory.TotalAlloc
			t.Logf(
				"profile sessions=%d cold_p50=%s cold_p95=%s warm_rounds=%d completed=%d failures=%d wall=%s warm_p50=%s warm_p95=%s throughput=%.2f_sessions/s cpu=%.6fs total_alloc=%dB alloc/session=%.0fB app_sent=%dB app_received=%dB",
				concurrentSessions, percentile(coldLatencies, 50), percentile(coldLatencies, 95),
				measuredRounds, completed, failures, wallTime,
				percentile(latencies, 50), percentile(latencies, 95),
				float64(completed)/wallTime.Seconds(), cpuSeconds, allocDelta,
				float64(allocDelta)/float64(completed), bytesSent, bytesReceived,
			)
		})
	}
}

type screenerLoadRoundResult struct {
	latencies     []time.Duration
	failures      int64
	bytesSent     int64
	bytesReceived int64
	firstError    error
}

func runScreenerLoadRound(t *testing.T, serverURL string, concurrentSessions int, payload screenerapi.EvaluateMessage) screenerLoadRoundResult {
	t.Helper()
	latencies := make(chan time.Duration, concurrentSessions)
	errorsFound := make(chan error, concurrentSessions)
	var failures, bytesSent, bytesReceived atomic.Int64
	var wait sync.WaitGroup
	wait.Add(concurrentSessions)

	for index := range concurrentSessions {
		go func() {
			defer wait.Done()
			startedAt := time.Now()
			sent, received, err := executeScreenerLoadSession(serverURL, index, payload)
			if err != nil {
				failures.Add(1)
				errorsFound <- err
				return
			}
			bytesSent.Add(sent)
			bytesReceived.Add(received)
			latencies <- time.Since(startedAt)
		}()
	}
	wait.Wait()
	close(latencies)
	close(errorsFound)

	result := screenerLoadRoundResult{failures: failures.Load(), bytesSent: bytesSent.Load(), bytesReceived: bytesReceived.Load()}
	for latency := range latencies {
		result.latencies = append(result.latencies, latency)
	}
	for err := range errorsFound {
		if result.firstError == nil {
			result.firstError = err
		}
	}
	return result
}

func executeScreenerLoadSession(serverURL string, index int, payload screenerapi.EvaluateMessage) (int64, int64, error) {
	const ticketBody = `{"compute_grant_id":"cgr-load","protocol":"screener-private-1"}`
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, serverURL+"/api/v1/screener/socket-tickets", strings.NewReader(ticketBody))
	if err != nil {
		return 0, 0, err
	}
	request.Header.Set("Authorization", "Bearer load-user-token")
	request.Header.Set("X-App-Session", "sgs_load_session")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return 0, 0, err
	}
	ticketBytes, readErr := io.ReadAll(response.Body)
	response.Body.Close()
	if readErr != nil {
		return 0, 0, readErr
	}
	if response.StatusCode != http.StatusCreated {
		return 0, 0, fmt.Errorf("ticket status %d: %s", response.StatusCode, ticketBytes)
	}
	var ticket struct {
		Token         string `json:"ticket"`
		WebSocketPath string `json:"websocket_path"`
	}
	if err := json.Unmarshal(ticketBytes, &ticket); err != nil {
		return 0, 0, err
	}

	websocketURL := "ws" + strings.TrimPrefix(serverURL, "http") + ticket.WebSocketPath + "?ticket=" + ticket.Token
	connection, upgradeResponse, err := websocket.Dial(ctx, websocketURL, nil)
	if err != nil {
		if upgradeResponse != nil {
			return 0, 0, fmt.Errorf("websocket status %d: %w", upgradeResponse.StatusCode, err)
		}
		return 0, 0, err
	}
	defer connection.Close(websocket.StatusNormalClosure, "load profile complete")

	message := payload
	message.RequestID = fmt.Sprintf("load-%d-%d", index, time.Now().UnixNano())
	requestBytes, err := json.Marshal(message)
	if err != nil {
		return 0, 0, err
	}
	if err := connection.Write(ctx, websocket.MessageText, requestBytes); err != nil {
		return 0, 0, err
	}
	messageType, resultBytes, err := connection.Read(ctx)
	if err != nil {
		return 0, 0, err
	}
	if messageType != websocket.MessageText {
		return 0, 0, fmt.Errorf("unexpected WebSocket message type %d", messageType)
	}
	var result screenerapi.ResultMessage
	if err := json.Unmarshal(resultBytes, &result); err != nil {
		return 0, 0, err
	}
	if result.RequestID != message.RequestID || len(result.Results) != len(message.Candidates) {
		return 0, 0, fmt.Errorf("invalid result request_id=%q results=%d", result.RequestID, len(result.Results))
	}
	return int64(len(ticketBody) + len(requestBytes)), int64(len(ticketBytes) + len(resultBytes)), nil
}

func newScreenerLoadServer(t *testing.T) *httptest.Server {
	t.Helper()
	server, err := api.NewServer(
		loadIdentity{}, loadSessions{}, &fakeAccess{features: []string{access.FeatureScreener}},
		&fakeDatasets{manifest: screenerTestManifest()}, loadCompute{},
	)
	if err != nil {
		t.Fatal(err)
	}
	return httptest.NewServer(server)
}

type loadIdentity struct{}

func (loadIdentity) Verify(context.Context, string) (auth.Principal, error) {
	return auth.Principal{ID: "load-user", Email: "load@example.test"}, nil
}

type loadSessions struct{}

func (loadSessions) Create(context.Context, string, string, string) (session.Created, error) {
	return session.Created{}, nil
}

func (loadSessions) Verify(context.Context, string, string) (session.Session, error) {
	return session.Session{ID: "ses-load", UserID: "load-user"}, nil
}

func (loadSessions) VerifyByID(context.Context, string, string) (session.Session, error) {
	return session.Session{ID: "ses-load", UserID: "load-user"}, nil
}

func (loadSessions) Revoke(context.Context, string, string) error { return nil }

func (loadSessions) List(context.Context, string) ([]session.Session, error) { return nil, nil }

func (loadSessions) RevokeByID(context.Context, string, string) error { return nil }

func (loadSessions) ListDevices(context.Context, string) ([]session.Device, error) { return nil, nil }

func (loadSessions) RenameDevice(context.Context, string, string, string) error { return nil }

func (loadSessions) RevokeDevice(context.Context, string, string) error { return nil }

func (loadSessions) ActiveLimit() int { return 1 }

func (loadSessions) DeviceSwitchCooldown() time.Duration { return 24 * time.Hour }

type loadCompute struct{}

func (loadCompute) Create(context.Context, compute.CreateRequest) (compute.Grant, error) {
	return loadComputeGrant(), nil
}

func (loadCompute) Verify(context.Context, string, string, string) (compute.Grant, error) {
	return loadComputeGrant(), nil
}

func loadComputeGrant() compute.Grant {
	return compute.Grant{
		ID: "cgr-load", Purpose: "screen", RuleID: core.BaselineRuleID,
		DefinitionHash: core.BaselineRuleHash, EngineVersion: core.EngineVersion,
		SchemaVersion: core.SchemaVersion,
		DatasetID:     "ds-test", DatasetVersion: "v1", DatasetChecksum: "sha256:test",
	}
}

func screenerLoadPayload(candidateCount int) screenerapi.EvaluateMessage {
	candidates := make([]core.FeatureCandidate, candidateCount)
	startedAt := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	for index := range candidates {
		candidates[index] = core.FeatureCandidate{
			Symbol: "BBCA.JK", Timestamp: startedAt.Add(time.Duration(index) * 24 * time.Hour).Format(time.RFC3339),
			Features: core.FeatureVector{Price: 128, EMA9: 125, EMA20: 121, RSI14: 72},
		}
	}
	return screenerapi.EvaluateMessage{
		Type: "screener.evaluate", Protocol: core.PrivateProtocol,
		EngineVersion: core.EngineVersion, FeatureSchemaVersion: core.FeatureSchemaVersion,
		Candidates: candidates,
	}
}

func percentile(sorted []time.Duration, value int) time.Duration {
	if len(sorted) == 0 {
		return 0
	}
	index := (len(sorted)*value + 99) / 100
	if index < 1 {
		index = 1
	}
	return sorted[index-1]
}

func totalCPUSeconds() float64 {
	samples := []metrics.Sample{{Name: "/cpu/classes/total:cpu-seconds"}}
	metrics.Read(samples)
	return samples[0].Value.Float64()
}
