package apitests

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	contract "github.com/Lucienthewizz/signalgen-2/backend"
	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type tenStockUniverse struct{ universe.Repository }

func (tenStockUniverse) Instruments(_ context.Context, owner, id string) ([]universe.Instrument, error) {
	if owner != "user-a" || id != "univ-a" {
		return nil, universe.ErrNotFound
	}
	items := []universe.Instrument{}
	for _, symbol := range []string{"BBCA.JK", "BBRI.JK", "BBNI.JK", "BMRI.JK", "ASII.JK", "ANTM.JK", "INDF.JK", "ICBP.JK", "TLKM.JK", "UNVR.JK"} {
		items = append(items, universe.Instrument{Symbol: symbol, ProviderSymbol: symbol, Exchange: "XIDX", Currency: "IDR"})
	}
	return items, nil
}

type delayedMarketProvider struct{ calls atomic.Int32 }

func (provider *delayedMarketProvider) Daily(ctx context.Context, instruments []universe.Instrument, _ int) ([]marketdata.Series, error) {
	provider.calls.Add(1)
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(1600 * time.Millisecond):
	}
	candles := make([]core.Candle, 20)
	for i := range candles {
		candles[i] = core.Candle{Timestamp: time.Date(2026, 1, i+1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339), Open: 100, High: 102, Low: 99, Close: 101, Volume: 1000}
	}
	return []marketdata.Series{{Symbol: instruments[0].Symbol, Timezone: "UTC", Candles: candles}}, nil
}

// Before bounded batching this exact cold-cache case took >16s and produced EOF
// under the production 15s WriteTimeout. Also check that a warm run does no I/O.
func TestPrepareTenSlowColdStocksReturnsManifestBeforeHTTPWriteTimeout(t *testing.T) {
	upstream := &delayedMarketProvider{}
	cache, err := marketdata.NewCachedProvider(upstream, marketdata.DefaultCacheOptions())
	if err != nil {
		t.Fatal(err)
	}
	datasets, err := dataset.NewDynamicStore(cache, tenStockUniverse{})
	if err != nil {
		t.Fatal(err)
	}
	server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{verified: session.Session{ID: "ses-1", UserID: "user-a"}},
		&fakeAccess{features: []string{access.FeatureScreener}}, datasets, &fakeCompute{})
	if err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewUnstartedServer(server)
	httpServer.Config.WriteTimeout = 15 * time.Second
	httpServer.Start()
	defer httpServer.Close()
	client := httpServer.Client()
	client.Timeout = 20 * time.Second
	for run := 0; run < 2; run++ {
		start := time.Now()
		request, _ := http.NewRequest(http.MethodPost, httpServer.URL+"/api/v1/datasets/prepare", strings.NewReader(`{"purpose":"screen","rule_id":"default-scalping-v1","universe_id":"univ-a"}`))
		request.Header.Set("Authorization", "Bearer test")
		request.Header.Set("X-App-Session", "test-session")
		response, err := client.Do(request)
		if err != nil {
			t.Fatalf("run=%d response lost to timeout: %v", run, err)
		}
		var manifest dataset.Manifest
		decodeErr := json.NewDecoder(response.Body).Decode(&manifest)
		_ = response.Body.Close()
		if response.StatusCode != 200 || decodeErr != nil || len(manifest.Symbols) != 10 || manifest.CandleCount != 200 {
			t.Fatalf("run=%d status=%d manifest=%+v error=%v", run, response.StatusCode, manifest, decodeErr)
		}
		if upstream.calls.Load() != 10 {
			t.Fatalf("run=%d unexpectedly fetched %d times", run, upstream.calls.Load())
		}
		t.Logf("run=%d cold=%v elapsed=%v stocks=%d", run, run == 0, time.Since(start), len(manifest.Symbols))
	}
}

type waitingDataset struct{ fakeDatasets }

func (waitingDataset) Prepare(ctx context.Context, _ string, _ dataset.PrepareRequest) (dataset.Manifest, error) {
	<-ctx.Done()
	return dataset.Manifest{}, ctx.Err()
}

func TestDatasetPreparationDeadlineReturnsJSONInsteadOfNoMatch(t *testing.T) {
	_, paths, found := strings.Cut(contract.OpenAPI(), "\n  /api/v1/datasets/prepare:\n")
	prepare, _, _ := strings.Cut(paths, "\n  /api/v1/datasets/")
	if !found || !strings.Contains(prepare, `"504": {$ref: "#/components/responses/RequestTimeout"}`) {
		t.Fatal("published preparation contract is missing its timeout response")
	}
	server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{verified: session.Session{ID: "ses-1", UserID: "user-a"}},
		&fakeAccess{features: []string{access.FeatureScreener}}, &waitingDataset{}, &fakeCompute{})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/datasets/prepare", strings.NewReader(`{"purpose":"screen","rule_id":"default-scalping-v1","universe_id":"univ-a"}`)).WithContext(ctx)
	request.Header.Set("Authorization", "Bearer test")
	request.Header.Set("X-App-Session", "test-session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusGatewayTimeout, "REQUEST_TIMEOUT")
	if response.Header().Get("Content-Type") != "application/json; charset=utf-8" || response.Header().Get("X-Request-ID") == "" {
		t.Fatalf("lost error envelope: %v", response.Header())
	}
}
