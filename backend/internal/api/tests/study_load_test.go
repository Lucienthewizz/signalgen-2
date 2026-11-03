package apitests

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	studies "github.com/Lucienthewizz/signalgen-2/backend/internal/api/backtests"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type studyLoadIdentity struct{}

func (studyLoadIdentity) Verify(_ context.Context, token string) (auth.Principal, error) {
	if !strings.HasPrefix(token, "synthetic-") {
		return auth.Principal{}, auth.ErrTokenInvalid
	}
	return auth.Principal{ID: token}, nil
}

type studyLoadSessions struct{ session.Repository }

func (studyLoadSessions) Verify(_ context.Context, owner, token string) (session.Session, error) {
	if token != "synthetic-session" {
		return session.Session{}, session.ErrInvalid
	}
	return session.Session{ID: "session-" + owner, UserID: owner}, nil
}

// Opt in explicitly: this opens a loopback-only fixture API. No .env is read,
// and all identity, access, session and price dependencies are local fakes.
func TestStudySyntheticHTTPAdmission(t *testing.T) {
	output := os.Getenv("SIGNALGEN_TEST_PERFORMANCE_OUTPUT")
	if output == "" {
		t.Skip("opt-in local load evidence")
	}
	catalog := &studyCatalog{}
	for i := 0; i < 23; i++ {
		symbol := fmt.Sprintf("STOCK%02d", i)
		catalog.stocks = append(catalog.stocks, universe.Instrument{Symbol: symbol, ProviderSymbol: symbol, Exchange: "XNAS", Currency: "USD"})
	}
	prices := &backtestMarket{}
	snapshots, _ := dataset.NewDynamicStore(prices, catalog)
	server, e := api.NewServer(studyLoadIdentity{}, studyLoadSessions{}, &fakeAccess{features: []string{access.FeatureBacktest}}, snapshots, &fakeCompute{}, api.WithUniverseStore(catalog))
	if e != nil {
		t.Fatal(e)
	}
	host := httptest.NewServer(server)
	defer host.Close()
	transport := &http.Transport{MaxConnsPerHost: 128, MaxIdleConnsPerHost: 128}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 15 * time.Second}
	input := studies.StudyInput{Source: "market", Market: "US", RuleID: core.BaselineRuleID, Config: core.SignalStudyConfig{From: "2026-01-20", To: "2026-01-23", NSteps: 3}}
	raw, _ := json.Marshal(input)
	type response struct {
		owner, id string
		status    int
		elapsed   float64
		bytes     int
		body      []byte
		err       error
	}
	call := func(owner, method, path string, body []byte) response {
		r := response{owner: owner}
		req, _ := http.NewRequest(method, host.URL+path, bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+owner)
		req.Header.Set("X-App-Session", "synthetic-session")
		req.Header.Set("Content-Type", "application/json")
		start := time.Now()
		res, err := client.Do(req)
		r.elapsed = float64(time.Since(start).Nanoseconds()) / 1e6
		if err != nil {
			r.err = err
			return r
		}
		defer res.Body.Close()
		r.body, r.err = io.ReadAll(res.Body)
		r.bytes = len(r.body)
		r.status = res.StatusCode
		if res.Header.Get("X-Request-ID") == "" {
			r.err = fmt.Errorf("missing request ID")
		}
		return r
	}
	percentile := func(values []float64, p float64) float64 {
		if len(values) == 0 {
			return 0
		}
		sort.Float64s(values)
		return values[int(math.Ceil(float64(len(values))*p))-1]
	}
	evidence := []map[string]any{}
	for _, users := range []int{1, 10, 30, 100, 1000} {
		responses := make(chan response, users)
		start := make(chan struct{})
		var work sync.WaitGroup
		for i := 0; i < users; i++ {
			owner := fmt.Sprintf("synthetic-%d-%d", users, i)
			work.Add(1)
			go func() { defer work.Done(); <-start; responses <- call(owner, "POST", "/api/v1/backtests/studies", raw) }()
		}
		close(start)
		work.Wait()
		close(responses)
		accepted := []response{}
		latencies := []float64{}
		rejected, traffic := 0, 0
		for r := range responses {
			if r.err != nil {
				t.Fatal(r.err)
			}
			latencies = append(latencies, r.elapsed)
			traffic += r.bytes
			switch r.status {
			case 201:
				var ctx studies.StudyContext
				if json.Unmarshal(r.body, &ctx) != nil {
					t.Fatal("invalid context")
				}
				r.id = ctx.ID
				accepted = append(accepted, r)
			case 429:
				rejected++
			default:
				t.Fatalf("create %d %s", r.status, r.body)
			}
		}
		if len(accepted) != min(users, 32) || rejected != users-min(users, 32) {
			t.Fatal("context admission changed")
		}
		prepared := make(chan response, len(accepted))
		for _, a := range accepted {
			work.Add(1)
			go func() {
				defer work.Done()
				prepared <- call(a.owner, "POST", "/api/v1/backtests/studies/"+a.id+"/batches/0/prepare", []byte(`{}`))
			}()
		}
		work.Wait()
		close(prepared)
		prepareTimes := []float64{}
		stockOK, capacityFailures := 0, 0
		for r := range prepared {
			if r.err != nil || r.status != 200 {
				t.Fatalf("batch %d %s %v", r.status, r.body, r.err)
			}
			traffic += r.bytes
			prepareTimes = append(prepareTimes, r.elapsed)
			var batch studies.StudyBatch
			json.Unmarshal(r.body, &batch)
			stockOK += len(batch.Manifests)
			for _, f := range batch.Failures {
				if f.Code != "SNAPSHOT_CAPACITY" {
					t.Fatalf("unexpected fake-provider failure %+v", f)
				}
				capacityFailures++
			}
		}
		for _, a := range accepted {
			r := call(a.owner, "DELETE", "/api/v1/backtests/studies/"+a.id, nil)
			if r.status != 204 {
				t.Fatal("cleanup", r.status)
			}
		}
		evidence = append(evidence, map[string]any{"logical_users": users, "admitted_contexts": len(accepted), "capacity_rejected_contexts": rejected, "first_batch_stocks_prepared": stockOK, "snapshot_capacity_failures": capacityFailures, "create_p50_ms": percentile(latencies, .5), "create_p95_ms": percentile(latencies, .95), "prepare_p50_ms": percentile(prepareTimes, .5), "prepare_p95_ms": percentile(prepareTimes, .95), "response_json_bytes": traffic, "unexpected_errors": 0})
	}
	report := map[string]any{"kind": "loopback_http_synthetic_admission", "timestamp": time.Now().UTC(), "go": runtime.Version(), "os": runtime.GOOS, "arch": runtime.GOARCH, "cpus": runtime.NumCPU(), "synthetic_dependencies": []string{"identity", "session", "entitlement", "catalog", "daily OHLCV"}, "limits": "One create and first ten-stock batch per admitted user; contexts held until admission wave ends. Current process-local bounds; no real Supabase/Yahoo, no complete screening, no production capacity claim.", "provider_calls": prices.calls.Load(), "runs": evidence}
	data, _ := json.MarshalIndent(report, "", "  ")
	if e = os.WriteFile(output, append(data, '\n'), 0600); e != nil {
		t.Fatal(e)
	}
}
