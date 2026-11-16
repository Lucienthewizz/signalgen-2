package apitests

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	studies "github.com/Lucienthewizz/signalgen-2/backend/internal/api/backtests"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/backtest"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type studyCatalog struct {
	universe.Repository
	stocks []universe.Instrument
}

type studyFailureProvider struct {
	backtestMarket
	blocked, proceed chan struct{}
	once             sync.Once
}

func (p *studyFailureProvider) DailyHistory(ctx context.Context, in universe.Instrument, from, to time.Time) (marketdata.History, error) {
	if p.blocked != nil {
		p.once.Do(func() { close(p.blocked) })
		select {
		case <-p.proceed:
		case <-ctx.Done():
			return marketdata.History{}, ctx.Err()
		}
	}
	if in.Symbol == "MISSING" {
		return marketdata.History{}, fmt.Errorf("wrapped: %w", marketdata.ErrInsufficientCandles)
	}
	return p.backtestMarket.DailyHistory(ctx, in, from, to)
}
func TestSignalStudyPartialFailureForeignOwnerAndCancelDuringPrepare(t *testing.T) {
	for _, blocked := range []bool{false, true} {
		t.Run(fmt.Sprint(blocked), func(t *testing.T) {
			provider := &studyFailureProvider{}
			if blocked {
				provider.blocked = make(chan struct{})
				provider.proceed = make(chan struct{})
			}
			catalog := &studyCatalog{stocks: []universe.Instrument{{Symbol: "TEST", ProviderSymbol: "TEST", Exchange: "XNAS", Currency: "USD"}, {Symbol: "MISSING", ProviderSymbol: "MISSING", Exchange: "XNAS", Currency: "USD"}}}
			snapshots, _ := dataset.NewDynamicStore(provider, catalog)
			identity := &fakeIdentity{principal: auth.Principal{ID: "user-a"}}
			sessions := &fakeSessions{verified: session.Session{ID: "session-a", UserID: "user-a"}}
			server, e := api.NewServer(identity, sessions, &fakeAccess{features: []string{access.FeatureBacktest}}, snapshots, &fakeCompute{}, api.WithUniverseStore(catalog))
			if e != nil {
				t.Fatal(e)
			}
			response := backtestHTTP(t, server, "POST", "/api/v1/backtests/studies", studies.StudyInput{Source: "market", Market: "US", RuleID: core.BaselineRuleID, Config: core.SignalStudyConfig{From: "2026-01-20", To: "2026-01-23", NSteps: 3}})
			if response.Code != 201 {
				t.Fatal(response.Body.String())
			}
			var ctx studies.StudyContext
			json.Unmarshal(response.Body.Bytes(), &ctx)
			path := "/api/v1/backtests/studies/" + ctx.ID
			batchPath := path + "/batches/0/prepare"
			identity.principal.ID = "user-b"
			sessions.verified = session.Session{ID: "session-b", UserID: "user-b"}
			response = backtestHTTP(t, server, "POST", batchPath, map[string]any{})
			assertErrorCode(t, response, 404, "RESOURCE_NOT_FOUND")
			response = backtestHTTP(t, server, "DELETE", path, nil)
			assertErrorCode(t, response, 404, "RESOURCE_NOT_FOUND")
			identity.principal.ID = "user-a"
			sessions.verified = session.Session{ID: "session-a", UserID: "user-a"}
			if blocked {
				done := make(chan *httptest.ResponseRecorder, 1)
				go func() { done <- backtestHTTP(t, server, "POST", batchPath, map[string]any{}) }()
				<-provider.blocked
				response = backtestHTTP(t, server, "DELETE", path, nil)
				if response.Code != 204 {
					t.Fatal(response.Body.String())
				}
				close(provider.proceed)
				response = <-done
				assertErrorCode(t, response, 409, "VERSION_MISMATCH")
			} else {
				response = backtestHTTP(t, server, "POST", batchPath, map[string]any{})
				if response.Code != 200 {
					t.Fatal(response.Body.String())
				}
				var batch studies.StudyBatch
				json.Unmarshal(response.Body.Bytes(), &batch)
				if len(batch.Manifests) != 1 || len(batch.Failures) != 1 || batch.Failures[0].Code != "INSUFFICIENT_CANDLES" || batch.Failures[0].Retryable {
					t.Fatalf("partial %+v", batch)
				}
				snapshots.ReleaseStudy("user-b", ctx.ID)
				if _, e = snapshots.Manifest(context.Background(), "user-a", batch.Manifests[0].DatasetID); e != nil {
					t.Fatal("foreign release deleted snapshot")
				}
				response = backtestHTTP(t, server, "DELETE", path, nil)
				if response.Code != 204 {
					t.Fatal(response.Body.String())
				}
				if _, e = snapshots.Manifest(context.Background(), "user-a", batch.Manifests[0].DatasetID); e == nil {
					t.Fatal("canceled bytes survived")
				}
			}
		})
	}
}

func TestSignalStudyRetryOnlyFrozenFailuresWithLimitedCapacity(t *testing.T) {
	catalog := &studyCatalog{stocks: []universe.Instrument{{Symbol: "TEST", ProviderSymbol: "TEST", Exchange: "XNAS", Currency: "USD"}, {Symbol: "OTHER", ProviderSymbol: "OTHER", Exchange: "XNAS", Currency: "USD"}}}
	snapshots, e := dataset.NewDynamicStoreWithLimits(&backtestMarket{}, catalog, dataset.SnapshotLimits{TTL: time.Minute, MaxEntries: 2, MaxPerOwner: 1, MaxBytes: 1 << 20})
	if e != nil {
		t.Fatal(e)
	}
	server, e := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{verified: session.Session{ID: "s-a", UserID: "user-a"}}, &fakeAccess{features: []string{access.FeatureBacktest}}, snapshots, &fakeCompute{}, api.WithUniverseStore(catalog))
	if e != nil {
		t.Fatal(e)
	}
	response := backtestHTTP(t, server, "POST", "/api/v1/backtests/studies", studies.StudyInput{Source: "market", Market: "US", RuleID: core.BaselineRuleID, Config: core.SignalStudyConfig{From: "2026-01-20", To: "2026-01-23", NSteps: 3}})
	if response.Code != 201 {
		t.Fatal(response.Body.String())
	}
	var ctx studies.StudyContext
	json.Unmarshal(response.Body.Bytes(), &ctx)
	path := "/api/v1/backtests/studies/" + ctx.ID + "/batches/0/prepare"
	for _, symbols := range [][]string{{"FOREIGN"}, {"TEST", "TEST"}} {
		response = backtestHTTP(t, server, "POST", path, map[string]any{"retry_symbols": symbols})
		assertErrorCode(t, response, 422, "INVALID_REQUEST")
	}
	response = backtestHTTP(t, server, "POST", path, map[string]any{})
	assertErrorCode(t, response, 429, "SNAPSHOT_CAPACITY")
	if response.Header().Get("Retry-After") == "" {
		t.Fatal("missing backpressure")
	}
	// This deliberately tiny per-owner budget cannot fit two stocks. Explicit
	// frozen subsets can still make progress without a random partial result.
	for _, symbol := range []string{"TEST", "OTHER"} {
		response = backtestHTTP(t, server, "POST", path, map[string]any{"retry_symbols": []string{symbol}})
		if response.Code != 200 {
			t.Fatal(response.Body.String())
		}
		var retry studies.StudyBatch
		json.Unmarshal(response.Body.Bytes(), &retry)
		if len(retry.Stocks) != 1 || len(retry.Manifests) != 1 || len(retry.Failures) != 0 || retry.Manifests[0].Symbols[0] != symbol {
			t.Fatalf("invalid frozen retry %+v", retry)
		}
		response = backtestHTTP(t, server, "DELETE", path, nil)
		if response.Code != 204 {
			t.Fatal(response.Body.String())
		}
	}
}

func (s *studyCatalog) Catalog(context.Context) ([]universe.Instrument, error) { return s.stocks, nil }

// Exercises the real HTTP authorization, dataset, grant, private evaluator and
// portable study engine. Provider/auth fixtures never call a cloud service.
func TestSignalStudyFrozenCatalogBatchesAndAuthorization(t *testing.T) {
	db, e := sql.Open("sqlite", ":memory:")
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	rulesDB, e := rules.NewStore(db)
	if e != nil {
		t.Fatal(e)
	}
	if e = rulesDB.Migrate(context.Background()); e != nil {
		t.Fatal(e)
	}
	rule, e := rulesDB.Create(context.Background(), "user-a", core.RuleSnapshot{Name: "Every SELL", Logic: "AND", SignalType: "SELL", Conditions: []core.Condition{{Left: "PRICE", Op: ">", Right: 1}}})
	if e != nil {
		t.Fatal(e)
	}
	catalog := &studyCatalog{}
	for i := 0; i < 23; i++ {
		catalog.stocks = append(catalog.stocks, universe.Instrument{Symbol: fmt.Sprintf("STOCK%02d", i), ProviderSymbol: fmt.Sprintf("STOCK%02d", i), Exchange: "XNAS", Currency: "USD"})
	}
	catalog.stocks = append(catalog.stocks, universe.Instrument{Symbol: "BBCA.JK", Exchange: "XIDX", Currency: "IDR"})
	provider := &backtestMarket{}
	snapshots, e := dataset.NewDynamicStore(provider, catalog)
	if e != nil {
		t.Fatal(e)
	}
	grants := &backtestGrants{}
	features := &fakeAccess{features: []string{access.FeatureBacktest}}
	sessions := &fakeSessions{verified: session.Session{ID: "session-a", UserID: "user-a"}}
	server, e := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions, features, snapshots, grants, api.WithRuleStore(rulesDB), api.WithUniverseStore(catalog))
	if e != nil {
		t.Fatal(e)
	}
	input := studies.StudyInput{Source: "market", Market: "US", RuleID: rule.ID, Config: core.SignalStudyConfig{From: "2026-01-20", To: "2026-01-23", NSteps: 3}}
	response := backtestHTTP(t, server, "POST", "/api/v1/backtests/studies", input)
	if response.Code != 201 {
		t.Fatal(response.Body.String())
	}
	var study studies.StudyContext
	if e = json.Unmarshal(response.Body.Bytes(), &study); e != nil {
		t.Fatal(e)
	}
	if study.Total != 23 || study.BatchSize != 10 || study.Batches != 3 || study.Currency != "USD" {
		t.Fatalf("bad frozen context %+v", study)
	}
	// Changing the underlying catalog cannot change an in-progress run.
	catalog.stocks = nil
	seen := map[string]bool{}
	var last dataset.Manifest
	for batchIndex := 0; batchIndex < 3; batchIndex++ {
		path := fmt.Sprintf("/api/v1/backtests/studies/%s/batches/%d/prepare", study.ID, batchIndex)
		response = backtestHTTP(t, server, "POST", path, map[string]any{"owner": "foreign"})
		assertErrorCode(t, response, 422, "INVALID_REQUEST")
		response = backtestHTTP(t, server, "POST", path, map[string]any{})
		if response.Code != 200 {
			t.Fatalf("batch %d: %s", batchIndex, response.Body)
		}
		var batch studies.StudyBatch
		if e = json.Unmarshal(response.Body.Bytes(), &batch); e != nil {
			t.Fatal(e)
		}
		want := 10
		if batchIndex == 2 {
			want = 3
		}
		if len(batch.Manifests) != want || len(batch.Failures) != 0 {
			t.Fatalf("batch coverage %+v", batch)
		}
		for _, manifest := range batch.Manifests {
			symbol := manifest.Symbols[0]
			if seen[symbol] {
				t.Fatal("duplicate stock", symbol)
			}
			seen[symbol] = true
			last = manifest
			if manifest.Backtest.StudyID != study.ID || manifest.Backtest.DefinitionHash != study.DefinitionHash {
				t.Fatal("unbound manifest")
			}
		}
		if batchIndex == 0 {
			blocked := backtestHTTP(t, server, "POST", fmt.Sprintf("/api/v1/backtests/studies/%s/batches/1/prepare", study.ID), map[string]any{})
			assertErrorCode(t, blocked, 409, "STUDY_BUSY")
			manifest := batch.Manifests[0]
			response = backtestHTTP(t, server, "GET", "/api/v1/datasets/"+manifest.DatasetID+"/content", nil)
			if response.Code != 200 {
				t.Fatal(response.Body.String())
			}
			var content struct {
				Series []core.BacktestSeries `json:"series"`
			}
			json.Unmarshal(response.Body.Bytes(), &content)
			local, e := core.ComputeBacktestFeatures(core.FeatureRequest{Purpose: "backtest", Symbol: manifest.Symbols[0], Candles: content.Series[0].Candles, Operands: []string{"PRICE"}})
			if e != nil {
				t.Fatal(e)
			}
			response = backtestHTTP(t, server, "POST", "/api/v1/compute-grants", compute.IssueInput{Purpose: "backtest", DatasetID: manifest.DatasetID, DatasetVersion: manifest.Version, DatasetChecksum: manifest.Checksum, RuleID: rule.ID, DefinitionHash: rule.DefinitionHash, EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion})
			if response.Code != 201 {
				t.Fatal(response.Body.String())
			}
			response = backtestHTTP(t, server, "POST", "/api/v1/backtests/signals", backtest.SignalInput{ComputeGrantID: grants.grant.ID, FeatureSchemaVersion: core.FeatureSchemaVersion, PolicyVersion: core.SignalStudyPolicy, Candidates: local.Candidates})
			if response.Code != 200 {
				t.Fatal(response.Body.String())
			}
			var decisions backtest.SignalResult
			json.Unmarshal(response.Body.Bytes(), &decisions)
			result, e := core.RunSignalStudy(core.SignalStudyRequest{SchemaVersion: core.SignalStudySchema, Config: study.Config, Series: content.Series, Entries: decisions.Entries})
			if e != nil || len(result.Events) != 4 || result.Events[0].SignalType != "SELL" {
				t.Fatalf("SELL handoff %v %+v", e, result)
			}
		}
		response = backtestHTTP(t, server, "DELETE", path, nil)
		if response.Code != 204 {
			t.Fatal(response.Body.String())
		}
		response = backtestHTTP(t, server, "GET", "/api/v1/datasets/"+last.DatasetID+"/content", nil)
		assertErrorCode(t, response, 404, "RESOURCE_NOT_FOUND")
	}
	if len(seen) != 23 {
		t.Fatalf("lost stocks %d", len(seen))
	}
	calls := provider.calls.Load()
	features.features = nil
	path := fmt.Sprintf("/api/v1/backtests/studies/%s/batches/0/prepare", study.ID)
	response = backtestHTTP(t, server, "POST", path, map[string]any{})
	assertErrorCode(t, response, 403, "ENTITLEMENT_REQUIRED")
	if provider.calls.Load() != calls {
		t.Fatal("denied request fetched prices")
	}
	features.features = []string{access.FeatureBacktest}
	sessions.verified.ID = "other-session"
	response = backtestHTTP(t, server, "POST", path, map[string]any{})
	assertErrorCode(t, response, 404, "RESOURCE_NOT_FOUND")
	sessions.verified.ID = "session-a"
	_, e = rulesDB.Update(context.Background(), "user-a", rule.ID, rule.Version, core.RuleSnapshot{Name: "Changed", Logic: "AND", SignalType: "SELL", Conditions: []core.Condition{{Left: "PRICE", Op: ">", Right: 10}}})
	if e != nil {
		t.Fatal(e)
	}
	response = backtestHTTP(t, server, "POST", path, map[string]any{})
	assertErrorCode(t, response, 409, "VERSION_MISMATCH")
	response = backtestHTTP(t, server, "DELETE", "/api/v1/backtests/studies/"+study.ID, nil)
	if response.Code != 204 {
		t.Fatal(response.Body.String())
	}
	response = backtestHTTP(t, server, "POST", path, map[string]any{})
	assertErrorCode(t, response, 404, "RESOURCE_NOT_FOUND")
	// An owner field is never accepted from a client request.
	req := httptest.NewRequest("POST", "/api/v1/backtests/studies", nil)
	response = httptest.NewRecorder()
	server.ServeHTTP(response, req)
	assertErrorCode(t, response, 401, "AUTH_REQUIRED")
}

func TestMarketScreeningFrozenCatalogWithoutBacktestAccess(t *testing.T) {
	db, e := sql.Open("sqlite", ":memory:")
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	rulesDB, e := rules.NewStore(db)
	if e != nil {
		t.Fatal(e)
	}
	if e = rulesDB.Migrate(context.Background()); e != nil {
		t.Fatal(e)
	}
	rule, e := rulesDB.Create(context.Background(), "user-a", core.RuleSnapshot{Name: "Every SELL", Logic: "AND", SignalType: "SELL", Conditions: []core.Condition{{Left: "PRICE", Op: ">", Right: 1}}})
	if e != nil {
		t.Fatal(e)
	}
	catalog := &studyCatalog{}
	for i := 0; i < 23; i++ {
		catalog.stocks = append(catalog.stocks, universe.Instrument{Symbol: fmt.Sprintf("STOCK%02d", i), ProviderSymbol: fmt.Sprintf("STOCK%02d", i), Exchange: "XNAS", Currency: "USD"})
	}
	catalog.stocks = append(catalog.stocks, universe.Instrument{Symbol: "BBCA.JK", Exchange: "XIDX", Currency: "IDR"})
	provider := &backtestMarket{}
	snapshots, e := dataset.NewDynamicStore(provider, catalog)
	if e != nil {
		t.Fatal(e)
	}
	grants := &backtestGrants{}
	features := &fakeAccess{features: []string{access.FeatureScreener}}
	sessions := &fakeSessions{verified: session.Session{ID: "session-a", UserID: "user-a"}}
	server, e := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, sessions, features, snapshots, grants, api.WithRuleStore(rulesDB), api.WithUniverseStore(catalog))
	if e != nil {
		t.Fatal(e)
	}
	input := studies.StudyInput{Source: "market", Market: "US", RuleID: rule.ID, Config: core.SignalStudyConfig{From: "2026-01-20", To: "2026-01-23", NSteps: 1}}
	response := backtestHTTP(t, server, "POST", "/api/v1/screener/scans", input)
	if response.Code != 201 {
		t.Fatal(response.Body.String())
	}
	var study studies.StudyContext
	if e = json.Unmarshal(response.Body.Bytes(), &study); e != nil {
		t.Fatal(e)
	}
	if study.Total != 23 || study.BatchSize != 10 || study.Batches != 3 || study.Currency != "USD" {
		t.Fatalf("bad frozen context %+v", study)
	}
	// Changing the underlying catalog cannot change an in-progress run.
	catalog.stocks = nil
	seen := map[string]bool{}
	var last dataset.Manifest
	for batchIndex := 0; batchIndex < 3; batchIndex++ {
		path := fmt.Sprintf("/api/v1/screener/scans/%s/batches/%d/prepare", study.ID, batchIndex)
		response = backtestHTTP(t, server, "POST", path, map[string]any{"owner": "foreign"})
		assertErrorCode(t, response, 422, "INVALID_REQUEST")
		response = backtestHTTP(t, server, "POST", path, map[string]any{})
		if response.Code != 200 {
			t.Fatalf("batch %d: %s", batchIndex, response.Body)
		}
		var batch studies.StudyBatch
		if e = json.Unmarshal(response.Body.Bytes(), &batch); e != nil {
			t.Fatal(e)
		}
		want := 10
		if batchIndex == 2 {
			want = 3
		}
		if len(batch.Manifests) != want || len(batch.Failures) != 0 {
			t.Fatalf("batch coverage %+v", batch)
		}
		for _, manifest := range batch.Manifests {
			symbol := manifest.Symbols[0]
			if seen[symbol] {
				t.Fatal("duplicate stock", symbol)
			}
			seen[symbol] = true
			last = manifest
			if manifest.Backtest.StudyID != study.ID || manifest.Backtest.DefinitionHash != study.DefinitionHash {
				t.Fatal("unbound manifest")
			}
		}
		if batchIndex == 0 {
			blocked := backtestHTTP(t, server, "POST", fmt.Sprintf("/api/v1/screener/scans/%s/batches/1/prepare", study.ID), map[string]any{})
			assertErrorCode(t, blocked, 409, "STUDY_BUSY")
			manifest := batch.Manifests[0]
			response = backtestHTTP(t, server, "GET", "/api/v1/datasets/"+manifest.DatasetID+"/content", nil)
			if response.Code != 200 {
				t.Fatal(response.Body.String())
			}
			var content struct {
				Series []core.BacktestSeries `json:"series"`
			}
			json.Unmarshal(response.Body.Bytes(), &content)
			local, e := core.ComputeBacktestFeatures(core.FeatureRequest{Purpose: "backtest", Symbol: manifest.Symbols[0], Candles: content.Series[0].Candles, Operands: []string{"PRICE"}})
			if e != nil {
				t.Fatal(e)
			}
			response = backtestHTTP(t, server, "POST", "/api/v1/compute-grants", compute.IssueInput{Purpose: "screen", DatasetID: manifest.DatasetID, DatasetVersion: manifest.Version, DatasetChecksum: manifest.Checksum, RuleID: rule.ID, DefinitionHash: rule.DefinitionHash, EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion})
			if response.Code != 201 {
				t.Fatal(response.Body.String())
			}
			response = backtestHTTP(t, server, "POST", "/api/v1/screener/signals", backtest.SignalInput{ComputeGrantID: grants.grant.ID, FeatureSchemaVersion: core.FeatureSchemaVersion, PolicyVersion: core.SignalStudyPolicy, Candidates: local.Candidates})
			if response.Code != 200 {
				t.Fatal(response.Body.String())
			}
			var decisions backtest.SignalResult
			json.Unmarshal(response.Body.Bytes(), &decisions)
			// A screening grant cannot be used by the backtest scoring endpoint.
			denied := backtestHTTP(t, server, "POST", "/api/v1/backtests/signals", backtest.SignalInput{ComputeGrantID: grants.grant.ID, FeatureSchemaVersion: core.FeatureSchemaVersion, PolicyVersion: core.SignalStudyPolicy, Candidates: local.Candidates})
			assertErrorCode(t, denied, 403, "ENTITLEMENT_REQUIRED")
			result, e := core.RunSignalStudy(core.SignalStudyRequest{SchemaVersion: core.SignalStudySchema, Config: study.Config, Series: content.Series, Entries: decisions.Entries})
			if e != nil || len(result.Events) != 4 || result.Events[0].SignalType != "SELL" {
				t.Fatalf("SELL handoff %v %+v", e, result)
			}
		}
		response = backtestHTTP(t, server, "DELETE", path, nil)
		if response.Code != 204 {
			t.Fatal(response.Body.String())
		}
		response = backtestHTTP(t, server, "GET", "/api/v1/datasets/"+last.DatasetID+"/content", nil)
		assertErrorCode(t, response, 404, "RESOURCE_NOT_FOUND")
	}
	if len(seen) != 23 {
		t.Fatalf("lost stocks %d", len(seen))
	}
	calls := provider.calls.Load()
	features.features = nil
	path := fmt.Sprintf("/api/v1/screener/scans/%s/batches/0/prepare", study.ID)
	response = backtestHTTP(t, server, "POST", path, map[string]any{})
	assertErrorCode(t, response, 403, "ENTITLEMENT_REQUIRED")
	if provider.calls.Load() != calls {
		t.Fatal("denied request fetched prices")
	}
	features.features = []string{access.FeatureScreener}
	sessions.verified.ID = "other-session"
	response = backtestHTTP(t, server, "POST", path, map[string]any{})
	assertErrorCode(t, response, 404, "RESOURCE_NOT_FOUND")
	sessions.verified.ID = "session-a"
	_, e = rulesDB.Update(context.Background(), "user-a", rule.ID, rule.Version, core.RuleSnapshot{Name: "Changed", Logic: "AND", SignalType: "SELL", Conditions: []core.Condition{{Left: "PRICE", Op: ">", Right: 10}}})
	if e != nil {
		t.Fatal(e)
	}
	response = backtestHTTP(t, server, "POST", path, map[string]any{})
	assertErrorCode(t, response, 409, "VERSION_MISMATCH")
	response = backtestHTTP(t, server, "DELETE", "/api/v1/screener/scans/"+study.ID, nil)
	if response.Code != 204 {
		t.Fatal(response.Body.String())
	}
	response = backtestHTTP(t, server, "POST", path, map[string]any{})
	assertErrorCode(t, response, 404, "RESOURCE_NOT_FOUND")
	// An owner field is never accepted from a client request.
	req := httptest.NewRequest("POST", "/api/v1/screener/scans", nil)
	response = httptest.NewRecorder()
	server.ServeHTTP(response, req)
	assertErrorCode(t, response, 401, "AUTH_REQUIRED")
}
