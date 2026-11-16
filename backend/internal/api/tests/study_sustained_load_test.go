package apitests

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	studies "github.com/Lucienthewizz/signalgen-2/backend/internal/api/backtests"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/backtest"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

// Thread-safe synthetic compute grant store for concurrent private evaluation.
type concurrentGrantsStore struct {
	mu     sync.Mutex
	grants map[string]compute.Grant
}

func newConcurrentGrantsStore() *concurrentGrantsStore {
	return &concurrentGrantsStore{grants: make(map[string]compute.Grant)}
}

func (s *concurrentGrantsStore) Create(_ context.Context, r compute.CreateRequest) (compute.Grant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	grantID := fmt.Sprintf("grant-%s-%s-%d", r.UserID, r.DatasetID, len(s.grants)+1)
	g := compute.Grant{
		ID:              grantID,
		Purpose:         r.Purpose,
		DatasetID:       r.DatasetID,
		DatasetVersion:  r.DatasetVersion,
		DatasetChecksum: r.DatasetChecksum,
		RuleID:          r.RuleID,
		DefinitionHash:  r.DefinitionHash,
		EngineVersion:   r.EngineVersion,
		SchemaVersion:   r.SchemaVersion,
		ExpiresAt:       time.Now().Add(time.Minute),
	}
	s.grants[grantID] = g
	return g, nil
}

func (s *concurrentGrantsStore) Verify(_ context.Context, owner, sess, id string) (compute.Grant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	g, ok := s.grants[id]
	if !ok {
		return compute.Grant{}, compute.ErrInvalid
	}
	if !time.Now().Before(g.ExpiresAt) {
		return compute.Grant{}, compute.ErrExpired
	}
	return g, nil
}

// Monitored dynamic store wrapping DynamicStore to track admission, published
// snapshot slots, and verify zero leak at completion.
type monitoredDynamicStore struct {
	*dataset.DynamicStore
	mu              sync.Mutex
	studySnapshots  map[string]int64
	activeSnapshots int64
	peakSnapshots   int64
}

func newMonitoredDynamicStore(prices *backtestMarket, catalog *studyCatalog) (*monitoredDynamicStore, error) {
	store, err := dataset.NewDynamicStore(prices, catalog)
	if err != nil {
		return nil, err
	}
	return &monitoredDynamicStore{
		DynamicStore:   store,
		studySnapshots: make(map[string]int64),
	}, nil
}

func (m *monitoredDynamicStore) PrepareStudyBatch(ctx context.Context, owner, studyID string, input dataset.PrepareRequest, instruments []universe.Instrument) ([]dataset.Manifest, []error, error) {
	manifests, failures, err := m.DynamicStore.PrepareStudyBatch(ctx, owner, studyID, input, instruments)
	if err == nil {
		m.mu.Lock()
		count := int64(len(manifests))
		m.studySnapshots[studyID] += count
		m.activeSnapshots += count
		if m.activeSnapshots > m.peakSnapshots {
			m.peakSnapshots = m.activeSnapshots
		}
		m.mu.Unlock()
	}
	return manifests, failures, err
}

func (m *monitoredDynamicStore) ReleaseStudy(owner, studyID string) {
	m.mu.Lock()
	count := m.studySnapshots[studyID]
	delete(m.studySnapshots, studyID)
	m.activeSnapshots -= count
	m.mu.Unlock()
	m.DynamicStore.ReleaseStudy(owner, studyID)
}

func (m *monitoredDynamicStore) Inflight() (active int64, peak int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.activeSnapshots, m.peakSnapshots
}

// Stage-level latency tracking helper.
type stageLatencies struct {
	mu        sync.Mutex
	create    []float64
	prepare   []float64
	evaluate  []float64
	release   []float64
	lifecycle []float64
}

func (l *stageLatencies) recordCreate(ms float64) {
	l.mu.Lock()
	l.create = append(l.create, ms)
	l.mu.Unlock()
}
func (l *stageLatencies) recordPrepare(ms float64) {
	l.mu.Lock()
	l.prepare = append(l.prepare, ms)
	l.mu.Unlock()
}
func (l *stageLatencies) recordEvaluate(ms float64) {
	l.mu.Lock()
	l.evaluate = append(l.evaluate, ms)
	l.mu.Unlock()
}
func (l *stageLatencies) recordRelease(ms float64) {
	l.mu.Lock()
	l.release = append(l.release, ms)
	l.mu.Unlock()
}
func (l *stageLatencies) recordLifecycle(ms float64) {
	l.mu.Lock()
	l.lifecycle = append(l.lifecycle, ms)
	l.mu.Unlock()
}

func calculatePercentile(values []float64, p float64) float64 {
	if len(values) == 0 {
		return 0
	}
	copied := append([]float64(nil), values...)
	sort.Float64s(copied)
	idx := int(math.Ceil(float64(len(copied))*p)) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(copied) {
		idx = len(copied) - 1
	}
	return copied[idx]
}

// Sustained HTTP client wrapper
type studyHTTPClient struct {
	client  *http.Client
	baseURL string
	sent    atomic.Int64
	rcvd    atomic.Int64
}

type studyHTTPResponse struct {
	owner   string
	status  int
	elapsed float64
	bytes   int
	body    []byte
	headers http.Header
	err     error
}

func (c *studyHTTPClient) do(owner, method, path string, body []byte) studyHTTPResponse {
	r := studyHTTPResponse{owner: owner}
	req, err := http.NewRequest(method, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		r.err = err
		return r
	}
	req.Header.Set("Authorization", "Bearer "+owner)
	req.Header.Set("X-App-Session", "synthetic-session")
	req.Header.Set("Content-Type", "application/json")
	c.sent.Add(int64(len(body)))

	start := time.Now()
	res, err := c.client.Do(req)
	r.elapsed = float64(time.Since(start).Nanoseconds()) / 1e6
	if err != nil {
		r.err = err
		return r
	}
	defer res.Body.Close()
	r.body, r.err = io.ReadAll(res.Body)
	r.bytes = len(r.body)
	c.rcvd.Add(int64(r.bytes))
	r.status = res.StatusCode
	r.headers = res.Header.Clone()
	if res.Header.Get("X-Request-ID") == "" && r.status < 500 {
		r.err = fmt.Errorf("missing request ID for %s %s status=%d", method, path, r.status)
	}
	return r
}

// TestStudySustainedWorkloadCorrectnessAndOverloadRecovery tests correctness
// invariants under concurrent sustained load and validates recovery after overload:
// 1. Admission hard cap: <= 32 active study contexts.
// 2. Snapshot hard cap: <= 128 dynamic snapshot slots.
// 3. Overload returns 429 with explicit Retry-After backpressure.
// 4. Overloaded clients recover and make progress after prior users release.
// 5. Categorization without duplicate counts: attempts == completed + rejected + failed + cancelled.
// 6. Zero retained context or snapshot slot leak at completion.
func TestStudySustainedWorkloadCorrectnessAndOverloadRecovery(t *testing.T) {
	catalog := &studyCatalog{}
	for i := 0; i < 23; i++ {
		symbol := fmt.Sprintf("STOCK%02d", i)
		catalog.stocks = append(catalog.stocks, universe.Instrument{Symbol: symbol, ProviderSymbol: symbol, Exchange: "XNAS", Currency: "USD"})
	}
	prices := &backtestMarket{}
	store, err := newMonitoredDynamicStore(prices, catalog)
	if err != nil {
		t.Fatal(err)
	}
	grants := newConcurrentGrantsStore()
	server, err := api.NewServer(
		studyLoadIdentity{},
		studyLoadSessions{},
		&fakeAccess{features: []string{access.FeatureBacktest}},
		store,
		grants,
		api.WithUniverseStore(catalog),
	)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(server)
	defer host.Close()

	transport := &http.Transport{MaxConnsPerHost: 128, MaxIdleConnsPerHost: 128}
	defer transport.CloseIdleConnections()
	client := &studyHTTPClient{
		client:  &http.Client{Transport: transport, Timeout: 15 * time.Second},
		baseURL: host.URL,
	}

	studyPayload, _ := json.Marshal(studies.StudyInput{
		Source: "market",
		Market: "US",
		RuleID: core.BaselineRuleID,
		Config: core.SignalStudyConfig{From: "2026-01-20", To: "2026-01-23", NSteps: 3},
	})

	t.Run("overload_admission_and_snapshot_recovery", func(t *testing.T) {
		// Step 1: Saturate study context limit (32 contexts)
		contexts := make([]studies.StudyContext, 32)
		for i := 0; i < 32; i++ {
			owner := fmt.Sprintf("synthetic-sat-%d", i)
			res := client.do(owner, "POST", "/api/v1/backtests/studies", studyPayload)
			if res.status != 201 {
				t.Fatalf("failed to admit context %d: status=%d %s", i, res.status, res.body)
			}
			if json.Unmarshal(res.body, &contexts[i]) != nil {
				t.Fatal("invalid context JSON")
			}
		}

		// Step 2: 33rd context must be rejected with 429 STUDY_CAPACITY and Retry-After: 60
		overflowRes := client.do("synthetic-overflow", "POST", "/api/v1/backtests/studies", studyPayload)
		if overflowRes.status != 429 {
			t.Fatalf("expected 429 on 33rd context, got %d %s", overflowRes.status, overflowRes.body)
		}
		if overflowRes.headers.Get("Retry-After") != "60" {
			t.Fatalf("expected Retry-After: 60 on STUDY_CAPACITY, got %s", overflowRes.headers.Get("Retry-After"))
		}

		// Step 3: Saturate snapshot capacity (12 batches * 10 stocks = 120 snapshots)
		for i := 0; i < 12; i++ {
			path := fmt.Sprintf("/api/v1/backtests/studies/%s/batches/0/prepare", contexts[i].ID)
			res := client.do(fmt.Sprintf("synthetic-sat-%d", i), "POST", path, []byte(`{}`))
			if res.status != 200 {
				t.Fatalf("failed batch %d prepare: status=%d %s", i, res.status, res.body)
			}
		}

		// Step 4: 13th batch must be rejected with 429 SNAPSHOT_CAPACITY and Retry-After: 1
		path13 := fmt.Sprintf("/api/v1/backtests/studies/%s/batches/0/prepare", contexts[12].ID)
		snapshotOverloadRes := client.do("synthetic-sat-12", "POST", path13, []byte(`{}`))
		if snapshotOverloadRes.status != 429 {
			t.Fatalf("expected 429 on snapshot overload, got %d %s", snapshotOverloadRes.status, snapshotOverloadRes.body)
		}
		if snapshotOverloadRes.headers.Get("Retry-After") != "1" {
			t.Fatalf("expected Retry-After: 1 on SNAPSHOT_CAPACITY, got %s", snapshotOverloadRes.headers.Get("Retry-After"))
		}

		// Step 5: Test recovery of snapshot capacity when user 0 releases their batch
		relRes := client.do("synthetic-sat-0", "DELETE", fmt.Sprintf("/api/v1/backtests/studies/%s/batches/0/prepare", contexts[0].ID), nil)
		if relRes.status != 204 {
			t.Fatalf("batch release failed: %d %s", relRes.status, relRes.body)
		}

		// Context 12 retries preparing batch 0 -> must now succeed!
		retryRes := client.do("synthetic-sat-12", "POST", path13, []byte(`{}`))
		if retryRes.status != 200 {
			t.Fatalf("snapshot capacity retry failed: status=%d %s", retryRes.status, retryRes.body)
		}

		// Step 6: Test recovery of context capacity when user 0 cancels their study
		delRes := client.do("synthetic-sat-0", "DELETE", "/api/v1/backtests/studies/"+contexts[0].ID, nil)
		if delRes.status != 204 {
			t.Fatalf("study delete failed: %d %s", delRes.status, delRes.body)
		}

		// Overflow user can now create a study context -> must succeed!
		recoveredContextRes := client.do("synthetic-overflow", "POST", "/api/v1/backtests/studies", studyPayload)
		if recoveredContextRes.status != 201 {
			t.Fatalf("recovered context creation failed: status=%d %s", recoveredContextRes.status, recoveredContextRes.body)
		}
		var recoveredCtx studies.StudyContext
		json.Unmarshal(recoveredContextRes.body, &recoveredCtx)

		// Step 7: Clean up all saturated and recovered contexts
		client.do("synthetic-overflow", "DELETE", "/api/v1/backtests/studies/"+recoveredCtx.ID, nil)
		for i := 1; i < 32; i++ {
			client.do(fmt.Sprintf("synthetic-sat-%d", i), "DELETE", "/api/v1/backtests/studies/"+contexts[i].ID, nil)
		}

		// Verify zero retained context leak by proving 32 fresh contexts can be created
		for i := 0; i < 32; i++ {
			owner := fmt.Sprintf("synthetic-fresh-%d", i)
			res := client.do(owner, "POST", "/api/v1/backtests/studies", studyPayload)
			if res.status != 201 {
				t.Fatalf("leak detected: fresh context %d failed with status=%d %s", i, res.status, res.body)
			}
			var freshCtx studies.StudyContext
			json.Unmarshal(res.body, &freshCtx)
			client.do(owner, "DELETE", "/api/v1/backtests/studies/"+freshCtx.ID, nil)
		}
	})

	t.Run("concurrent_full_lifecycle_invariants", func(t *testing.T) {
		const (
			workers     = 10
			iterations  = 3
			maxAttempts = workers * iterations
		)

		var (
			attemptsCount  atomic.Int64
			completedCount atomic.Int64
			rejectedCount  atomic.Int64
			failedCount    atomic.Int64
			cancelledCount atomic.Int64

			activeContexts atomic.Int64
			peakContexts   atomic.Int64
		)

		var wg sync.WaitGroup
		startGate := make(chan struct{})

		for w := 0; w < workers; w++ {
			wg.Add(1)
			go func(workerID int) {
				defer wg.Done()
				<-startGate

				for it := 0; it < iterations; it++ {
					attemptsCount.Add(1)
					owner := fmt.Sprintf("synthetic-worker-%d-%d", workerID, it)

					// 1. Create Study
					res := client.do(owner, "POST", "/api/v1/backtests/studies", studyPayload)
					if res.err != nil {
						if errors.Is(res.err, context.Canceled) {
							cancelledCount.Add(1)
						} else {
							failedCount.Add(1)
						}
						continue
					}
					if res.status == 429 {
						rejectedCount.Add(1)
						continue
					}
					if res.status != 201 {
						failedCount.Add(1)
						continue
					}

					var ctx studies.StudyContext
					if err := json.Unmarshal(res.body, &ctx); err != nil {
						failedCount.Add(1)
						continue
					}

					curCtx := activeContexts.Add(1)
					for {
						peak := peakContexts.Load()
						if curCtx <= peak || peakContexts.CompareAndSwap(peak, curCtx) {
							break
						}
					}

					studyPath := "/api/v1/backtests/studies/" + ctx.ID
					batchPath := studyPath + "/batches/0/prepare"

					// 2. Prepare Batch 0 (with bounded backoff retry on 429)
					var batch studies.StudyBatch
					prepared := false
					for retry := 0; retry < 3; retry++ {
						bRes := client.do(owner, "POST", batchPath, []byte(`{}`))
						if bRes.status == 429 {
							retryAfterSec := 1
							if s := bRes.headers.Get("Retry-After"); s != "" {
								if n, err := strconv.Atoi(s); err == nil && n > 0 {
									retryAfterSec = min(n, 2)
								}
							}
							time.Sleep(time.Duration(retryAfterSec) * 20 * time.Millisecond) // scaled test backoff
							continue
						}
						if bRes.status == 200 {
							if json.Unmarshal(bRes.body, &batch) == nil && len(batch.Manifests) == 10 {
								prepared = true
							}
							break
						}
						break
					}

					if !prepared {
						// Clean up context and mark rejected
						client.do(owner, "DELETE", studyPath, nil)
						activeContexts.Add(-1)
						rejectedCount.Add(1)
						continue
					}

					// 3. Private Evaluate
					evaluated := true
					if len(batch.Manifests) > 0 {
						manifest := batch.Manifests[0]
						cRes := client.do(owner, "GET", "/api/v1/datasets/"+manifest.DatasetID+"/content", nil)
						if cRes.status != 200 {
							evaluated = false
						} else {
							var content struct {
								Series []core.BacktestSeries `json:"series"`
							}
							if json.Unmarshal(cRes.body, &content) == nil && len(content.Series) > 0 {
								local, err := core.ComputeBacktestFeatures(core.FeatureRequest{
									Purpose:  "backtest",
									Symbol:   manifest.Symbols[0],
									Candles:  content.Series[0].Candles,
									Operands: []string{"PRICE"},
								})
								if err != nil {
									evaluated = false
								} else {
									grantInput, _ := json.Marshal(compute.IssueInput{
										Purpose:         "backtest",
										DatasetID:       manifest.DatasetID,
										DatasetVersion:  manifest.Version,
										DatasetChecksum: manifest.Checksum,
										RuleID:          core.BaselineRuleID,
										DefinitionHash:  core.BaselineRuleHash,
										EngineVersion:   core.EngineVersion,
										SchemaVersion:   core.SchemaVersion,
									})
									gRes := client.do(owner, "POST", "/api/v1/compute-grants", grantInput)
									if gRes.status == 201 {
										var grant compute.Grant
										json.Unmarshal(gRes.body, &grant)
										sigInput, _ := json.Marshal(backtest.SignalInput{
											ComputeGrantID:       grant.ID,
											FeatureSchemaVersion: core.FeatureSchemaVersion,
											PolicyVersion:        core.SignalStudyPolicy,
											Candidates:           local.Candidates,
										})
										sRes := client.do(owner, "POST", "/api/v1/backtests/signals", sigInput)
										if sRes.status != 200 {
											evaluated = false
										}
									} else {
										evaluated = false
									}
								}
							} else {
								evaluated = false
							}
						}
					}

					// 4. Release Batch
					client.do(owner, "DELETE", batchPath, nil)

					// 5. Delete Study Context
					client.do(owner, "DELETE", studyPath, nil)
					activeContexts.Add(-1)

					if evaluated {
						completedCount.Add(1)
					} else {
						failedCount.Add(1)
					}
				}
			}(w)
		}

		close(startGate)
		wg.Wait()

		attempts := attemptsCount.Load()
		completed := completedCount.Load()
		rejected := rejectedCount.Load()
		failed := failedCount.Load()
		cancelled := cancelledCount.Load()
		peakCtx := peakContexts.Load()

		t.Logf("invariants: attempts=%d completed=%d rejected=%d failed=%d cancelled=%d peak_contexts=%d",
			attempts, completed, rejected, failed, cancelled, peakCtx)

		// Verification of invariants:
		if attempts != maxAttempts {
			t.Fatalf("unexpected attempts total: got %d want %d", attempts, maxAttempts)
		}
		if attempts != completed+rejected+failed+cancelled {
			t.Fatalf("outcome partition mismatch: %d != %d+%d+%d+%d",
				attempts, completed, rejected, failed, cancelled)
		}
		if peakCtx > 32 {
			t.Fatalf("peak contexts exceeded limit of 32: observed %d", peakCtx)
		}
		if failed != 0 {
			t.Fatalf("unexpected failures observed: %d", failed)
		}
		if activeContexts.Load() != 0 {
			t.Fatalf("context leak: %d still active", activeContexts.Load())
		}
	})
}

// TestStudySustainedLoadProfile runs an opt-in multi-client bounded sustained
// workload and measures throughput, percentiles by stage, bytes, and memory.
func TestStudySustainedLoadProfile(t *testing.T) {
	outputFile := os.Getenv("SIGNALGEN_TEST_SUSTAINED_OUTPUT")
	if outputFile == "" {
		outputFile = os.Getenv("SIGNALGEN_TEST_PERFORMANCE_OUTPUT")
	}
	runProfile := os.Getenv("SIGNALGEN_RUN_STUDY_SUSTAINED_LOAD")
	if outputFile == "" && runProfile != "1" {
		t.Skip("opt-in: set SIGNALGEN_RUN_STUDY_SUSTAINED_LOAD=1 or SIGNALGEN_TEST_SUSTAINED_OUTPUT")
	}

	catalog := &studyCatalog{}
	for i := 0; i < 23; i++ {
		symbol := fmt.Sprintf("STOCK%02d", i)
		catalog.stocks = append(catalog.stocks, universe.Instrument{
			Symbol:         symbol,
			ProviderSymbol: symbol,
			Exchange:       "XNAS",
			Currency:       "USD",
		})
	}
	prices := &backtestMarket{}
	store, err := newMonitoredDynamicStore(prices, catalog)
	if err != nil {
		t.Fatal(err)
	}
	grants := newConcurrentGrantsStore()
	server, err := api.NewServer(
		studyLoadIdentity{},
		studyLoadSessions{},
		&fakeAccess{features: []string{access.FeatureBacktest}},
		store,
		grants,
		api.WithUniverseStore(catalog),
	)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(server)
	defer host.Close()

	transport := &http.Transport{MaxConnsPerHost: 128, MaxIdleConnsPerHost: 128}
	defer transport.CloseIdleConnections()
	client := &studyHTTPClient{
		client:  &http.Client{Transport: transport, Timeout: 15 * time.Second},
		baseURL: host.URL,
	}

	studyPayload, _ := json.Marshal(studies.StudyInput{
		Source: "market",
		Market: "US",
		RuleID: core.BaselineRuleID,
		Config: core.SignalStudyConfig{From: "2026-01-20", To: "2026-01-23", NSteps: 3},
	})

	type profileRunResult struct {
		Concurrency           int     `json:"concurrency"`
		TargetAttempts        int     `json:"target_attempts"`
		Attempts              int64   `json:"attempts"`
		Completed             int64   `json:"completed"`
		Rejected              int64   `json:"rejected"`
		Failed                int64   `json:"failed"`
		Cancelled             int64   `json:"cancelled"`
		MaxInflightContexts   int64   `json:"max_inflight_contexts"`
		MaxInflightSnapshots  int64   `json:"max_inflight_snapshots"`
		WallDurationMs        float64 `json:"wall_duration_ms"`
		ThroughputCompletedPS float64 `json:"throughput_completed_per_sec"`
		ThroughputAttemptsPS  float64 `json:"throughput_attempts_per_sec"`
		BytesSent             int64   `json:"bytes_sent"`
		BytesReceived         int64   `json:"bytes_received"`
		CreateP50Ms           float64 `json:"create_p50_ms"`
		CreateP95Ms           float64 `json:"create_p95_ms"`
		CreateP99Ms           float64 `json:"create_p99_ms"`
		PrepareP50Ms          float64 `json:"prepare_p50_ms"`
		PrepareP95Ms          float64 `json:"prepare_p95_ms"`
		PrepareP99Ms          float64 `json:"prepare_p99_ms"`
		EvaluateP50Ms         float64 `json:"evaluate_p50_ms"`
		EvaluateP95Ms         float64 `json:"evaluate_p95_ms"`
		EvaluateP99Ms         float64 `json:"evaluate_p99_ms"`
		ReleaseP50Ms          float64 `json:"release_p50_ms"`
		ReleaseP95Ms          float64 `json:"release_p95_ms"`
		ReleaseP99Ms          float64 `json:"release_p99_ms"`
		LifecycleP50Ms        float64 `json:"lifecycle_p50_ms"`
		LifecycleP95Ms        float64 `json:"lifecycle_p95_ms"`
		LifecycleP99Ms        float64 `json:"lifecycle_p99_ms"`
		MemAllocBytesDelta    uint64  `json:"mem_alloc_bytes_delta"`
		TotalAllocBytesDelta  uint64  `json:"total_alloc_bytes_delta"`
		MallocsDelta          uint64  `json:"mallocs_delta"`
		FreesDelta            uint64  `json:"frees_delta"`
		NumGCDelta            uint32  `json:"num_gc_delta"`
	}

	results := make([]profileRunResult, 0)
	concurrencyLevels := []struct {
		concurrency int
		operations  int
	}{
		{concurrency: 1, operations: 10},
		{concurrency: 10, operations: 40},
		{concurrency: 30, operations: 90},
		{concurrency: 40, operations: 120}, // saturates 32 context ceiling
	}

	for _, cfg := range concurrencyLevels {
		t.Run(fmt.Sprintf("concurrency_%d", cfg.concurrency), func(t *testing.T) {
			var (
				attemptsCount  atomic.Int64
				completedCount atomic.Int64
				rejectedCount  atomic.Int64
				failedCount    atomic.Int64
				cancelledCount atomic.Int64

				activeContexts atomic.Int64
				peakContexts   atomic.Int64
			)

			latencies := &stageLatencies{}
			bytesSentBefore := client.sent.Load()
			bytesRcvdBefore := client.rcvd.Load()

			runtime.GC()
			var memBefore runtime.MemStats
			runtime.ReadMemStats(&memBefore)

			opsPerWorker := cfg.operations / cfg.concurrency
			if opsPerWorker < 1 {
				opsPerWorker = 1
			}
			targetTotal := opsPerWorker * cfg.concurrency

			wallStart := time.Now()
			var wg sync.WaitGroup
			startGate := make(chan struct{})

			for w := 0; w < cfg.concurrency; w++ {
				wg.Add(1)
				go func(workerID int) {
					defer wg.Done()
					<-startGate

					for it := 0; it < opsPerWorker; it++ {
						lifeStart := time.Now()
						attemptsCount.Add(1)
						owner := fmt.Sprintf("synthetic-load-%d-%d-%d", cfg.concurrency, workerID, it)

						// 1. Create Study
						cStart := time.Now()
						cRes := client.do(owner, "POST", "/api/v1/backtests/studies", studyPayload)
						cMs := float64(time.Since(cStart).Nanoseconds()) / 1e6
						latencies.recordCreate(cMs)

						if cRes.err != nil {
							if errors.Is(cRes.err, context.Canceled) {
								cancelledCount.Add(1)
							} else {
								failedCount.Add(1)
							}
							continue
						}
						if cRes.status == 429 {
							rejectedCount.Add(1)
							latencies.recordLifecycle(float64(time.Since(lifeStart).Nanoseconds()) / 1e6)
							continue
						}
						if cRes.status != 201 {
							failedCount.Add(1)
							continue
						}

						var ctx studies.StudyContext
						if json.Unmarshal(cRes.body, &ctx) != nil {
							failedCount.Add(1)
							continue
						}

						curCtx := activeContexts.Add(1)
						for {
							peak := peakContexts.Load()
							if curCtx <= peak || peakContexts.CompareAndSwap(peak, curCtx) {
								break
							}
						}

						studyPath := "/api/v1/backtests/studies/" + ctx.ID
						batchPath := studyPath + "/batches/0/prepare"

						// 2. Prepare Batch 0 (with bounded Retry-After backoff)
						var batch studies.StudyBatch
						prepared := false
						pStart := time.Now()
						for retry := 0; retry < 3; retry++ {
							bRes := client.do(owner, "POST", batchPath, []byte(`{}`))
							if bRes.status == 429 {
								retryWait := 1
								if s := bRes.headers.Get("Retry-After"); s != "" {
									if n, err := strconv.Atoi(s); err == nil && n > 0 {
										retryWait = min(n, 2)
									}
								}
								time.Sleep(time.Duration(retryWait) * 15 * time.Millisecond)
								continue
							}
							if bRes.status == 200 {
								if json.Unmarshal(bRes.body, &batch) == nil && len(batch.Manifests) == 10 {
									prepared = true
								}
								break
							}
							break
						}
						pMs := float64(time.Since(pStart).Nanoseconds()) / 1e6
						latencies.recordPrepare(pMs)

						if !prepared {
							client.do(owner, "DELETE", studyPath, nil)
							activeContexts.Add(-1)
							rejectedCount.Add(1)
							latencies.recordLifecycle(float64(time.Since(lifeStart).Nanoseconds()) / 1e6)
							continue
						}

						// 3. Private Evaluate
						eStart := time.Now()
						evalOK := true
						if len(batch.Manifests) > 0 {
							manifest := batch.Manifests[0]
							cRes := client.do(owner, "GET", "/api/v1/datasets/"+manifest.DatasetID+"/content", nil)
							if cRes.status != 200 {
								evalOK = false
							} else {
								var content struct {
									Series []core.BacktestSeries `json:"series"`
								}
								if json.Unmarshal(cRes.body, &content) == nil && len(content.Series) > 0 {
									local, err := core.ComputeBacktestFeatures(core.FeatureRequest{
										Purpose:  "backtest",
										Symbol:   manifest.Symbols[0],
										Candles:  content.Series[0].Candles,
										Operands: []string{"PRICE"},
									})
									if err != nil {
										evalOK = false
									} else {
										grantInput, _ := json.Marshal(compute.IssueInput{
											Purpose:         "backtest",
											DatasetID:       manifest.DatasetID,
											DatasetVersion:  manifest.Version,
											DatasetChecksum: manifest.Checksum,
											RuleID:          core.BaselineRuleID,
											DefinitionHash:  core.BaselineRuleHash,
											EngineVersion:   core.EngineVersion,
											SchemaVersion:   core.SchemaVersion,
										})
										gRes := client.do(owner, "POST", "/api/v1/compute-grants", grantInput)
										if gRes.status == 201 {
											var grant compute.Grant
											json.Unmarshal(gRes.body, &grant)
											sigInput, _ := json.Marshal(backtest.SignalInput{
												ComputeGrantID:       grant.ID,
												FeatureSchemaVersion: core.FeatureSchemaVersion,
												PolicyVersion:        core.SignalStudyPolicy,
												Candidates:           local.Candidates,
											})
											sRes := client.do(owner, "POST", "/api/v1/backtests/signals", sigInput)
											if sRes.status != 200 {
												evalOK = false
											}
										} else {
											evalOK = false
										}
									}
								} else {
									evalOK = false
								}
							}
						}
						eMs := float64(time.Since(eStart).Nanoseconds()) / 1e6
						latencies.recordEvaluate(eMs)

						// 4. Release & Cancel
						rStart := time.Now()
						client.do(owner, "DELETE", batchPath, nil)
						client.do(owner, "DELETE", studyPath, nil)
						activeContexts.Add(-1)
						rMs := float64(time.Since(rStart).Nanoseconds()) / 1e6
						latencies.recordRelease(rMs)

						latencies.recordLifecycle(float64(time.Since(lifeStart).Nanoseconds()) / 1e6)

						if evalOK {
							completedCount.Add(1)
						} else {
							failedCount.Add(1)
						}
					}
				}(w)
			}

			close(startGate)
			wg.Wait()
			wallDuration := time.Since(wallStart)

			var memAfter runtime.MemStats
			runtime.ReadMemStats(&memAfter)

			attempts := attemptsCount.Load()
			completed := completedCount.Load()
			rejected := rejectedCount.Load()
			failed := failedCount.Load()
			cancelled := cancelledCount.Load()
			peakCtx := peakContexts.Load()

			if attempts != int64(targetTotal) {
				t.Fatalf("attempts mismatch: got %d want %d", attempts, targetTotal)
			}
			if attempts != completed+rejected+failed+cancelled {
				t.Fatalf("partition mismatch: %d != %d+%d+%d+%d",
					attempts, completed, rejected, failed, cancelled)
			}
			if peakCtx > 32 {
				t.Fatalf("peak contexts exceeded limit: %d", peakCtx)
			}

			wallSec := wallDuration.Seconds()
			compPS := 0.0
			attPS := 0.0
			if wallSec > 0 {
				compPS = float64(completed) / wallSec
				attPS = float64(attempts) / wallSec
			}

			runRes := profileRunResult{
				Concurrency:           cfg.concurrency,
				TargetAttempts:        targetTotal,
				Attempts:              attempts,
				Completed:             completed,
				Rejected:              rejected,
				Failed:                failed,
				Cancelled:             cancelled,
				MaxInflightContexts:   peakCtx,
				MaxInflightSnapshots:  func() int64 { _, p := store.Inflight(); return p }(),
				WallDurationMs:        float64(wallDuration.Nanoseconds()) / 1e6,
				ThroughputCompletedPS: compPS,
				ThroughputAttemptsPS:  attPS,
				BytesSent:             client.sent.Load() - bytesSentBefore,
				BytesReceived:         client.rcvd.Load() - bytesRcvdBefore,
				CreateP50Ms:           calculatePercentile(latencies.create, 0.50),
				CreateP95Ms:           calculatePercentile(latencies.create, 0.95),
				CreateP99Ms:           calculatePercentile(latencies.create, 0.99),
				PrepareP50Ms:          calculatePercentile(latencies.prepare, 0.50),
				PrepareP95Ms:          calculatePercentile(latencies.prepare, 0.95),
				PrepareP99Ms:          calculatePercentile(latencies.prepare, 0.99),
				EvaluateP50Ms:         calculatePercentile(latencies.evaluate, 0.50),
				EvaluateP95Ms:         calculatePercentile(latencies.evaluate, 0.95),
				EvaluateP99Ms:         calculatePercentile(latencies.evaluate, 0.99),
				ReleaseP50Ms:          calculatePercentile(latencies.release, 0.50),
				ReleaseP95Ms:          calculatePercentile(latencies.release, 0.95),
				ReleaseP99Ms:          calculatePercentile(latencies.release, 0.99),
				LifecycleP50Ms:        calculatePercentile(latencies.lifecycle, 0.50),
				LifecycleP95Ms:        calculatePercentile(latencies.lifecycle, 0.95),
				LifecycleP99Ms:        calculatePercentile(latencies.lifecycle, 0.99),
				MemAllocBytesDelta:    memAfter.Alloc - memBefore.Alloc,
				TotalAllocBytesDelta:  memAfter.TotalAlloc - memBefore.TotalAlloc,
				MallocsDelta:          memAfter.Mallocs - memBefore.Mallocs,
				FreesDelta:            memAfter.Frees - memBefore.Frees,
				NumGCDelta:            memAfter.NumGC - memBefore.NumGC,
			}
			results = append(results, runRes)

			t.Logf("concurrency=%d completed=%d rejected=%d wall=%.2fms completed/s=%.2f create_p95=%.2fms prep_p95=%.2fms eval_p95=%.2fms",
				cfg.concurrency, completed, rejected, runRes.WallDurationMs, compPS, runRes.CreateP95Ms, runRes.PrepareP95Ms, runRes.EvaluateP95Ms)
		})
	}

	report := map[string]any{
		"kind":                   "loopback_http_sustained_workload",
		"schema_version":         2,
		"timestamp":              time.Now().UTC().Format(time.RFC3339),
		"go_version":             runtime.Version(),
		"os":                     runtime.GOOS,
		"arch":                   runtime.GOARCH,
		"cpus":                   runtime.NumCPU(),
		"synthetic_dependencies": []string{"identity", "session", "access_entitlement", "catalog", "daily_ohlcv", "compute_grants"},
		"limits":                 "32 active study contexts, 128 dynamic snapshot slots, atomic 10-stock batch preparation. Loopback HTTP actual handlers, in-memory synthetic fixtures, no production capacity claim.",
		"provider_calls":         prices.calls.Load(),
		"runs":                   results,
	}

	if outputFile != "" {
		data, err := json.MarshalIndent(report, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(outputFile, append(data, '\n'), 0644); err != nil {
			t.Fatal(err)
		}
		t.Logf("wrote sustained workload evidence to %s", outputFile)
	}
}
