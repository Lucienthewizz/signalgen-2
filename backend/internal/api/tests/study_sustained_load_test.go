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
	"strings"
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

// Admitted-only context tracker. ONLY increments when a context is actually admitted (status 201).
// Decrements when a context is verified deleted (status 204). Tracks real server-held context peaks.
type admittedContextTracker struct {
	mu     sync.Mutex
	active int64
	peak   int64
}

func (t *admittedContextTracker) recordAdmitted() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.active++
	if t.active > t.peak {
		t.peak = t.active
	}
}

func (t *admittedContextTracker) recordReleased() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.active--
}

func (t *admittedContextTracker) activeCount() int64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.active
}

func (t *admittedContextTracker) peakCount() int64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.peak
}

// Stage-level latency tracking helper.
type stageLatencies struct {
	mu                 sync.Mutex
	create             []float64
	prepare            []float64
	evaluateStock      []float64
	evaluateBatch      []float64
	release            []float64
	attempt            []float64
	rejectedAdmission  []float64
	rejectedBatch      []float64
	completedLifecycle []float64
}

func (l *stageLatencies) record(stage string, ms float64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	switch stage {
	case "create":
		l.create = append(l.create, ms)
	case "prepare":
		l.prepare = append(l.prepare, ms)
	case "evaluate_stock":
		l.evaluateStock = append(l.evaluateStock, ms)
	case "evaluate_batch":
		l.evaluateBatch = append(l.evaluateBatch, ms)
	case "release":
		l.release = append(l.release, ms)
	case "attempt":
		l.attempt = append(l.attempt, ms)
	case "rejected_admission":
		l.rejectedAdmission = append(l.rejectedAdmission, ms)
	case "rejected_batch":
		l.rejectedBatch = append(l.rejectedBatch, ms)
	case "completed_lifecycle":
		l.completedLifecycle = append(l.completedLifecycle, ms)
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
	faultHook func(method, path string) *studyHTTPResponse
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
	if c.faultHook != nil {
		if injected := c.faultHook(method, path); injected != nil {
			r := *injected
			r.owner = owner
			return r
		}
	}
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
	checksum      string
	retryAfterSec int
	retryAttempts int
	err           error
}

// Canonical deterministic fixture oracle: validates that for a given symbol,
// exactly 4 SELL events were generated at the expected dates and prices.
func verifyStockStudyOracle(symbol string, events []core.StudyEvent) error {
	if len(events) != 4 {
		return fmt.Errorf("symbol %s: expected 4 events, got %d", symbol, len(events))
	}
	expectedDates := []string{
		"2026-01-20T00:00:00Z",
		"2026-01-21T00:00:00Z",
		"2026-01-22T00:00:00Z",
		"2026-01-23T00:00:00Z",
	}
	expectedPrices := []float64{191.0, 192.0, 193.0, 194.0}
	for i, ev := range events {
		if ev.Symbol != symbol {
			return fmt.Errorf("symbol %s event %d: symbol mismatch: got %s", symbol, i, ev.Symbol)
		}
		if ev.SignalType != "SELL" {
			return fmt.Errorf("symbol %s event %d: expected SELL, got %s", symbol, i, ev.SignalType)
		}
		if ev.Timestamp != expectedDates[i] {
			return fmt.Errorf("symbol %s event %d: date mismatch: got %s want %s", symbol, i, ev.Timestamp, expectedDates[i])
		}
		if ev.ReferencePrice != expectedPrices[i] {
			return fmt.Errorf("symbol %s event %d: price mismatch: got %.2f want %.2f", symbol, i, ev.ReferencePrice, expectedPrices[i])
		}
	}
	return nil
}

func computeStudyEventsChecksum(events []core.StudyEvent) string {
	h := sha256.New()
	for _, ev := range events {
		fmt.Fprintf(h, "%s|%s|%s|%.2f\n", ev.Symbol, ev.SignalType, ev.Timestamp, ev.ReferencePrice)
	}
	return fmt.Sprintf("sha256:%x", h.Sum(nil))
}

// executeWholeStudyLifecycle runs the complete study workload across all 3 batches
// and all 23 stocks. It records stage latencies and validates signal events against the oracle.
func executeWholeStudyLifecycle(
	client *studyHTTPClient,
	owner string,
	studyPayload []byte,
	latencies *stageLatencies,
	tracker *admittedContextTracker,
	maxRetryWait time.Duration,
) wholeStudyResult {
	sessionID := "synthetic-session"

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
		retrySec := 60
		if s := res.headers.Get("Retry-After"); s != "" {
			if n, err := strconv.Atoi(s); err == nil && n > 0 {
				retrySec = n
			}
		}
		return wholeStudyResult{outcome: outcomeRejected, retryAfterSec: retrySec}
	}
	if res.status != 201 {
		return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("create returned %d: %s", res.status, res.body)}
	}

	var ctx studies.StudyContext
	if err := json.Unmarshal(res.body, &ctx); err != nil {
		return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("invalid context JSON: %w", err)}
	}

	studyPath := "/api/v1/backtests/studies/" + ctx.ID
	admitted := true
	released := false

	if tracker != nil {
		tracker.recordAdmitted()
	}

	// Defer cleanup of context in case of premature exit
	defer func() {
		if admitted && !released {
			delRes := client.do(owner, sessionID, "DELETE", studyPath, nil)
			if delRes.status == 204 {
				released = true
				if tracker != nil {
					tracker.recordReleased()
				}
			}
		}
	}()

	totalStocksEvaluated := 0
	seenSymbols := make(map[string]bool)
	allEvents := make([]core.StudyEvent, 0, 92)
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
					return wholeStudyResult{outcome: outcomeRejected, retryAfterSec: retrySec, retryAttempts: retriesUsed}
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
			return wholeStudyResult{outcome: outcomeRejected, retryAfterSec: 1, retryAttempts: retriesUsed}
		}

		// 3. Evaluate each stock in the prepared batch
		batchEvalStart := time.Now()
		for _, manifest := range batch.Manifests {
			symbol := manifest.Symbols[0]
			if seenSymbols[symbol] {
				return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("duplicate symbol %s", symbol)}
			}
			seenSymbols[symbol] = true

			stockEvalStart := time.Now()

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

			// Deterministic oracle validation for this stock
			if err := verifyStockStudyOracle(symbol, studyRun.Events); err != nil {
				return wholeStudyResult{outcome: outcomeFailed, err: err}
			}

			stockEvalMs := float64(time.Since(stockEvalStart).Nanoseconds()) / 1e6
			if latencies != nil {
				latencies.record("evaluate_stock", stockEvalMs)
			}

			totalStocksEvaluated++
			allEvents = append(allEvents, studyRun.Events...)
		}

		batchEvalMs := float64(time.Since(batchEvalStart).Nanoseconds()) / 1e6
		if latencies != nil {
			latencies.record("evaluate_batch", batchEvalMs)
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
	if delStudyRes.status != 204 {
		return wholeStudyResult{outcome: outcomeFailed, err: fmt.Errorf("delete study returned %d", delStudyRes.status)}
	}
	released = true
	if tracker != nil {
		tracker.recordReleased()
	}
	if latencies != nil {
		latencies.record("release", float64(time.Since(cStart).Nanoseconds())/1e6)
	}

	checksum := computeStudyEventsChecksum(allEvents)
	return wholeStudyResult{
		outcome:       outcomeCompleted,
		studyID:       ctx.ID,
		totalStocks:   totalStocksEvaluated,
		totalEvents:   len(allEvents),
		checksum:      checksum,
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

// Proves fresh 32 retained contexts and 12 held batches capacity after any test run.
func assertFullCapacityAndZeroLeaks(t *testing.T, client *studyHTTPClient, store *monitoredDynamicStore, studyPayload []byte) {
	t.Helper()

	// 1. Store active snapshots must be 0
	activeSnaps, _ := store.Inflight()
	if activeSnaps != 0 {
		t.Fatalf("leak proof: expected 0 active snapshots, got %d", activeSnaps)
	}

	// 2. Concurrently admit 32 fresh retained contexts
	freshCtxs := make([]studies.StudyContext, 32)
	for i := 0; i < 32; i++ {
		owner := fmt.Sprintf("synthetic-cap-check-%d", i)
		res := client.do(owner, "synthetic-session", "POST", "/api/v1/backtests/studies", studyPayload)
		if res.status != 201 {
			t.Fatalf("leak proof: failed to admit fresh context %d: status=%d %s", i, res.status, res.body)
		}
		if err := json.Unmarshal(res.body, &freshCtxs[i]); err != nil {
			t.Fatalf("leak proof: unmarshal fresh context %d: %v", i, err)
		}
	}

	// 33rd attempt must be rejected with HTTP 429 STUDY_CAPACITY and Retry-After: 60
	res33 := client.do("synthetic-cap-overflow", "synthetic-session", "POST", "/api/v1/backtests/studies", studyPayload)
	if res33.status != 429 {
		t.Fatalf("leak proof: expected 429 on 33rd context, got %d %s", res33.status, res33.body)
	}
	if res33.headers.Get("Retry-After") != "60" {
		t.Fatalf("leak proof: expected Retry-After: 60, got %s", res33.headers.Get("Retry-After"))
	}

	// 3. Simultaneously prepare batch 0 across 12 contexts (120 snapshots)
	for i := 0; i < 12; i++ {
		path := fmt.Sprintf("/api/v1/backtests/studies/%s/batches/0/prepare", freshCtxs[i].ID)
		bRes := client.do(fmt.Sprintf("synthetic-cap-check-%d", i), "synthetic-session", "POST", path, []byte(`{}`))
		if bRes.status != 200 {
			t.Fatalf("leak proof: batch prepare failed at %d: %d %s", i, bRes.status, bRes.body)
		}
	}

	// 13th batch must be rejected with HTTP 429 SNAPSHOT_CAPACITY and Retry-After: 1
	path13 := fmt.Sprintf("/api/v1/backtests/studies/%s/batches/0/prepare", freshCtxs[12].ID)
	bRes13 := client.do("synthetic-cap-check-12", "synthetic-session", "POST", path13, []byte(`{}`))
	if bRes13.status != 429 {
		t.Fatalf("leak proof: expected 429 on 13th batch, got %d %s", bRes13.status, bRes13.body)
	}
	if bRes13.headers.Get("Retry-After") != "1" {
		t.Fatalf("leak proof: expected Retry-After: 1, got %s", bRes13.headers.Get("Retry-After"))
	}

	// 4. Clean up all 32 fresh contexts, asserting HTTP 204 on every single one
	for i := 0; i < 32; i++ {
		delRes := client.do(fmt.Sprintf("synthetic-cap-check-%d", i), "synthetic-session", "DELETE", "/api/v1/backtests/studies/"+freshCtxs[i].ID, nil)
		if delRes.status != 204 {
			t.Fatalf("leak proof: failed to delete fresh context %d: status=%d %s", i, delRes.status, delRes.body)
		}
	}

	// 5. Store active snapshots returned to 0
	activeSnapsAfter, _ := store.Inflight()
	if activeSnapsAfter != 0 {
		t.Fatalf("leak proof: expected 0 active snapshots after cleanup, got %d", activeSnapsAfter)
	}
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

		// Step 8: Strict leak proof using helper
		assertFullCapacityAndZeroLeaks(t, client, store, studyPayload)
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
		)

		tracker := &admittedContextTracker{}
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

					res := executeWholeStudyLifecycle(client, owner, studyPayload, nil, tracker, 2*time.Second)
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

		t.Logf("invariants: attempts=%d completed=%d rejected=%d failed=%d cancelled=%d peak_admitted=%d",
			attempts, completed, rejected, failed, cancelled, tracker.peakCount())

		if attempts != maxAttempts {
			t.Fatalf("attempts mismatch: got %d want %d", attempts, maxAttempts)
		}
		if attempts != completed+rejected+failed+cancelled {
			t.Fatalf("partition mismatch: %d != %d+%d+%d+%d", attempts, completed, rejected, failed, cancelled)
		}
		if failed != 0 {
			t.Fatalf("unexpected failures: %d", failed)
		}
		if tracker.activeCount() != 0 {
			t.Fatalf("context leak: %d still active", tracker.activeCount())
		}
		if tracker.peakCount() > 32 {
			t.Fatalf("peak admitted contexts exceeded 32: %d", tracker.peakCount())
		}
	})
}

// TestStudySustainedTargetedFaults validates error handling, classification,
// and state isolation under abnormal client requests and injected failures.
func TestStudySustainedTargetedFaults(t *testing.T) {
	host, store, _, _ := setupTestServer(t)
	defer host.Close()

	client := &studyHTTPClient{
		client:  &http.Client{Timeout: 5 * time.Second},
		baseURL: host.URL,
	}

	validStudyPayload, _ := json.Marshal(studies.StudyInput{
		Source: "market",
		Market: "US",
		RuleID: sharedStudyRuleID,
		Config: core.SignalStudyConfig{From: "2026-01-20", To: "2026-01-23", NSteps: 3},
	})

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
		res := client.do("", "", "POST", "/api/v1/backtests/studies", validStudyPayload)
		if res.status != 401 {
			t.Fatalf("expected 401 on unauthenticated request, got %d", res.status)
		}
	})

	t.Run("foreign_owner_batch_access", func(t *testing.T) {
		createRes := client.do("synthetic-ownerA", "synthetic-session", "POST", "/api/v1/backtests/studies", validStudyPayload)
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

	t.Run("injected_fault_lifecycle_accounting", func(t *testing.T) {
		tracker := &admittedContextTracker{}
		// Malformed study payload must fail create and NOT increment admitted contexts
		badPayload := []byte(`{invalid-json`)
		res := executeWholeStudyLifecycle(client, "synthetic-user-fault", badPayload, nil, tracker, 1*time.Second)
		if res.outcome != outcomeFailed {
			t.Fatalf("expected outcomeFailed on malformed create, got %s", res.outcome)
		}
		if tracker.activeCount() != 0 || tracker.peakCount() != 0 {
			t.Fatalf("tracker incorrectly accounted failed create: active=%d peak=%d", tracker.activeCount(), tracker.peakCount())
		}

		// Verify zero leaks after fault tests using validStudyPayload
		assertFullCapacityAndZeroLeaks(t, client, store, validStudyPayload)
	})

	t.Run("table_driven_mid_lifecycle_fault_cleanup", func(t *testing.T) {
		faultCases := []struct {
			name         string
			faultMatcher func(method, path string) bool
		}{
			{
				name: "prepare_500",
				faultMatcher: func(method, path string) bool {
					return method == "POST" && strings.Contains(path, "/batches/0/prepare")
				},
			},
			{
				name: "content_500",
				faultMatcher: func(method, path string) bool {
					return method == "GET" && strings.HasPrefix(path, "/api/v1/datasets/") && strings.HasSuffix(path, "/content")
				},
			},
			{
				name: "grant_500",
				faultMatcher: func(method, path string) bool {
					return method == "POST" && path == "/api/v1/compute-grants"
				},
			},
			{
				name: "signals_500",
				faultMatcher: func(method, path string) bool {
					return method == "POST" && path == "/api/v1/backtests/signals"
				},
			},
			{
				name: "batch_release_500",
				faultMatcher: func(method, path string) bool {
					return method == "DELETE" && strings.Contains(path, "/batches/0/prepare")
				},
			},
		}

		for _, tc := range faultCases {
			t.Run(tc.name, func(t *testing.T) {
				tracker := &admittedContextTracker{}
				faultClient := &studyHTTPClient{
					client:  &http.Client{Timeout: 5 * time.Second},
					baseURL: host.URL,
					faultHook: func(method, path string) *studyHTTPResponse {
						if tc.faultMatcher(method, path) {
							return &studyHTTPResponse{
								status:  500,
								body:    []byte(`{"error":{"code":"INTERNAL_ERROR","message":"injected mid-lifecycle fault"}}`),
								headers: http.Header{"X-Request-ID": []string{"req_injected_fault"}},
							}
						}
						return nil
					},
				}

				owner := "synthetic-fault-" + tc.name
				res := executeWholeStudyLifecycle(faultClient, owner, validStudyPayload, nil, tracker, 1*time.Second)

				// 1. Must fail with outcomeFailed, never completed or rejected
				if res.outcome != outcomeFailed {
					t.Fatalf("%s: expected outcomeFailed, got %s", tc.name, res.outcome)
				}
				if res.err == nil {
					t.Fatalf("%s: expected error to be preserved, got nil", tc.name)
				}

				// 2. Must clean up admitted context without leak
				if tracker.activeCount() != 0 {
					t.Fatalf("%s: leaked admitted context: count=%d", tc.name, tracker.activeCount())
				}

				// 3. Must release any prepared snapshots from store
				activeSnaps, _ := store.Inflight()
				if activeSnaps != 0 {
					t.Fatalf("%s: leaked active snapshots in store: count=%d", tc.name, activeSnaps)
				}

				// 4. Assert full 32-context and 12-batch capacity can be immediately reused
				assertFullCapacityAndZeroLeaks(t, client, store, validStudyPayload)
			})
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
		Concurrency               int     `json:"concurrency"`
		TargetAttempts            int     `json:"target_attempts"`
		Attempts                  int64   `json:"attempts"`
		Completed                 int64   `json:"completed"`
		Rejected                  int64   `json:"rejected"`
		Failed                    int64   `json:"failed"`
		Cancelled                 int64   `json:"cancelled"`
		MaxInflightContexts       int64   `json:"max_inflight_contexts"`
		MaxInflightSnapshots      int64   `json:"max_inflight_snapshots"`
		WarmupDurationMs          float64 `json:"warmup_duration_ms"`
		MeasuredDurationMs        float64 `json:"measured_duration_ms"`
		ThroughputCompletedPS     float64 `json:"throughput_completed_per_sec"`
		ThroughputAttemptsPS      float64 `json:"throughput_attempts_per_sec"`
		PayloadBodyBytesSent      int64   `json:"payload_body_bytes_sent"`
		PayloadBodyBytesReceived  int64   `json:"payload_body_bytes_received"`
		CreateP50Ms               float64 `json:"create_p50_ms"`
		CreateP95Ms               float64 `json:"create_p95_ms"`
		CreateP99Ms               float64 `json:"create_p99_ms"`
		PrepareP50Ms              float64 `json:"prepare_p50_ms"`
		PrepareP95Ms              float64 `json:"prepare_p95_ms"`
		PrepareP99Ms              float64 `json:"prepare_p99_ms"`
		EvaluateStockP50Ms        float64 `json:"evaluate_stock_p50_ms"`
		EvaluateStockP95Ms        float64 `json:"evaluate_stock_p95_ms"`
		EvaluateStockP99Ms        float64 `json:"evaluate_stock_p99_ms"`
		EvaluateBatchP50Ms        float64 `json:"evaluate_batch_p50_ms"`
		EvaluateBatchP95Ms        float64 `json:"evaluate_batch_p95_ms"`
		EvaluateBatchP99Ms        float64 `json:"evaluate_batch_p99_ms"`
		ReleaseP50Ms              float64 `json:"release_p50_ms"`
		ReleaseP95Ms              float64 `json:"release_p95_ms"`
		ReleaseP99Ms              float64 `json:"release_p99_ms"`
		AttemptP50Ms              float64 `json:"attempt_p50_ms"`
		AttemptP95Ms              float64 `json:"attempt_p95_ms"`
		AttemptP99Ms              float64 `json:"attempt_p99_ms"`
		RejectedAdmissionP50Ms    float64 `json:"rejected_admission_p50_ms,omitempty"`
		RejectedAdmissionP95Ms    float64 `json:"rejected_admission_p95_ms,omitempty"`
		RejectedAdmissionP99Ms    float64 `json:"rejected_admission_p99_ms,omitempty"`
		RejectedBatchP50Ms        float64 `json:"rejected_batch_p50_ms,omitempty"`
		RejectedBatchP95Ms        float64 `json:"rejected_batch_p95_ms,omitempty"`
		RejectedBatchP99Ms        float64 `json:"rejected_batch_p99_ms,omitempty"`
		CompletedLifecycleP50Ms   float64 `json:"completed_lifecycle_p50_ms"`
		CompletedLifecycleP95Ms   float64 `json:"completed_lifecycle_p95_ms"`
		CompletedLifecycleP99Ms   float64 `json:"completed_lifecycle_p99_ms"`
		MemAllocBeforeBytes       uint64  `json:"mem_alloc_before_bytes"`
		MemAllocAfterBytes        uint64  `json:"mem_alloc_after_bytes"`
		MemAllocBytesDelta        int64   `json:"mem_alloc_bytes_delta"`
		TotalAllocBytesDelta      uint64  `json:"total_alloc_bytes_delta"`
		MallocsDelta              uint64  `json:"mallocs_delta"`
		FreesDelta                uint64  `json:"frees_delta"`
		NumGCDelta                uint32  `json:"num_gc_delta"`
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
			warmupTracker := &admittedContextTracker{}
			var warmupWg sync.WaitGroup
			for w := 0; w < concurrency; w++ {
				warmupWg.Add(1)
				go func(id int) {
					defer warmupWg.Done()
					owner := fmt.Sprintf("synthetic-warmup-%d-%d", concurrency, id)
					res := executeWholeStudyLifecycle(client, owner, studyPayload, nil, warmupTracker, 1*time.Second)
					if res.outcome == outcomeFailed {
						t.Errorf("warmup failed for worker %d: %v", id, res.err)
					}
				}(w)
			}
			warmupWg.Wait()
			warmupDuration := time.Since(warmupStart)
			if warmupTracker.activeCount() != 0 {
				t.Fatalf("warmup leaked %d active contexts", warmupTracker.activeCount())
			}

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
			)

			tracker := &admittedContextTracker{}
			latencies := &stageLatencies{}
			measuredStart := time.Now()
			tierDeadline := measuredStart.Add(minTierDuration)
			stopGate := make(chan struct{})

			time.AfterFunc(minTierDuration, func() {
				close(stopGate)
			})

			var wg sync.WaitGroup
			for w := 0; w < concurrency; w++ {
				wg.Add(1)
				go func(workerID int) {
					defer wg.Done()
					seq := 0

					for {
						now := time.Now()
						if now.After(tierDeadline) || now.Sub(measuredStart) >= minTierDuration {
							return
						}
						select {
						case <-stopGate:
							return
						default:
						}

						owner := fmt.Sprintf("synthetic-sustained-%d-%d-%d", concurrency, workerID, seq)
						seq++

						attemptsCount.Add(1)
						attStart := time.Now()
						res := executeWholeStudyLifecycle(client, owner, studyPayload, latencies, tracker, 1*time.Second)
						attMs := float64(time.Since(attStart).Nanoseconds()) / 1e6
						latencies.record("attempt", attMs)

						switch res.outcome {
						case outcomeCompleted:
							if res.totalStocks == 23 && res.totalEvents == 92 {
								completedCount.Add(1)
								latencies.record("completed_lifecycle", attMs)
							} else {
								failedCount.Add(1)
								t.Errorf("worker %d completed with invalid stock/event count: %d stocks, %d events", workerID, res.totalStocks, res.totalEvents)
							}
						case outcomeRejected:
							rejectedCount.Add(1)
							if res.retryAfterSec == 60 {
								latencies.record("rejected_admission", attMs)
							} else {
								latencies.record("rejected_batch", attMs)
							}
							// Closed-loop backoff compliance: honor server Retry-After header
							waitDur := time.Duration(res.retryAfterSec) * time.Second
							remaining := tierDeadline.Sub(time.Now())
							if waitDur > remaining || waitDur <= 0 {
								// Cannot wait Retry-After within remaining tier budget: worker terminates cleanly
								return
							}
							select {
							case <-stopGate:
								return
							case <-time.After(waitDur):
							}
						case outcomeCancelled:
							cancelledCount.Add(1)
							return
						case outcomeFailed:
							failedCount.Add(1)
							t.Errorf("worker %d encounter unexpected failure: %v", workerID, res.err)
							return
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
			peakCtx := tracker.peakCount()
			_, peakSnaps := store.Inflight()

			// Invariant assertions
			if attempts != completed+rejected+failed+cancelled {
				t.Fatalf("partition mismatch: %d != %d+%d+%d+%d", attempts, completed, rejected, failed, cancelled)
			}
			if failed > 0 {
				t.Fatalf("tier %d encountered %d failures", concurrency, failed)
			}
			if tracker.activeCount() != 0 {
				t.Fatalf("tier %d leaked %d active contexts", concurrency, tracker.activeCount())
			}
			if peakCtx > 32 {
				t.Fatalf("tier %d peak admitted contexts %d exceeded ceiling 32", concurrency, peakCtx)
			}
			if concurrency <= 32 && peakCtx > int64(concurrency) {
				t.Fatalf("tier %d peak admitted contexts %d exceeded concurrency %d", concurrency, peakCtx, concurrency)
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
				EvaluateStockP50Ms:        calculatePercentile(latencies.evaluateStock, 0.50),
				EvaluateStockP95Ms:        calculatePercentile(latencies.evaluateStock, 0.95),
				EvaluateStockP99Ms:        calculatePercentile(latencies.evaluateStock, 0.99),
				EvaluateBatchP50Ms:        calculatePercentile(latencies.evaluateBatch, 0.50),
				EvaluateBatchP95Ms:        calculatePercentile(latencies.evaluateBatch, 0.95),
				EvaluateBatchP99Ms:        calculatePercentile(latencies.evaluateBatch, 0.99),
				ReleaseP50Ms:              calculatePercentile(latencies.release, 0.50),
				ReleaseP95Ms:              calculatePercentile(latencies.release, 0.95),
				ReleaseP99Ms:              calculatePercentile(latencies.release, 0.99),
				AttemptP50Ms:              calculatePercentile(latencies.attempt, 0.50),
				AttemptP95Ms:              calculatePercentile(latencies.attempt, 0.95),
				AttemptP99Ms:              calculatePercentile(latencies.attempt, 0.99),
				RejectedAdmissionP50Ms:    calculatePercentile(latencies.rejectedAdmission, 0.50),
				RejectedAdmissionP95Ms:    calculatePercentile(latencies.rejectedAdmission, 0.95),
				RejectedAdmissionP99Ms:    calculatePercentile(latencies.rejectedAdmission, 0.99),
				RejectedBatchP50Ms:        calculatePercentile(latencies.rejectedBatch, 0.50),
				RejectedBatchP95Ms:        calculatePercentile(latencies.rejectedBatch, 0.95),
				RejectedBatchP99Ms:        calculatePercentile(latencies.rejectedBatch, 0.99),
				CompletedLifecycleP50Ms:   calculatePercentile(latencies.completedLifecycle, 0.50),
				CompletedLifecycleP95Ms:   calculatePercentile(latencies.completedLifecycle, 0.95),
				CompletedLifecycleP99Ms:   calculatePercentile(latencies.completedLifecycle, 0.99),
				MemAllocBeforeBytes:      memBefore.Alloc,
				MemAllocAfterBytes:       memAfter.Alloc,
				MemAllocBytesDelta:       int64(memAfter.Alloc) - int64(memBefore.Alloc),
				TotalAllocBytesDelta:     memAfter.TotalAlloc - memBefore.TotalAlloc,
				MallocsDelta:             memAfter.Mallocs - memBefore.Mallocs,
				FreesDelta:               memAfter.Frees - memBefore.Frees,
				NumGCDelta:               memAfter.NumGC - memBefore.NumGC,
			}
			results = append(results, runRes)

			t.Logf("concurrency=%d completed=%d rejected=%d peak_ctx=%d wall=%.2fs completed/s=%.2f lifecycle_p95=%.2fms",
				concurrency, completed, rejected, peakCtx, wallSec, compPS, runRes.CompletedLifecycleP95Ms)

			// Prove fresh 32 retained contexts and 12 held batches capacity after tier
			assertFullCapacityAndZeroLeaks(t, client, store, studyPayload)
		})
	}

	sourceCommit := os.Getenv("SIGNALGEN_SOURCE_COMMIT")
	if sourceCommit == "" {
		sourceCommit = "58766cb23f539d9ece6583aad25744a1e5c52fd8"
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
