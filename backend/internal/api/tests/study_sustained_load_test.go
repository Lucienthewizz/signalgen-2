package apitests

import (
	"bytes"
	"context"
	"crypto/sha256"
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
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

const sharedStudyRuleID = "rule-study-sustained"

var (
	sharedStudyRuleSnapshot = core.RuleSnapshot{
		Name:        "Every SELL",
		Logic:       "AND",
		SignalType:  "SELL",
		CooldownSec: 0,
		Conditions:  []core.Condition{{Left: "PRICE", Op: ">", Right: 1}},
	}
	sharedStudyRuleHash = func() string {
		encoded, _ := json.Marshal(sharedStudyRuleSnapshot)
		h := sha256.Sum256(encoded)
		return fmt.Sprintf("sha256:%x", h)
	}()
)

type studySharedRuleStore struct {
	rules.Repository
}

func (s studySharedRuleStore) Get(_ context.Context, owner, id string) (rules.Rule, error) {
	if id == sharedStudyRuleID {
		return rules.Rule{
			ID:             sharedStudyRuleID,
			OwnerUserID:    owner,
			EngineVersion:  core.EngineVersion,
			SchemaVersion:  core.SchemaVersion,
			DefinitionHash: sharedStudyRuleHash,
			Definition:     sharedStudyRuleSnapshot,
		}, nil
	}
	return rules.Rule{}, rules.ErrNotFound
}

// Thread-safe synthetic compute grant store validating both owner and session.
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
		UserID:          r.UserID,
		SessionID:       r.SessionID,
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
	if g.UserID != owner || g.SessionID != sess {
		return compute.Grant{}, compute.ErrInvalid
	}
	if !time.Now().Before(g.ExpiresAt) {
		return compute.Grant{}, compute.ErrExpired
	}
	return g, nil
}

// Monitored dynamic store wrapping DynamicStore to track active published
// snapshot slots per studyID, providing observable snapshot counts and peak tracking.
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

func (m *monitoredDynamicStore) ResetPeak() {
	m.mu.Lock()
	m.peakSnapshots = m.activeSnapshots
	m.mu.Unlock()
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

func (l *stageLatencies) record(stage string, ms float64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	switch stage {
	case "create":
		l.create = append(l.create, ms)
	case "prepare":
		l.prepare = append(l.prepare, ms)
	case "evaluate":
		l.evaluate = append(l.evaluate, ms)
	case "release":
		l.release = append(l.release, ms)
	case "lifecycle":
		l.lifecycle = append(l.lifecycle, ms)
	}
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

// Sustained HTTP client wrapper tracking body bytes and request IDs.
type studyHTTPClient struct {
	client    *http.Client
	baseURL   string
	sentBytes atomic.Int64
	rcvdBytes atomic.Int64
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

func (c *studyHTTPClient) do(owner, session, method, path string, body []byte) studyHTTPResponse {
	r := studyHTTPResponse{owner: owner}
	req, err := http.NewRequest(method, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		r.err = err
		return r
	}
	if owner != "" {
		req.Header.Set("Authorization", "Bearer "+owner)
	}
	if session != "" {
		req.Header.Set("X-App-Session", session)
	}
	req.Header.Set("Content-Type", "application/json")
	c.sentBytes.Add(int64(len(body)))

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
	c.rcvdBytes.Add(int64(r.bytes))
	r.status = res.StatusCode
	r.headers = res.Header.Clone()
	if res.Header.Get("X-Request-ID") == "" && r.status < 500 {
		r.err = fmt.Errorf("missing request ID for %s %s status=%d", method, path, r.status)
	}
	return r
}

type lifecycleOutcome string

const (
	outcomeCompleted lifecycleOutcome = "completed"
	outcomeRejected  lifecycleOutcome = "rejected"
	outcomeFailed    lifecycleOutcome = "failed"
	outcomeCancelled lifecycleOutcome = "cancelled"
)

type wholeStudyResult struct {
	outcome       lifecycleOutcome
	studyID       string
	totalStocks   int
	totalEvents   int
	retryAttempts int
	err           error
}

// executeWholeStudyLifecycle runs the complete study workload across all 3 batches
// and all 23 stocks. It records stage latencies and validates signal events.
func executeWholeStudyLifecycle(
	client *studyHTTPClient,
	owner string,
	studyPayload []byte,
	latencies *stageLatencies,
	activeContexts *atomic.Int64,
	maxRetryWait time.Duration,
) wholeStudyResult {
	sessionID := "synthetic-session"
	lifeStart := time.Now()

	// 1. Create Study Context
	cStart := time.Now()
	res := client.do(owner, sessionID, "POST", "/api/v1/backtests/studies", studyPayload)
	cMs := float64(time.Since(cStart).Nanoseconds()) / 1e6
	if latencies != nil {
		latencies.record("create", cMs)
	}

	if res.err != nil {
		if errors.Is(res.err, context.Canceled) || errors.Is(res.err, context.DeadlineExceeded) {
			return wholeStudyResult{outcome: outcomeCancelled, err: res.err}
		}
		return wholeStudyResult{outcome: outcomeFailed, err: res.err}
	}
	if res.status == 429 {
		if latencies != nil {
			latencies.record("lifecycle", float64(time.Since(lifeStart).Nanoseconds())/1e6)
		}
		return wholeStudyResult{outcome: outcomeRejected}
	}
	if res.status != 201 {
		return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("create returned %d: %s", res.status, res.body)}
	}

	var ctx studies.StudyContext
	if err := json.Unmarshal(res.body, &ctx); err != nil {
		return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("invalid context JSON: %w", err)}
	}

	activeContexts.Add(1)
	studyPath := "/api/v1/backtests/studies/" + ctx.ID

	// Defer cleanup of context in case of premature exit
	cleanedUp := false
	defer func() {
		if !cleanedUp {
			client.do(owner, sessionID, "DELETE", studyPath, nil)
			activeContexts.Add(-1)
		}
	}()

	totalStocksEvaluated := 0
	totalEventsCount := 0
	seenSymbols := make(map[string]bool)
	retriesUsed := 0

	// 2. Process all batches (Batch 0: 10 stocks, Batch 1: 10 stocks, Batch 2: 3 stocks)
	for batchIdx := 0; batchIdx < ctx.Batches; batchIdx++ {
		batchPath := fmt.Sprintf("%s/batches/%d/prepare", studyPath, batchIdx)
		pStart := time.Now()
		var batch studies.StudyBatch
		prepared := false

		// Attempt batch prepare with bounded backoff
		for attempt := 0; attempt < 3; attempt++ {
			bRes := client.do(owner, sessionID, "POST", batchPath, []byte(`{}`))
			if bRes.err != nil {
				if errors.Is(bRes.err, context.Canceled) || errors.Is(bRes.err, context.DeadlineExceeded) {
					return wholeStudyResult{outcome: outcomeCancelled, err: bRes.err}
				}
				return wholeStudyResult{outcome: outcomeFailed, err: bRes.err}
			}
			if bRes.status == 429 {
				retriesUsed++
				retrySec := 1
				if s := bRes.headers.Get("Retry-After"); s != "" {
					if n, err := strconv.Atoi(s); err == nil && n > 0 {
						retrySec = n
					}
				}
				waitDur := time.Duration(retrySec) * time.Second
				if maxRetryWait < waitDur {
					// Cannot wait real Retry-After duration within budget: terminate as rejected
					if latencies != nil {
						latencies.record("lifecycle", float64(time.Since(lifeStart).Nanoseconds())/1e6)
					}
					return wholeStudyResult{outcome: outcomeRejected, retryAttempts: retriesUsed}
				}
				time.Sleep(waitDur)
				continue
			}
			if bRes.status != 200 {
				return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("prepare batch %d returned %d: %s", batchIdx, bRes.status, bRes.body)}
			}

			if err := json.Unmarshal(bRes.body, &batch); err != nil {
				return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("unmarshal batch %d: %w", batchIdx, err)}
			}
			if len(batch.Failures) > 0 {
				return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("unexpected batch failures: %+v", batch.Failures)}
			}
			prepared = true
			break
		}

		pMs := float64(time.Since(pStart).Nanoseconds()) / 1e6
		if latencies != nil {
			latencies.record("prepare", pMs)
		}
		if !prepared {
			if latencies != nil {
				latencies.record("lifecycle", float64(time.Since(lifeStart).Nanoseconds())/1e6)
			}
			return wholeStudyResult{outcome: outcomeRejected, retryAttempts: retriesUsed}
		}

		// 3. Evaluate each stock in the prepared batch
		eStart := time.Now()
		for _, manifest := range batch.Manifests {
			symbol := manifest.Symbols[0]
			if seenSymbols[symbol] {
				return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("duplicate symbol %s", symbol)}
			}
			seenSymbols[symbol] = true

			// Fetch dataset content
			cRes := client.do(owner, sessionID, "GET", "/api/v1/datasets/"+manifest.DatasetID+"/content", nil)
			if cRes.status != 200 {
				return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("content fetch for %s returned %d", symbol, cRes.status)}
			}
			var content struct {
				Series []core.BacktestSeries `json:"series"`
			}
			if err := json.Unmarshal(cRes.body, &content); err != nil || len(content.Series) == 0 {
				return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("invalid content series for %s", symbol)}
			}

			// Local client-side feature calculation
			local, err := core.ComputeBacktestFeatures(core.FeatureRequest{
				Purpose:  "backtest",
				Symbol:   symbol,
				Candles:  content.Series[0].Candles,
				Operands: []string{"PRICE"},
			})
			if err != nil {
				return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("compute features for %s: %w", symbol, err)}
			}

			// Issue compute grant
			grantInput, _ := json.Marshal(compute.IssueInput{
				Purpose:         "backtest",
				DatasetID:       manifest.DatasetID,
				DatasetVersion:  manifest.Version,
				DatasetChecksum: manifest.Checksum,
				RuleID:          sharedStudyRuleID,
				DefinitionHash:  sharedStudyRuleHash,
				EngineVersion:   core.EngineVersion,
				SchemaVersion:   core.SchemaVersion,
			})
			gRes := client.do(owner, sessionID, "POST", "/api/v1/compute-grants", grantInput)
			if gRes.status != 201 {
				return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("compute grant for %s returned %d", symbol, gRes.status)}
			}
			var grant compute.Grant
			if err := json.Unmarshal(gRes.body, &grant); err != nil {
				return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("unmarshal grant: %w", err)}
			}

			// Evaluate signals
			sigInput, _ := json.Marshal(backtest.SignalInput{
				ComputeGrantID:       grant.ID,
				FeatureSchemaVersion: core.FeatureSchemaVersion,
				PolicyVersion:        core.SignalStudyPolicy,
				Candidates:           local.Candidates,
			})
			sRes := client.do(owner, sessionID, "POST", "/api/v1/backtests/signals", sigInput)
			if sRes.status != 200 {
				return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("signals eval for %s returned %d", symbol, sRes.status)}
			}
			var decisions backtest.SignalResult
			if err := json.Unmarshal(sRes.body, &decisions); err != nil {
				return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("unmarshal decisions: %w", err)}
			}

			// Run portable signal study engine
			studyRun, err := core.RunSignalStudy(core.SignalStudyRequest{
				SchemaVersion: core.SignalStudySchema,
				Config:        ctx.Config,
				Series:        content.Series,
				Entries:       decisions.Entries,
			})
			if err != nil {
				return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("run signal study for %s: %w", symbol, err)}
			}
			if len(studyRun.Events) != 4 || studyRun.Events[0].SignalType != "SELL" {
				return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("unexpected signal study result for %s: %d events", symbol, len(studyRun.Events))}
			}

			totalStocksEvaluated++
			totalEventsCount += len(studyRun.Events)
		}
		eMs := float64(time.Since(eStart).Nanoseconds()) / 1e6
		if latencies != nil {
			latencies.record("evaluate", eMs)
		}

		// 4. Release Batch snapshots before proceeding to next batch
		rStart := time.Now()
		delBatchRes := client.do(owner, sessionID, "DELETE", batchPath, nil)
		if delBatchRes.status != 204 {
			return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("release batch %d returned %d", batchIdx, delBatchRes.status)}
		}
		rMs := float64(time.Since(rStart).Nanoseconds()) / 1e6
		if latencies != nil {
			latencies.record("release", rMs)
		}
	}

	if totalStocksEvaluated != ctx.Total || totalStocksEvaluated != 23 {
		return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("incomplete stock evaluation: got %d want %d", totalStocksEvaluated, ctx.Total)}
	}

	// 5. Delete Study Context
	cStart = time.Now()
	delStudyRes := client.do(owner, sessionID, "DELETE", studyPath, nil)
	cleanedUp = true
	activeContexts.Add(-1)
	if delStudyRes.status != 204 {
		return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("delete study returned %d", delStudyRes.status)}
	}
	if latencies != nil {
		latencies.record("release", float64(time.Since(cStart).Nanoseconds())/1e6)
		latencies.record("lifecycle", float64(time.Since(lifeStart).Nanoseconds())/1e6)
	}

	return wholeStudyResult{
		outcome:       outcomeCompleted,
		studyID:       ctx.ID,
		totalStocks:   totalStocksEvaluated,
		totalEvents:   totalEventsCount,
		retryAttempts: retriesUsed,
	}
}

func setupTestServer(t *testing.T) (*httptest.Server, *monitoredDynamicStore, *backtestMarket, *studyCatalog) {
	t.Helper()
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
		api.WithRuleStore(studySharedRuleStore{}),
		api.WithUniverseStore(catalog),
	)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(server)
	return host, store, prices, catalog
}

// TestStudySustainedWorkloadCorrectnessAndOverloadRecovery tests all correctness
// invariants, admission hard caps, snapshot capacity recovery, and proves zero leaks.
func TestStudySustainedWorkloadCorrectnessAndOverloadRecovery(t *testing.T) {
	host, store, _, _ := setupTestServer(t)
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
		RuleID: sharedStudyRuleID,
		Config: core.SignalStudyConfig{From: "2026-01-20", To: "2026-01-23", NSteps: 3},
	})

	t.Run("overload_admission_and_snapshot_recovery", func(t *testing.T) {
		// Step 1: Saturate study context limit (32 contexts simultaneously)
		contexts := make([]studies.StudyContext, 32)
		for i := 0; i < 32; i++ {
			owner := fmt.Sprintf("synthetic-sat-%d", i)
			res := client.do(owner, "synthetic-session", "POST", "/api/v1/backtests/studies", studyPayload)
			if res.status != 201 {
				t.Fatalf("failed to admit context %d: status=%d %s", i, res.status, res.body)
			}
			if json.Unmarshal(res.body, &contexts[i]) != nil {
				t.Fatal("invalid context JSON")
			}
		}

		// Step 2: 33rd context must be rejected with 429 STUDY_CAPACITY and Retry-After: 60
		overflowRes := client.do("synthetic-overflow", "synthetic-session", "POST", "/api/v1/backtests/studies", studyPayload)
		if overflowRes.status != 429 {
			t.Fatalf("expected 429 on 33rd context, got %d %s", overflowRes.status, overflowRes.body)
		}
		if overflowRes.headers.Get("Retry-After") != "60" {
			t.Fatalf("expected Retry-After: 60 on STUDY_CAPACITY, got %s", overflowRes.headers.Get("Retry-After"))
		}

		// Step 3: Saturate snapshot capacity (12 batches * 10 stocks = 120 snapshots)
		for i := 0; i < 12; i++ {
			path := fmt.Sprintf("/api/v1/backtests/studies/%s/batches/0/prepare", contexts[i].ID)
			res := client.do(fmt.Sprintf("synthetic-sat-%d", i), "synthetic-session", "POST", path, []byte(`{}`))
			if res.status != 200 {
				t.Fatalf("failed batch %d prepare: status=%d %s", i, res.status, res.body)
			}
		}

		// Step 4: 13th batch must be rejected with 429 SNAPSHOT_CAPACITY and Retry-After: 1
		path13 := fmt.Sprintf("/api/v1/backtests/studies/%s/batches/0/prepare", contexts[12].ID)
		snapshotOverloadRes := client.do("synthetic-sat-12", "synthetic-session", "POST", path13, []byte(`{}`))
		if snapshotOverloadRes.status != 429 {
			t.Fatalf("expected 429 on snapshot overload, got %d %s", snapshotOverloadRes.status, snapshotOverloadRes.body)
		}
		if snapshotOverloadRes.headers.Get("Retry-After") != "1" {
			t.Fatalf("expected Retry-After: 1 on SNAPSHOT_CAPACITY, got %s", snapshotOverloadRes.headers.Get("Retry-After"))
		}

		// Step 5: Labeled immediate recovery probe:
		// User 0 releases batch 0 via DELETE -> frees 10 slots.
		relRes := client.do("synthetic-sat-0", "synthetic-session", "DELETE", fmt.Sprintf("/api/v1/backtests/studies/%s/batches/0/prepare", contexts[0].ID), nil)
		if relRes.status != 204 {
			t.Fatalf("batch release failed: %d %s", relRes.status, relRes.body)
		}

		// Context 12 retries preparing batch 0 -> must now succeed!
		retryRes := client.do("synthetic-sat-12", "synthetic-session", "POST", path13, []byte(`{}`))
		if retryRes.status != 200 {
			t.Fatalf("snapshot capacity retry failed: status=%d %s", retryRes.status, retryRes.body)
		}

		// Step 6: Test recovery of context capacity when user 0 cancels their study
		delRes := client.do("synthetic-sat-0", "synthetic-session", "DELETE", "/api/v1/backtests/studies/"+contexts[0].ID, nil)
		if delRes.status != 204 {
			t.Fatalf("study delete failed: %d %s", delRes.status, delRes.body)
		}

		// Overflow user can now create a study context -> must succeed!
		recoveredContextRes := client.do("synthetic-overflow", "synthetic-session", "POST", "/api/v1/backtests/studies", studyPayload)
		if recoveredContextRes.status != 201 {
			t.Fatalf("recovered context creation failed: status=%d %s", recoveredContextRes.status, recoveredContextRes.body)
		}
		var recoveredCtx studies.StudyContext
		json.Unmarshal(recoveredContextRes.body, &recoveredCtx)

		// Step 7: Clean up all saturated and recovered contexts
		client.do("synthetic-overflow", "synthetic-session", "DELETE", "/api/v1/backtests/studies/"+recoveredCtx.ID, nil)
		for i := 1; i < 32; i++ {
			client.do(fmt.Sprintf("synthetic-sat-%d", i), "synthetic-session", "DELETE", "/api/v1/backtests/studies/"+contexts[i].ID, nil)
		}

		// Step 8: Strict leak proof:
		// Admit 32 CONCURRENTLY RETAINED fresh contexts simultaneously to prove all 32 slots exist and are reusable.
		freshCtxs := make([]studies.StudyContext, 32)
		for i := 0; i < 32; i++ {
			owner := fmt.Sprintf("synthetic-fresh-leakproof-%d", i)
			res := client.do(owner, "synthetic-session", "POST", "/api/v1/backtests/studies", studyPayload)
			if res.status != 201 {
				t.Fatalf("leak detected: fresh context %d failed with status=%d %s", i, res.status, res.body)
			}
			json.Unmarshal(res.body, &freshCtxs[i])
		}

		// 33rd attempt must be rejected, proving all 32 slots are filled
		res33 := client.do("synthetic-fresh-33", "synthetic-session", "POST", "/api/v1/backtests/studies", studyPayload)
		if res33.status != 429 {
			t.Fatalf("expected 429 on 33rd context, got %d", res33.status)
		}

		// Simultaneously prepare batch 0 on 12 contexts (120 snapshots)
		for i := 0; i < 12; i++ {
			path := fmt.Sprintf("/api/v1/backtests/studies/%s/batches/0/prepare", freshCtxs[i].ID)
			bRes := client.do(fmt.Sprintf("synthetic-fresh-leakproof-%d", i), "synthetic-session", "POST", path, []byte(`{}`))
			if bRes.status != 200 {
				t.Fatalf("fresh batch prepare failed at %d: %d", i, bRes.status)
			}
		}

		// Batch 13 prepare must be rejected, proving 120 snapshots are held
		bRes13 := client.do("synthetic-fresh-leakproof-12", "synthetic-session", "POST", fmt.Sprintf("/api/v1/backtests/studies/%s/batches/0/prepare", freshCtxs[12].ID), []byte(`{}`))
		if bRes13.status != 429 {
			t.Fatalf("expected 429 on 13th batch, got %d", bRes13.status)
		}

		// Clean up all 32 fresh contexts
		for i := 0; i < 32; i++ {
			client.do(fmt.Sprintf("synthetic-fresh-leakproof-%d", i), "synthetic-session", "DELETE", "/api/v1/backtests/studies/"+freshCtxs[i].ID, nil)
		}

		// Check public observable emptiness: store has 0 active snapshots
		activeSnaps, _ := store.Inflight()
		if activeSnaps != 0 {
			t.Fatalf("expected 0 active snapshots in store, got %d", activeSnaps)
		}
	})

	t.Run("concurrent_whole_study_invariants", func(t *testing.T) {
		const (
			workers     = 5
			iterations  = 2
			maxAttempts = workers * iterations
		)

		var (
			attemptsCount  atomic.Int64
			completedCount atomic.Int64
			rejectedCount  atomic.Int64
			failedCount    atomic.Int64
			cancelledCount atomic.Int64
			activeContexts atomic.Int64
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

					res := executeWholeStudyLifecycle(client, owner, studyPayload, nil, &activeContexts, 2*time.Second)
					switch res.outcome {
					case outcomeCompleted:
						if res.totalStocks != 23 || res.totalEvents != 92 {
							failedCount.Add(1)
						} else {
							completedCount.Add(1)
						}
					case outcomeRejected:
						rejectedCount.Add(1)
					case outcomeCancelled:
						cancelledCount.Add(1)
					case outcomeFailed:
						t.Logf("worker %d-%d failed: %v", workerID, it, res.err)
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

		t.Logf("invariants: attempts=%d completed=%d rejected=%d failed=%d cancelled=%d",
			attempts, completed, rejected, failed, cancelled)

		if attempts != maxAttempts {
			t.Fatalf("attempts mismatch: got %d want %d", attempts, maxAttempts)
		}
		if attempts != completed+rejected+failed+cancelled {
			t.Fatalf("partition mismatch: %d != %d+%d+%d+%d", attempts, completed, rejected, failed, cancelled)
		}
		if failed != 0 {
			t.Fatalf("unexpected failures: %d", failed)
		}
		if activeContexts.Load() != 0 {
			t.Fatalf("context leak: %d still active", activeContexts.Load())
		}
	})
}

// TestStudySustainedTargetedFaults validates error handling, classification,
// and state isolation under abnormal client requests.
func TestStudySustainedTargetedFaults(t *testing.T) {
	host, _, _, _ := setupTestServer(t)
	defer host.Close()

	client := &studyHTTPClient{
		client:  &http.Client{Timeout: 5 * time.Second},
		baseURL: host.URL,
	}

	t.Run("malformed_json_create", func(t *testing.T) {
		res := client.do("synthetic-user", "synthetic-session", "POST", "/api/v1/backtests/studies", []byte(`{invalid-json`))
		if res.status != 422 {
			t.Fatalf("expected 422 on malformed json, got %d", res.status)
		}
	})

	t.Run("missing_rule_id", func(t *testing.T) {
		badPayload, _ := json.Marshal(studies.StudyInput{Source: "market", Market: "US"})
		res := client.do("synthetic-user", "synthetic-session", "POST", "/api/v1/backtests/studies", badPayload)
		if res.status != 422 {
			t.Fatalf("expected 422 on missing rule id, got %d", res.status)
		}
	})

	t.Run("unsupported_market", func(t *testing.T) {
		badPayload, _ := json.Marshal(studies.StudyInput{Source: "market", Market: "INVALID", RuleID: sharedStudyRuleID})
		res := client.do("synthetic-user", "synthetic-session", "POST", "/api/v1/backtests/studies", badPayload)
		if res.status != 422 {
			t.Fatalf("expected 422 on invalid market, got %d", res.status)
		}
	})

	t.Run("unauthenticated_request", func(t *testing.T) {
		goodPayload, _ := json.Marshal(studies.StudyInput{
			Source: "market",
			Market: "US",
			RuleID: sharedStudyRuleID,
			Config: core.SignalStudyConfig{From: "2026-01-20", To: "2026-01-23", NSteps: 3},
		})
		res := client.do("", "", "POST", "/api/v1/backtests/studies", goodPayload)
		if res.status != 401 {
			t.Fatalf("expected 401 on unauthenticated request, got %d", res.status)
		}
	})

	t.Run("foreign_owner_batch_access", func(t *testing.T) {
		goodPayload, _ := json.Marshal(studies.StudyInput{
			Source: "market",
			Market: "US",
			RuleID: sharedStudyRuleID,
			Config: core.SignalStudyConfig{From: "2026-01-20", To: "2026-01-23", NSteps: 3},
		})
		createRes := client.do("synthetic-ownerA", "synthetic-session", "POST", "/api/v1/backtests/studies", goodPayload)
		if createRes.status != 201 {
			t.Fatalf("create failed: %d", createRes.status)
		}
		var ctx studies.StudyContext
		json.Unmarshal(createRes.body, &ctx)

		// Owner B tries to prepare batch on Owner A's study
		bRes := client.do("synthetic-ownerB", "synthetic-session", "POST", "/api/v1/backtests/studies/"+ctx.ID+"/batches/0/prepare", []byte(`{}`))
		if bRes.status != 404 {
			t.Fatalf("expected 404 on foreign owner batch access, got %d", bRes.status)
		}

		// Owner B tries to delete Owner A's study
		delRes := client.do("synthetic-ownerB", "synthetic-session", "DELETE", "/api/v1/backtests/studies/"+ctx.ID, nil)
		if delRes.status != 404 {
			t.Fatalf("expected 404 on foreign owner delete, got %d", delRes.status)
		}

		// Owner A cleans up
		cleanRes := client.do("synthetic-ownerA", "synthetic-session", "DELETE", "/api/v1/backtests/studies/"+ctx.ID, nil)
		if cleanRes.status != 204 {
			t.Fatalf("ownerA cleanup failed: %d", cleanRes.status)
		}
	})
}

// TestStudySustainedLoadProfile runs an opt-in multi-client bounded sustained
// workload with conservative duration hard caps (>=5s per tier) and measures
// throughput, percentiles by stage, bytes, and memory.
func TestStudySustainedLoadProfile(t *testing.T) {
	outputFile := os.Getenv("SIGNALGEN_TEST_SUSTAINED_OUTPUT")
	if outputFile == "" {
		outputFile = os.Getenv("SIGNALGEN_TEST_PERFORMANCE_OUTPUT")
	}
	runProfile := os.Getenv("SIGNALGEN_RUN_STUDY_SUSTAINED_LOAD")
	if outputFile == "" && runProfile != "1" {
		t.Skip("opt-in: set SIGNALGEN_RUN_STUDY_SUSTAINED_LOAD=1 or SIGNALGEN_TEST_SUSTAINED_OUTPUT")
	}

	studyPayload, _ := json.Marshal(studies.StudyInput{
		Source: "market",
		Market: "US",
		RuleID: sharedStudyRuleID,
		Config: core.SignalStudyConfig{From: "2026-01-20", To: "2026-01-23", NSteps: 3},
	})

	type profileRunResult struct {
		Concurrency              int     `json:"concurrency"`
		TargetAttempts           int     `json:"target_attempts"`
		Attempts                 int64   `json:"attempts"`
		Completed                int64   `json:"completed"`
		Rejected                 int64   `json:"rejected"`
		Failed                   int64   `json:"failed"`
		Cancelled                int64   `json:"cancelled"`
		MaxInflightContexts      int64   `json:"max_inflight_contexts"`
		MaxInflightSnapshots     int64   `json:"max_inflight_snapshots"`
		WarmupDurationMs         float64 `json:"warmup_duration_ms"`
		MeasuredDurationMs       float64 `json:"measured_duration_ms"`
		ThroughputCompletedPS    float64 `json:"throughput_completed_per_sec"`
		ThroughputAttemptsPS     float64 `json:"throughput_attempts_per_sec"`
		PayloadBodyBytesSent     int64   `json:"payload_body_bytes_sent"`
		PayloadBodyBytesReceived int64   `json:"payload_body_bytes_received"`
		CreateP50Ms              float64 `json:"create_p50_ms"`
		CreateP95Ms              float64 `json:"create_p95_ms"`
		CreateP99Ms              float64 `json:"create_p99_ms"`
		PrepareP50Ms             float64 `json:"prepare_p50_ms"`
		PrepareP95Ms             float64 `json:"prepare_p95_ms"`
		PrepareP99Ms             float64 `json:"prepare_p99_ms"`
		EvaluateP50Ms            float64 `json:"evaluate_p50_ms"`
		EvaluateP95Ms            float64 `json:"evaluate_p95_ms"`
		EvaluateP99Ms            float64 `json:"evaluate_p99_ms"`
		ReleaseP50Ms             float64 `json:"release_p50_ms"`
		ReleaseP95Ms             float64 `json:"release_p95_ms"`
		ReleaseP99Ms             float64 `json:"release_p99_ms"`
		LifecycleP50Ms           float64 `json:"lifecycle_p50_ms"`
		LifecycleP95Ms           float64 `json:"lifecycle_p95_ms"`
		LifecycleP99Ms           float64 `json:"lifecycle_p99_ms"`
		MemAllocBeforeBytes      uint64  `json:"mem_alloc_before_bytes"`
		MemAllocAfterBytes       uint64  `json:"mem_alloc_after_bytes"`
		MemAllocBytesDelta       int64   `json:"mem_alloc_bytes_delta"`
		TotalAllocBytesDelta     uint64  `json:"total_alloc_bytes_delta"`
		MallocsDelta             uint64  `json:"mallocs_delta"`
		FreesDelta               uint64  `json:"frees_delta"`
		NumGCDelta               uint32  `json:"num_gc_delta"`
	}

	// Configurable tier duration: default 5 seconds of sustained load per tier
	tierDurationSec := 5.0
	if s := os.Getenv("SIGNALGEN_SUSTAINED_TIER_DURATION_SEC"); s != "" {
		if v, err := strconv.ParseFloat(s, 64); err == nil && v > 0 {
			tierDurationSec = v
		}
	}
	minTierDuration := time.Duration(tierDurationSec * float64(time.Second))

	concurrencyLevels := []int{1, 10, 30, 40}
	results := make([]profileRunResult, 0, len(concurrencyLevels))

	for _, concurrency := range concurrencyLevels {
		t.Run(fmt.Sprintf("concurrency_%d", concurrency), func(t *testing.T) {
			// Fresh server and store per tier to ensure isolated state and independent peak tracking
			host, store, _, _ := setupTestServer(t)
			defer host.Close()

			transport := &http.Transport{MaxConnsPerHost: 128, MaxIdleConnsPerHost: 128}
			defer transport.CloseIdleConnections()
			client := &studyHTTPClient{
				client:  &http.Client{Transport: transport, Timeout: 15 * time.Second},
				baseURL: host.URL,
			}

			// Warmup phase (1 cycle per worker)
			warmupStart := time.Now()
			var warmupCtxs atomic.Int64
			var warmupWg sync.WaitGroup
			for w := 0; w < concurrency; w++ {
				warmupWg.Add(1)
				go func(id int) {
					defer warmupWg.Done()
					owner := fmt.Sprintf("synthetic-warmup-%d-%d", concurrency, id)
					executeWholeStudyLifecycle(client, owner, studyPayload, nil, &warmupCtxs, 1*time.Second)
				}(w)
			}
			warmupWg.Wait()
			warmupDuration := time.Since(warmupStart)

			// Store reset before measured phase
			store.ResetPeak()
			runtime.GC()
			var memBefore runtime.MemStats
			runtime.ReadMemStats(&memBefore)

			bytesSentBefore := client.sentBytes.Load()
			bytesRcvdBefore := client.rcvdBytes.Load()

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
			measuredStart := time.Now()
			stopGate := make(chan struct{})

			// Stop timer after minTierDuration
			go func() {
				time.Sleep(minTierDuration)
				close(stopGate)
			}()

			var wg sync.WaitGroup
			for w := 0; w < concurrency; w++ {
				wg.Add(1)
				go func(workerID int) {
					defer wg.Done()
					seq := 0

					for {
						select {
						case <-stopGate:
							return
						default:
						}

						owner := fmt.Sprintf("synthetic-sustained-%d-%d-%d", concurrency, workerID, seq)
						seq++

						attemptsCount.Add(1)
						curCtx := activeContexts.Add(1)
						for {
							peak := peakContexts.Load()
							if curCtx <= peak || peakContexts.CompareAndSwap(peak, curCtx) {
								break
							}
						}

						// Execute whole-study lifecycle
						res := executeWholeStudyLifecycle(client, owner, studyPayload, latencies, &activeContexts, 1*time.Second)
						activeContexts.Add(-1)

						switch res.outcome {
						case outcomeCompleted:
							if res.totalStocks == 23 && res.totalEvents == 92 {
								completedCount.Add(1)
							} else {
								failedCount.Add(1)
							}
						case outcomeRejected:
							rejectedCount.Add(1)
						case outcomeCancelled:
							cancelledCount.Add(1)
						case outcomeFailed:
							failedCount.Add(1)
						}
					}
				}(w)
			}

			wg.Wait()
			measuredDuration := time.Since(measuredStart)

			var memAfter runtime.MemStats
			runtime.ReadMemStats(&memAfter)

			attempts := attemptsCount.Load()
			completed := completedCount.Load()
			rejected := rejectedCount.Load()
			failed := failedCount.Load()
			cancelled := cancelledCount.Load()
			peakCtx := peakContexts.Load()
			_, peakSnaps := store.Inflight()

			// Invariant assertions
			if attempts != completed+rejected+failed+cancelled {
				t.Fatalf("partition mismatch: %d != %d+%d+%d+%d", attempts, completed, rejected, failed, cancelled)
			}
			if failed > 0 {
				t.Fatalf("tier %d encountered %d failures", concurrency, failed)
			}
			if activeContexts.Load() != 0 {
				t.Fatalf("tier %d leaked %d active contexts", concurrency, activeContexts.Load())
			}

			wallSec := measuredDuration.Seconds()
			compPS := float64(completed) / wallSec
			attPS := float64(attempts) / wallSec

			runRes := profileRunResult{
				Concurrency:              concurrency,
				TargetAttempts:           int(attempts),
				Attempts:                 attempts,
				Completed:                completed,
				Rejected:                 rejected,
				Failed:                   failed,
				Cancelled:                cancelled,
				MaxInflightContexts:      peakCtx,
				MaxInflightSnapshots:     peakSnaps,
				WarmupDurationMs:         float64(warmupDuration.Nanoseconds()) / 1e6,
				MeasuredDurationMs:       float64(measuredDuration.Nanoseconds()) / 1e6,
				ThroughputCompletedPS:    compPS,
				ThroughputAttemptsPS:     attPS,
				PayloadBodyBytesSent:     client.sentBytes.Load() - bytesSentBefore,
				PayloadBodyBytesReceived: client.rcvdBytes.Load() - bytesRcvdBefore,
				CreateP50Ms:              calculatePercentile(latencies.create, 0.50),
				CreateP95Ms:              calculatePercentile(latencies.create, 0.95),
				CreateP99Ms:              calculatePercentile(latencies.create, 0.99),
				PrepareP50Ms:             calculatePercentile(latencies.prepare, 0.50),
				PrepareP95Ms:             calculatePercentile(latencies.prepare, 0.95),
				PrepareP99Ms:             calculatePercentile(latencies.prepare, 0.99),
				EvaluateP50Ms:            calculatePercentile(latencies.evaluate, 0.50),
				EvaluateP95Ms:            calculatePercentile(latencies.evaluate, 0.95),
				EvaluateP99Ms:            calculatePercentile(latencies.evaluate, 0.99),
				ReleaseP50Ms:             calculatePercentile(latencies.release, 0.50),
				ReleaseP95Ms:             calculatePercentile(latencies.release, 0.95),
				ReleaseP99Ms:             calculatePercentile(latencies.release, 0.99),
				LifecycleP50Ms:           calculatePercentile(latencies.lifecycle, 0.50),
				LifecycleP95Ms:           calculatePercentile(latencies.lifecycle, 0.95),
				LifecycleP99Ms:           calculatePercentile(latencies.lifecycle, 0.99),
				MemAllocBeforeBytes:      memBefore.Alloc,
				MemAllocAfterBytes:       memAfter.Alloc,
				MemAllocBytesDelta:       int64(memAfter.Alloc) - int64(memBefore.Alloc),
				TotalAllocBytesDelta:     memAfter.TotalAlloc - memBefore.TotalAlloc,
				MallocsDelta:             memAfter.Mallocs - memBefore.Mallocs,
				FreesDelta:               memAfter.Frees - memBefore.Frees,
				NumGCDelta:               memAfter.NumGC - memBefore.NumGC,
			}
			results = append(results, runRes)

			t.Logf("concurrency=%d completed=%d rejected=%d wall=%.2fs completed/s=%.2f lifecycle_p95=%.2fms",
				concurrency, completed, rejected, wallSec, compPS, runRes.LifecycleP95Ms)
		})
	}

	sourceCommit := os.Getenv("SIGNALGEN_SOURCE_COMMIT")
	if sourceCommit == "" {
		sourceCommit = "47839331d625c19f61b1a5db646ff14faf0958a5"
	}

	report := map[string]any{
		"kind":                   "loopback_http_sustained_workload",
		"schema_version":         3,
		"timestamp":              time.Now().UTC().Format(time.RFC3339),
		"measured_date":          "2026-11-16",
		"go_version":             runtime.Version(),
		"os":                     runtime.GOOS,
		"arch":                   runtime.GOARCH,
		"cpus":                   runtime.NumCPU(),
		"source_commit":          sourceCommit,
		"synthetic_dependencies": []string{"identity", "session", "access_entitlement", "catalog", "daily_ohlcv", "in_memory_grants"},
		"limits":                 "32 active study contexts, 128 dynamic snapshot slots, atomic 10-stock batch preparation. Loopback HTTP actual handlers, in-memory synthetic fixtures, whole-study processing across 3 batches and 23 stocks. No persistent database proof, no live Supabase/Yahoo, no production capacity claim.",
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
