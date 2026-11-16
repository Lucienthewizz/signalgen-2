package apitests

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
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

// studyOnlyLimiter admits study creation and rejects every other operation, so
// any grant/signals call that reaches the per-minute limiter fails visibly.
type studyOnlyLimiter struct{}

func (studyOnlyLimiter) Allow(key string) (bool, time.Duration) {
	return strings.HasPrefix(key, "backtests:study:"), time.Minute
}

func TestStudyCallsUseFixedQuotaInsteadOfMinuteLimiter(t *testing.T) {
	catalog := &studyCatalog{}
	for i := 0; i < 12; i++ {
		catalog.stocks = append(catalog.stocks, universe.Instrument{Symbol: fmt.Sprintf("STOCK%02d", i), ProviderSymbol: fmt.Sprintf("STOCK%02d", i), Exchange: "XNAS", Currency: "USD"})
	}
	store, err := dataset.NewDynamicStore(&backtestMarket{}, catalog)
	if err != nil {
		t.Fatal(err)
	}
	server, err := api.NewServer(studyLoadIdentity{}, studyLoadSessions{}, &fakeAccess{features: []string{access.FeatureBacktest}}, store, newConcurrentGrantsStore(),
		api.WithRuleStore(studySharedRuleStore{}), api.WithUniverseStore(catalog), api.WithRateLimiter(studyOnlyLimiter{}))
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(server)
	defer host.Close()
	client := &studyHTTPClient{client: &http.Client{Timeout: 10 * time.Second}, baseURL: host.URL}
	owner, session := "synthetic-quota", "synthetic-session"
	payload, _ := json.Marshal(studies.StudyInput{Source: "market", Market: "US", RuleID: sharedStudyRuleID, Config: core.SignalStudyConfig{From: "2026-01-20", To: "2026-01-23", NSteps: 3}})
	res := client.do(owner, session, "POST", "/api/v1/backtests/studies", payload)
	if res.status != 201 {
		t.Fatalf("create: %d %s", res.status, res.body)
	}
	var study studies.StudyContext
	if err := json.Unmarshal(res.body, &study); err != nil {
		t.Fatal(err)
	}
	batchPath := "/api/v1/backtests/studies/" + study.ID + "/batches/0/prepare"
	res = client.do(owner, session, "POST", batchPath, []byte(`{}`))
	if res.status != 200 {
		t.Fatalf("prepare: %d %s", res.status, res.body)
	}
	var batch studies.StudyBatch
	if err := json.Unmarshal(res.body, &batch); err != nil || len(batch.Manifests) != 10 {
		t.Fatalf("batch: %v %d", err, len(batch.Manifests))
	}

	// Every symbol in the batch gets grants and decisions although the
	// per-minute limiter rejects those operations.
	for _, manifest := range batch.Manifests {
		grantInput, _ := json.Marshal(compute.IssueInput{Purpose: "backtest", DatasetID: manifest.DatasetID, DatasetVersion: manifest.Version, DatasetChecksum: manifest.Checksum, RuleID: sharedStudyRuleID, DefinitionHash: sharedStudyRuleHash, EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion})
		var grant compute.Grant
		for use := 1; use <= dataset.MaxStudyDatasetUses+1; use++ {
			res = client.do(owner, session, "POST", "/api/v1/compute-grants", grantInput)
			if use <= dataset.MaxStudyDatasetUses {
				if res.status != 201 || json.Unmarshal(res.body, &grant) != nil {
					t.Fatalf("%s grant %d: %d %s", manifest.Symbols[0], use, res.status, res.body)
				}
			} else if res.status != 409 || !strings.Contains(string(res.body), "STUDY_RETRY_LIMIT") {
				t.Fatalf("%s grant over quota: %d %s", manifest.Symbols[0], res.status, res.body)
			}
		}
		res = client.do(owner, session, "GET", "/api/v1/datasets/"+manifest.DatasetID+"/content", nil)
		var content struct {
			Series []core.BacktestSeries `json:"series"`
		}
		if res.status != 200 || json.Unmarshal(res.body, &content) != nil {
			t.Fatalf("content: %d", res.status)
		}
		features, err := core.ComputeBacktestFeatures(core.FeatureRequest{Purpose: "backtest", Symbol: content.Series[0].Symbol, Candles: content.Series[0].Candles, Operands: []string{"PRICE"}})
		if err != nil {
			t.Fatal(err)
		}
		signalInput, _ := json.Marshal(backtest.SignalInput{ComputeGrantID: grant.ID, FeatureSchemaVersion: core.FeatureSchemaVersion, PolicyVersion: core.SignalStudyPolicy, Candidates: features.Candidates})
		for use := 1; use <= dataset.MaxStudyDatasetUses+1; use++ {
			res = client.do(owner, session, "POST", "/api/v1/backtests/signals", signalInput)
			if use <= dataset.MaxStudyDatasetUses && res.status != 200 {
				t.Fatalf("%s signals %d: %d %s", manifest.Symbols[0], use, res.status, res.body)
			}
			if use > dataset.MaxStudyDatasetUses && (res.status != 409 || !strings.Contains(string(res.body), "STUDY_RETRY_LIMIT")) {
				t.Fatalf("%s signals over quota: %d %s", manifest.Symbols[0], res.status, res.body)
			}
		}
	}

	// An unknown grant is not a study call and still reaches the limiter.
	unknown, _ := json.Marshal(backtest.SignalInput{ComputeGrantID: "missing", FeatureSchemaVersion: core.FeatureSchemaVersion, PolicyVersion: core.SignalStudyPolicy, Candidates: []core.FeatureCandidate{}})
	if res = client.do(owner, session, "POST", "/api/v1/backtests/signals", unknown); res.status != 429 {
		t.Fatalf("non-study signals bypassed the limiter: %d %s", res.status, res.body)
	}

	// Batch preparation is capped per batch index instead of per minute.
	if res = client.do(owner, session, "DELETE", batchPath, nil); res.status != 204 {
		t.Fatalf("release: %d", res.status)
	}
	for attempt := 2; attempt <= 6; attempt++ {
		res = client.do(owner, session, "POST", batchPath, []byte(`{}`))
		if attempt <= 5 {
			if res.status != 200 {
				t.Fatalf("prepare attempt %d: %d %s", attempt, res.status, res.body)
			}
			if release := client.do(owner, session, "DELETE", batchPath, nil); release.status != 204 {
				t.Fatalf("release attempt %d: %d", attempt, release.status)
			}
		} else if res.status != 409 || !strings.Contains(string(res.body), "STUDY_RETRY_LIMIT") {
			t.Fatalf("prepare over cap: %d %s", res.status, res.body)
		}
	}
	if res = client.do(owner, session, "DELETE", "/api/v1/backtests/studies/"+study.ID, nil); res.status != 204 {
		t.Fatalf("cancel: %d", res.status)
	}
}
