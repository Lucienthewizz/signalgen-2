package apitests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	studies "github.com/Lucienthewizz/signalgen-2/backend/internal/api/backtests"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

func TestSnapshotCapacityHTTPWholeBatchRetryPreservesOwnerHandles(t *testing.T) {
	catalog := &studyCatalog{stocks: []universe.Instrument{{Symbol: "A", ProviderSymbol: "A", Exchange: "XNAS", Currency: "USD"}, {Symbol: "B", ProviderSymbol: "B", Exchange: "XNAS", Currency: "USD"}}}
	prices := &backtestMarket{}
	snapshots, err := dataset.NewDynamicStoreWithLimits(prices, catalog, dataset.SnapshotLimits{TTL: time.Minute, MaxEntries: 2, MaxPerOwner: 2, MaxBytes: 1 << 20})
	if err != nil {
		t.Fatal(err)
	}
	server, err := api.NewServer(studyLoadIdentity{}, studyLoadSessions{}, &fakeAccess{features: []string{access.FeatureBacktest}}, snapshots, &fakeCompute{}, api.WithUniverseStore(catalog))
	if err != nil {
		t.Fatal(err)
	}
	call := func(owner, method, path string, input any) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(input)
		req := httptest.NewRequest(method, path, bytes.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+owner)
		req.Header.Set("X-App-Session", "synthetic-session")
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		server.ServeHTTP(response, req)
		return response
	}
	create := func(owner string) studies.StudyContext {
		response := call(owner, "POST", "/api/v1/backtests/studies", studies.StudyInput{Source: "market", Market: "US", RuleID: core.BaselineRuleID, Config: core.SignalStudyConfig{From: "2026-01-20", To: "2026-01-23", NSteps: 3}})
		if response.Code != 201 {
			t.Fatal(response.Code, response.Body.String())
		}
		var result studies.StudyContext
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	a, b := create("synthetic-a"), create("synthetic-b")
	pathA := "/api/v1/backtests/studies/" + a.ID + "/batches/0/prepare"
	pathB := "/api/v1/backtests/studies/" + b.ID + "/batches/0/prepare"
	response := call("synthetic-a", "POST", pathA, map[string]any{})
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body.String())
	}
	var first studies.StudyBatch
	json.Unmarshal(response.Body.Bytes(), &first)
	if len(first.Manifests) != 2 || len(first.Failures) != 0 {
		t.Fatal("partial first batch", first)
	}
	before := prices.calls.Load()
	response = call("synthetic-b", "POST", pathB, map[string]any{})
	assertErrorCode(t, response, 429, "SNAPSHOT_CAPACITY")
	if response.Header().Get("Retry-After") != "1" || prices.calls.Load() != before {
		t.Fatal("refusal fetched provider or omitted backpressure")
	}
	for _, manifest := range first.Manifests {
		if _, err := snapshots.Manifest(context.Background(), "synthetic-a", manifest.DatasetID); err != nil {
			t.Fatal("capacity refusal evicted active handle", err)
		}
		response = call("synthetic-b", "GET", "/api/v1/datasets/"+manifest.DatasetID+"/content", nil)
		assertErrorCode(t, response, 404, "RESOURCE_NOT_FOUND")
	}
	response = call("synthetic-b", "DELETE", pathA, nil)
	assertErrorCode(t, response, 404, "RESOURCE_NOT_FOUND")
	response = call("synthetic-a", "DELETE", pathA, nil)
	if response.Code != 204 {
		t.Fatal(response.Code, response.Body.String())
	}
	response = call("synthetic-b", "POST", pathB, map[string]any{})
	if response.Code != 200 {
		t.Fatal("retry did not recover", response.Code, response.Body.String())
	}
	var retry studies.StudyBatch
	json.Unmarshal(response.Body.Bytes(), &retry)
	if len(retry.Manifests) != 2 || len(retry.Failures) != 0 {
		t.Fatal("retry was partial", retry)
	}
	response = call("synthetic-b", "DELETE", "/api/v1/backtests/studies/"+b.ID, nil)
	if response.Code != 204 {
		t.Fatal(response.Code, response.Body.String())
	}
	for _, manifest := range retry.Manifests {
		if _, err := snapshots.Manifest(context.Background(), "synthetic-b", manifest.DatasetID); err == nil {
			t.Fatal("cancel leaked handle")
		}
	}
}
