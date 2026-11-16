package apitests

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	studies "github.com/Lucienthewizz/signalgen-2/backend/internal/api/backtests"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/backtest"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/ratelimit"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

// savedHistory serves daily history saved on disk, standing in for a
// scheduler-filled archive. It never contacts a provider.
type savedHistory struct{ series map[string]marketdata.Series }

func (p *savedHistory) Daily(context.Context, []universe.Instrument, int) ([]marketdata.Series, error) {
	return nil, marketdata.ErrUnavailable
}

func (p *savedHistory) DailyHistory(_ context.Context, instrument universe.Instrument, from, to time.Time) (marketdata.History, error) {
	saved, ok := p.series[instrument.ProviderSymbol]
	if !ok {
		return marketdata.History{}, marketdata.ErrInsufficientCandles
	}
	out := marketdata.Series{Symbol: instrument.Symbol, Timezone: "UTC", Candles: []core.Candle{}}
	for _, candle := range saved.Candles {
		stamp, err := time.Parse(time.RFC3339, candle.Timestamp)
		if err == nil && !stamp.Before(from) && stamp.Before(to) {
			out.Candles = append(out.Candles, candle)
		}
	}
	return marketdata.History{Series: out}, nil
}

type timingRuleStore struct {
	rules.Repository
	rule rules.Rule
}

func (s timingRuleStore) Get(_ context.Context, owner, id string) (rules.Rule, error) {
	if id != s.rule.ID {
		return rules.Rule{}, rules.ErrNotFound
	}
	rule := s.rule
	rule.OwnerUserID = owner
	return rule, nil
}

// TestStudyRealCatalogTiming replays one whole-catalog study through the real
// HTTP study, dataset, grant and private-evaluator routes on saved provider
// history. Features and outcomes run in native Go here; the browser runs the
// same core in WASM. Opt in with SIGNALGEN_REAL_CATALOG_DIR.
func TestStudyRealCatalogTiming(t *testing.T) {
	dir := os.Getenv("SIGNALGEN_REAL_CATALOG_DIR")
	if dir == "" {
		t.Skip("set SIGNALGEN_REAL_CATALOG_DIR to a directory of saved daily series")
	}
	from, to := envOr("SIGNALGEN_REAL_FROM", "2026-10-01"), envOr("SIGNALGEN_REAL_TO", "2026-10-31")
	files, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	sort.Strings(files)
	provider := &savedHistory{series: map[string]marketdata.Series{}}
	catalog := &studyCatalog{}
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		var series marketdata.Series
		if err := json.Unmarshal(raw, &series); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		provider.series[series.Symbol] = series
		catalog.stocks = append(catalog.stocks, universe.Instrument{Symbol: series.Symbol, ProviderSymbol: series.Symbol, Exchange: "XIDX", Currency: "IDR"})
	}
	if len(catalog.stocks) == 0 {
		t.Fatal("no saved series")
	}

	definition := core.RuleSnapshot{Name: "Bearish MA Cross", Logic: "AND", SignalType: "SELL", Conditions: []core.Condition{{Left: "MA9", Op: "CROSS_DOWN", Right: "MA20"}}}
	encoded, _ := json.Marshal(definition)
	digest := sha256.Sum256(encoded)
	rule := rules.Rule{ID: "rule-real-catalog", EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion, DefinitionHash: "sha256:" + hex.EncodeToString(digest[:]), Definition: definition}

	store, err := dataset.NewDynamicStore(provider, catalog)
	if err != nil {
		t.Fatal(err)
	}
	options := []api.ServerOption{api.WithRuleStore(timingRuleStore{rule: rule}), api.WithUniverseStore(catalog)}
	// Optional production-style per-user mutation limit (cmd/api default: 60/min).
	if perMinute, err := strconv.Atoi(envOr("SIGNALGEN_REAL_RATE_LIMIT", "0")); err == nil && perMinute > 0 {
		limiter, err := ratelimit.New(perMinute, time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		options = append(options, api.WithRateLimiter(limiter))
	}
	server, err := api.NewServer(studyLoadIdentity{}, studyLoadSessions{}, &fakeAccess{features: []string{access.FeatureBacktest}}, store, newConcurrentGrantsStore(), options...)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(server)
	defer host.Close()
	client := &studyHTTPClient{client: &http.Client{Timeout: time.Minute}, baseURL: host.URL}
	// Optional simulated round-trip time per request (e.g. 80ms for a remote API).
	if rtt, err := time.ParseDuration(envOr("SIGNALGEN_REAL_RTT", "0s")); err == nil && rtt > 0 {
		client.faultHook = func(string, string) *studyHTTPResponse { time.Sleep(rtt); return nil }
	}
	owner, session := "synthetic-timing", "synthetic-session"
	tp, sl := 2.0, 1.0
	payload, _ := json.Marshal(studies.StudyInput{Source: "market", Market: "IDX", RuleID: rule.ID, Config: core.SignalStudyConfig{From: from, To: to, NSteps: 3, TakeProfitPct: &tp, StopLossPct: &sl}})

	// call retries HTTP 429 after Retry-After, as the browser client does.
	var throttled time.Duration
	throttledCount := 0
	var throttleMu sync.Mutex
	call := func(method, path string, body []byte) studyHTTPResponse {
		for {
			res := client.do(owner, session, method, path, body)
			if res.status != http.StatusTooManyRequests {
				return res
			}
			wait, _ := strconv.Atoi(res.headers.Get("Retry-After"))
			throttleMu.Lock()
			throttledCount++
			throttled += time.Duration(max(wait, 1)) * time.Second
			throttleMu.Unlock()
			time.Sleep(time.Duration(max(wait, 1)) * time.Second)
		}
	}
	var prepare, waited, compute_, signals, release time.Duration
	prefetch, _ := strconv.Atoi(envOr("SIGNALGEN_REAL_PREFETCH", "0"))
	failures, evaluated, events := 0, 0, 0
	start := time.Now()
	res := call("POST", "/api/v1/backtests/studies", payload)
	if res.status != 201 {
		t.Fatalf("create: %d %s", res.status, res.body)
	}
	var study studies.StudyContext
	if err := json.Unmarshal(res.body, &study); err != nil {
		t.Fatal(err)
	}
	operands := core.RequiredOperands(definition)
	studyPath := "/api/v1/backtests/studies/" + study.ID
	for batchIndex := 0; batchIndex < study.Batches; batchIndex++ {
		batchPath := fmt.Sprintf("%s/batches/%d/prepare", studyPath, batchIndex)
		t0 := time.Now()
		res := call("POST", batchPath, []byte(`{}`))
		prepare += time.Since(t0)
		if res.status != 200 {
			t.Fatalf("prepare %d: %d %s", batchIndex, res.status, res.body)
		}
		var batch studies.StudyBatch
		if err := json.Unmarshal(res.body, &batch); err != nil {
			t.Fatal(err)
		}
		failures += len(batch.Failures)
		var series []core.BacktestSeries
		var entries []core.BacktestEntry
		// fetch loads content and issues the grant; neither needs features.
		type fetched struct {
			series []core.BacktestSeries
			grant  compute.Grant
			err    error
		}
		fetch := func(manifest dataset.Manifest) fetched {
			res := call("GET", "/api/v1/datasets/"+manifest.DatasetID+"/content", nil)
			var body struct {
				Series []core.BacktestSeries `json:"series"`
			}
			if res.status != 200 || json.Unmarshal(res.body, &body) != nil || len(body.Series) == 0 {
				return fetched{err: fmt.Errorf("content %s: %d", manifest.Symbols[0], res.status)}
			}
			grantInput, _ := json.Marshal(compute.IssueInput{Purpose: "backtest", DatasetID: manifest.DatasetID, DatasetVersion: manifest.Version, DatasetChecksum: manifest.Checksum, RuleID: rule.ID, DefinitionHash: rule.DefinitionHash, EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion})
			res = call("POST", "/api/v1/compute-grants", grantInput)
			var issued compute.Grant
			if res.status != 201 || json.Unmarshal(res.body, &issued) != nil {
				return fetched{err: fmt.Errorf("grant: %d %s", res.status, res.body)}
			}
			return fetched{series: body.Series, grant: issued}
		}
		// SIGNALGEN_REAL_PREFETCH=N mirrors the browser's bounded batch prefetch.
		ready := make([]chan fetched, len(batch.Manifests))
		semaphore := make(chan struct{}, max(prefetch, 1))
		for i, manifest := range batch.Manifests {
			ready[i] = make(chan fetched, 1)
			if prefetch > 0 {
				go func() { semaphore <- struct{}{}; ready[i] <- fetch(manifest); <-semaphore }()
			}
		}
		for i, manifest := range batch.Manifests {
			t0 = time.Now()
			if prefetch == 0 {
				ready[i] <- fetch(manifest)
			}
			got := <-ready[i]
			waited += time.Since(t0)
			if got.err != nil {
				t.Fatal(got.err)
			}
			t0 = time.Now()
			local, err := core.ComputeBacktestFeatures(core.FeatureRequest{Purpose: "backtest", Symbol: got.series[0].Symbol, Candles: got.series[0].Candles, Operands: operands})
			compute_ += time.Since(t0)
			if err != nil {
				failures++
				continue
			}
			issued := got.grant
			signalInput, _ := json.Marshal(backtest.SignalInput{ComputeGrantID: issued.ID, FeatureSchemaVersion: core.FeatureSchemaVersion, PolicyVersion: core.SignalStudyPolicy, Candidates: local.Candidates})
			t0 = time.Now()
			res = call("POST", "/api/v1/backtests/signals", signalInput)
			signals += time.Since(t0)
			var decided backtest.SignalResult
			if res.status != 200 || json.Unmarshal(res.body, &decided) != nil {
				t.Fatalf("signals: %d %s", res.status, res.body)
			}
			series = append(series, got.series...)
			entries = append(entries, decided.Entries...)
			evaluated++
		}
		if len(series) > 0 {
			t0 = time.Now()
			result, err := core.RunSignalStudy(core.SignalStudyRequest{SchemaVersion: core.SignalStudySchema, Config: study.Config, Series: series, Entries: entries})
			compute_ += time.Since(t0)
			if err != nil {
				t.Fatalf("study batch %d: %v", batchIndex, err)
			}
			events += len(result.Events)
		}
		t0 = time.Now()
		if res := call("DELETE", batchPath, nil); res.status != 204 {
			t.Fatalf("release batch %d: %d", batchIndex, res.status)
		}
		release += time.Since(t0)
	}
	call("DELETE", studyPath, nil)
	total := time.Since(start)
	t.Logf("rtt=%s window=%s..%s catalog=%d batches=%d evaluated=%d failures=%d events=%d throttled_responses=%d throttled_wait=%s prefetch=%d total=%s prepare=%s content_and_grant_wait=%s signals=%s compute=%s release=%s",
		envOr("SIGNALGEN_REAL_RTT", "0s"), from, to, study.Total, study.Batches, evaluated, failures, events, throttledCount, throttled, prefetch, total.Round(time.Millisecond), prepare.Round(time.Millisecond), waited.Round(time.Millisecond), signals.Round(time.Millisecond), compute_.Round(time.Millisecond), release.Round(time.Millisecond))
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
