package apitests

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
	"github.com/Lucienthewizz/signalgen-2/backend/internal/collection"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/ratelimit"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

// screenOutcome is one catalog member's canonical screening result. Failures
// keep their code; they are never folded into "no signal".
type screenOutcome struct {
	Symbol  string        `json:"symbol"`
	Status  string        `json:"status"` // evaluated | failed
	Code    string        `json:"code,omitempty"`
	Retry   bool          `json:"retryable,omitempty"`
	Signals []screenEvent `json:"signals,omitempty"`
}

type screenEvent struct {
	Timestamp string  `json:"timestamp"`
	Type      string  `json:"signal_type"`
	Price     float64 `json:"reference_price"`
}

type measuredArchive struct {
	marketdata.Provider
	reads *atomic.Int64
}

func (p measuredArchive) Snapshot(ctx context.Context) (string, marketdata.Provider, error) {
	if archive, ok := p.Provider.(marketdata.SnapshotProvider); ok {
		revision, view, err := archive.Snapshot(ctx)
		if err != nil {
			return "", nil, err
		}
		return revision, measuredArchive{Provider: view, reads: p.reads}, nil
	}
	return "fixed-idx-archive", p, nil
}

func (p measuredArchive) DailyHistory(ctx context.Context, instrument universe.Instrument, from, to time.Time) (marketdata.History, error) {
	p.reads.Add(1)
	return p.Provider.(marketdata.HistoryProvider).DailyHistory(ctx, instrument, from, to)
}

func (p measuredArchive) Source() marketdata.Source {
	if source, ok := p.Provider.(interface{ Source() marketdata.Source }); ok {
		return source.Source()
	}
	return marketdata.Source{Provider: "yahoo_finance"}
}

type screenRoute struct {
	Count     int            `json:"count"`
	Statuses  map[string]int `json:"statuses"`
	SentBytes int            `json:"sent_bytes"`
	RecvBytes int            `json:"recv_bytes"`
	SumMS     float64        `json:"sum_ms"`
}

type screenRun struct {
	Run            int                     `json:"run"`
	ArchiveReads   int64                   `json:"archive_read_attempts"`
	WallMS         float64                 `json:"wall_ms"`
	StageMS        map[string]float64      `json:"stage_ms"`
	Routes         map[string]*screenRoute `json:"routes"`
	Total          int                     `json:"catalog_total"`
	Evaluated      int                     `json:"evaluated"`
	WithSignals    int                     `json:"evaluated_with_signals"`
	Failed         int                     `json:"failed"`
	FailureCodes   map[string]int          `json:"failure_codes"`
	Signals        int                     `json:"signals"`
	SwingEvaluated int                     `json:"swing_evaluated,omitempty"`
	MissingFuture  int                     `json:"missing_future,omitempty"`
	OutcomesSHA256 string                  `json:"backtest_outcomes_sha256,omitempty"`
	CandidateBytes int                     `json:"candidate_json_bytes"`
	OracleSHA256   string                  `json:"oracle_sha256"`
}

// TestScreenRealCatalogTiming replays a whole-market scan or signal study the way
// runSignalStudy does (prepare batch of 10 -> prefetch content+grant -> per
// symbol features then private scoring -> release) against a pinned, read-only
// IDX archive and the real HTTP
// routes. Scope: native Go features, synthetic owner/session, in-process
// loopback API. It does NOT measure the browser Worker/WASM/IndexedDB path.
// Use SIGNALGEN_SCREEN_STORE and SIGNALGEN_SCREEN_CATALOG to opt in.
// SIGNALGEN_SCREEN_PURPOSE=backtest also evaluates each signal through T+3.
func TestScreenRealCatalogTiming(t *testing.T) {
	storeRoot, catalogPath := os.Getenv("SIGNALGEN_SCREEN_STORE"), os.Getenv("SIGNALGEN_SCREEN_CATALOG")
	if storeRoot == "" || catalogPath == "" {
		t.Skip("set SIGNALGEN_SCREEN_STORE and SIGNALGEN_SCREEN_CATALOG")
	}
	from, to := envOr("SIGNALGEN_SCREEN_FROM", "2026-11-13"), envOr("SIGNALGEN_SCREEN_TO", "2026-11-13")
	ruleID := envOr("SIGNALGEN_SCREEN_RULE", core.BaselineRuleID)
	purpose := envOr("SIGNALGEN_SCREEN_PURPOSE", "screen")
	if purpose != "screen" && purpose != "backtest" {
		t.Fatal("benchmark purpose must be screen or backtest")
	}
	runs, _ := strconv.Atoi(envOr("SIGNALGEN_SCREEN_RUNS", "1"))
	prefetch, _ := strconv.Atoi(envOr("SIGNALGEN_SCREEN_PREFETCH", "4")) // browser PREFETCH_LIMIT
	rtt, _ := time.ParseDuration(envOr("SIGNALGEN_SCREEN_RTT", "0s"))

	raw, err := os.ReadFile(catalogPath)
	if err != nil {
		t.Fatal(err)
	}
	var listed struct {
		Items []struct {
			Symbol         string `json:"symbol"`
			ProviderSymbol string `json:"provider_symbol"`
		} `json:"items"`
	}
	if err := json.Unmarshal(raw, &listed); err != nil {
		t.Fatal(err)
	}
	catalog := &studyCatalog{}
	for _, item := range listed.Items {
		catalog.stocks = append(catalog.stocks, universe.Instrument{Symbol: item.Symbol, ProviderSymbol: item.ProviderSymbol, Exchange: "XIDX", Currency: "IDR"})
	}
	if want, _ := strconv.Atoi(envOr("SIGNALGEN_SCREEN_EXPECT_TOTAL", "0")); want > 0 && len(catalog.stocks) != want {
		t.Fatalf("catalog has %d instruments, expected %d", len(catalog.stocks), want)
	}
	// Live routing points at a closed loopback port: IDX history must come from
	// the archive, and any accidental live call fails instead of leaving the host.
	live, err := marketdata.NewYahooFinance("http://127.0.0.1:9", nil)
	if err != nil {
		t.Fatal(err)
	}
	var archive marketdata.Provider
	if _, err := os.Stat(filepath.Join(storeRoot, "report.json")); err == nil {
		archive, err = collection.NewArchiveProvider(storeRoot)
		if err != nil {
			t.Fatal(err)
		}
	} else if os.IsNotExist(err) {
		archive, err = collection.NewRoutedStoreProvider(storeRoot, live)
		if err != nil {
			t.Fatal(err)
		}
	} else {
		t.Fatal(err)
	}
	// Same bounded shared cache as cmd/api; run 1 is cold, later runs may hit it.
	var reads atomic.Int64
	cacheOptions := marketdata.DefaultCacheOptions()
	provider, err := marketdata.NewCachedProvider(measuredArchive{Provider: archive, reads: &reads}, cacheOptions)
	if err != nil {
		t.Fatal(err)
	}
	store, err := dataset.NewDynamicStore(provider, catalog)
	if err != nil {
		t.Fatal(err)
	}
	limiter, err := ratelimit.New(60, time.Minute) // cmd/api default mutation limit
	if err != nil {
		t.Fatal(err)
	}
	options := []api.ServerOption{api.WithUniverseStore(catalog), api.WithRateLimiter(limiter)}
	if ruleID == "qa-mixed-and-or" {
		rule := core.RuleSnapshot{
			Name: "QA - Mixed AND OR", Logic: "AND", SignalType: "BUY",
			Conditions: []core.Condition{
				{Left: "PRICE", Op: ">", Right: 1000000.0, NextLogic: "OR"},
				{Left: "PRICE", Op: ">", Right: 1.0, NextLogic: "AND"},
				{Left: "PRICE", Op: "<", Right: 1000000.0},
			},
		}
		raw, err := json.Marshal(rule)
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(raw)
		options = append(options, api.WithRuleStore(timingRuleStore{rule: rules.Rule{ID: ruleID, EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion, DefinitionHash: "sha256:" + hex.EncodeToString(digest[:]), Definition: rule}}))
	}
	server, err := api.NewServer(studyLoadIdentity{}, studyLoadSessions{}, &fakeAccess{features: []string{access.FeatureScreener, access.FeatureBacktest}}, store, newConcurrentGrantsStore(), options...)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(server)
	defer host.Close()
	client := &studyHTTPClient{client: &http.Client{Timeout: time.Minute}, baseURL: host.URL}
	if rtt > 0 {
		client.faultHook = func(string, string) *studyHTTPResponse { time.Sleep(rtt); return nil }
	}
	// Serve mode: keep the same fixture API up on loopback for a browser driver.
	// Bearer synthetic-<any> + X-App-Session synthetic-session authenticate a synthetic identity.
	if serve, _ := time.ParseDuration(os.Getenv("SIGNALGEN_SCREEN_SERVE")); serve > 0 {
		fmt.Printf("SIGNALGEN_SCREEN_URL=%s\n", host.URL)
		time.Sleep(min(serve, 2*time.Hour))
		return
	}

	var results []screenRun
	for run := 1; run <= max(runs, 1); run++ {
		before := reads.Load()
		result, outcomes := screenOnce(t, client, purpose, ruleID, from, to, prefetch, run)
		result.ArchiveReads = reads.Load() - before
		results = append(results, result)
		if run > 1 && (result.OracleSHA256 != results[0].OracleSHA256 || result.OutcomesSHA256 != results[0].OutcomesSHA256) {
			t.Fatalf("run %d results changed across repeated runs", run)
		}
		if out := os.Getenv("SIGNALGEN_SCREEN_ORACLE_OUT"); out != "" && run == 1 {
			writeJSON(t, out, outcomes)
		}
		t.Logf("run=%d purpose=%s wall=%.0fms total=%d evaluated=%d failed=%d codes=%v signals=%d archive_reads=%d oracle=%s stages=%v",
			run, purpose, result.WallMS, result.Total, result.Evaluated, result.Failed, result.FailureCodes, result.Signals, result.ArchiveReads, result.OracleSHA256, result.StageMS)
	}
	if out := os.Getenv("SIGNALGEN_SCREEN_OUT"); out != "" {
		writeJSON(t, out, map[string]any{
			"harness": "native-go-http (not browser/WASM/IDB)", "store_root": filepath.Base(storeRoot),
			"from": from, "to": to, "rule_id": ruleID, "purpose": purpose, "prefetch": prefetch, "rtt": rtt.String(),
			"cache_max_entries": cacheOptions.MaxEntries, "cache_max_candles": cacheOptions.MaxCandles, "runs": results,
		})
	}
}

func screenOnce(t *testing.T, client *studyHTTPClient, purpose, ruleID, from, to string, prefetch, run int) (screenRun, []screenOutcome) {
	owner, session := fmt.Sprintf("synthetic-screen-%d", run), "synthetic-session"
	result := screenRun{Run: run, StageMS: map[string]float64{}, Routes: map[string]*screenRoute{}, FailureCodes: map[string]int{}}
	var mu sync.Mutex
	stage := func(name string, since time.Time) {
		mu.Lock()
		result.StageMS[name] += float64(time.Since(since).Microseconds()) / 1000
		mu.Unlock()
	}
	call := func(route, method, path string, body []byte) studyHTTPResponse {
		for {
			res := client.do(owner, session, method, path, body)
			mu.Lock()
			r := result.Routes[route]
			if r == nil {
				r = &screenRoute{Statuses: map[string]int{}}
				result.Routes[route] = r
			}
			r.Count++
			r.Statuses[strconv.Itoa(res.status)]++
			r.SentBytes += len(body)
			r.RecvBytes += res.bytes
			r.SumMS += res.elapsed
			mu.Unlock()
			if res.status != http.StatusTooManyRequests {
				return res
			}
			wait, _ := strconv.Atoi(res.headers.Get("Retry-After"))
			time.Sleep(time.Duration(max(wait, 1)) * time.Second)
		}
	}
	start := time.Now()
	contextPath, scoringPath, steps := "/api/v1/screener/scans", "/api/v1/screener/signals", 1
	if purpose == "backtest" {
		contextPath, scoringPath, steps = "/api/v1/backtests/studies", "/api/v1/backtests/signals", 3
	}
	payload, _ := json.Marshal(studies.StudyInput{Source: "market", Market: "IDX", RuleID: ruleID, Config: core.SignalStudyConfig{From: from, To: to, NSteps: steps}})
	t0 := time.Now()
	res := call("create", "POST", contextPath, payload)
	stage("create", t0)
	if res.status != 201 {
		t.Fatalf("create: %d %s", res.status, res.body)
	}
	var study studies.StudyContext
	if err := json.Unmarshal(res.body, &study); err != nil {
		t.Fatal(err)
	}
	result.Total = study.Total
	scanPath := contextPath + "/" + study.ID
	var outcomes []screenOutcome
	outcomeDigest := sha256.New()
	outcomeEncoder := json.NewEncoder(outcomeDigest)
	for batchIndex := 0; batchIndex < study.Batches; batchIndex++ {
		batchPath := fmt.Sprintf("%s/batches/%d/prepare", scanPath, batchIndex)
		t0 = time.Now()
		res := call("prepare", "POST", batchPath, []byte(`{}`))
		stage("prepare", t0)
		if res.status != 200 {
			t.Fatalf("prepare %d: %d %s", batchIndex, res.status, res.body)
		}
		var batch studies.StudyBatch
		if err := json.Unmarshal(res.body, &batch); err != nil {
			t.Fatal(err)
		}
		for _, f := range batch.Failures {
			outcomes = append(outcomes, screenOutcome{Symbol: f.Symbol, Status: "failed", Code: f.Code, Retry: f.Retryable})
		}
		type fetched struct {
			series []core.BacktestSeries
			grant  compute.Grant
			err    error
		}
		fetch := func(manifest dataset.Manifest) fetched {
			t0 := time.Now()
			res := call("content", "GET", "/api/v1/datasets/"+manifest.DatasetID+"/content", nil)
			stage("transfer", t0)
			var body struct {
				Series []core.BacktestSeries `json:"series"`
			}
			if res.status != 200 || json.Unmarshal(res.body, &body) != nil || len(body.Series) != 1 {
				return fetched{err: fmt.Errorf("content %s: %d", manifest.Symbols[0], res.status)}
			}
			grantInput, _ := json.Marshal(compute.IssueInput{Purpose: purpose, DatasetID: manifest.DatasetID, DatasetVersion: manifest.Version, DatasetChecksum: manifest.Checksum, RuleID: study.RuleID, DefinitionHash: study.DefinitionHash, EngineVersion: study.EngineVersion, SchemaVersion: study.RuleSchemaVersion})
			t0 = time.Now()
			res = call("grant", "POST", "/api/v1/compute-grants", grantInput)
			stage("grant", t0)
			var issued compute.Grant
			if res.status != 201 || json.Unmarshal(res.body, &issued) != nil {
				return fetched{err: fmt.Errorf("grant: %d %s", res.status, res.body)}
			}
			return fetched{series: body.Series, grant: issued}
		}
		// Bounded prefetch, consumed in batch order, as prefetchBatch does.
		ready := make([]chan fetched, len(batch.Manifests))
		semaphore := make(chan struct{}, max(prefetch, 1))
		for i, manifest := range batch.Manifests {
			ready[i] = make(chan fetched, 1)
			go func() { semaphore <- struct{}{}; ready[i] <- fetch(manifest); <-semaphore }()
		}
		for i, manifest := range batch.Manifests {
			symbol := manifest.Symbols[0]
			t0 = time.Now()
			got := <-ready[i]
			stage("prefetch_wait", t0)
			if got.err != nil {
				t.Fatal(got.err)
			}
			candles := got.series[0].Candles
			t0 = time.Now()
			local, err := core.ComputeBacktestFeatures(core.FeatureRequest{Purpose: "backtest", Symbol: symbol, Candles: candles, Operands: manifest.RequiredOperands})
			stage("features_native", t0)
			if err != nil || len(local.Candidates) != len(candles)-19 {
				t.Fatalf("features %s: %v (%d candidates, %d candles)", symbol, err, len(local.Candidates), len(candles))
			}
			signalInput, _ := json.Marshal(backtest.SignalInput{ComputeGrantID: got.grant.ID, FeatureSchemaVersion: core.FeatureSchemaVersion, PolicyVersion: core.SignalStudyPolicy, Candidates: local.Candidates})
			result.CandidateBytes += len(signalInput)
			t0 = time.Now()
			res = call("scoring", "POST", scoringPath, signalInput)
			stage("scoring", t0)
			var decided backtest.SignalResult
			if res.status != 200 || json.Unmarshal(res.body, &decided) != nil {
				t.Fatalf("signals %s: %d %s", symbol, res.status, res.body)
			}
			if purpose == "backtest" {
				t0 = time.Now()
				simulated, err := core.RunSignalStudy(core.SignalStudyRequest{SchemaVersion: core.SignalStudySchema, Config: study.Config, Series: got.series, Entries: decided.Entries})
				stage("study_native", t0)
				if err != nil {
					t.Fatalf("study %s: %v", symbol, err)
				}
				result.SwingEvaluated += simulated.Swing.Evaluated
				result.MissingFuture += simulated.Swing.Missing
				if err := outcomeEncoder.Encode(simulated.Events); err != nil {
					t.Fatal(err)
				}
			}
			outcome := screenOutcome{Symbol: symbol, Status: "evaluated"}
			for _, entry := range decided.Entries {
				price := math.NaN()
				for _, c := range candles {
					if c.Timestamp == entry.Timestamp {
						price = c.Close
					}
				}
				if entry.Symbol != symbol || math.IsNaN(price) {
					t.Fatalf("entry outside snapshot: %+v", entry)
				}
				outcome.Signals = append(outcome.Signals, screenEvent{Timestamp: entry.Timestamp, Type: entry.SignalType, Price: price})
			}
			outcomes = append(outcomes, outcome)
		}
		t0 = time.Now()
		if res := call("release", "DELETE", batchPath, nil); res.status != 204 {
			t.Fatalf("release %d: %d", batchIndex, res.status)
		}
		stage("release", t0)
	}
	call("cancel", "DELETE", scanPath, nil)
	result.WallMS = float64(time.Since(start).Microseconds()) / 1000
	if purpose == "backtest" {
		result.OutcomesSHA256 = hex.EncodeToString(outcomeDigest.Sum(nil))
	}

	sort.Slice(outcomes, func(i, j int) bool { return outcomes[i].Symbol < outcomes[j].Symbol })
	for i, o := range outcomes {
		if i > 0 && o.Symbol == outcomes[i-1].Symbol {
			t.Fatalf("duplicate outcome %s", o.Symbol)
		}
		switch o.Status {
		case "failed":
			result.Failed++
			result.FailureCodes[o.Code]++
		default:
			result.Evaluated++
			result.Signals += len(o.Signals)
			if len(o.Signals) > 0 {
				result.WithSignals++
			}
		}
	}
	if len(outcomes) != result.Total {
		t.Fatalf("covered %d of %d catalog members", len(outcomes), result.Total)
	}
	encoded, _ := json.Marshal(outcomes)
	digest := sha256.Sum256(encoded)
	result.OracleSHA256 = hex.EncodeToString(digest[:])
	return result, outcomes
}

func writeJSON(t *testing.T, path string, value any) {
	encoded, err := json.MarshalIndent(value, "", " ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		t.Fatal(err)
	}
}
