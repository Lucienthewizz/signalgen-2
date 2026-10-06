package apitests

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
)

// Opt in when Go and Node are available. The normal unit suite remains fast;
// CI additionally executes the actual JS/WASM artifact, not a native Go mock.
func TestModelAActualWASMFeatures(t *testing.T) {
	if os.Getenv("SIGNALGEN_RUN_WASM_INTEGRATION") != "1" {
		t.Skip("set SIGNALGEN_RUN_WASM_INTEGRATION=1 to execute the actual WASM bridge")
	}
	fixture, err := os.ReadFile("../../../core/testdata/default_scalping_v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var input struct {
		Request core.RunRequest `json:"request"`
	}
	if err := json.Unmarshal(fixture, &input); err != nil {
		t.Fatal(err)
	}
	series := []marketdata.Series{
		{Symbol: "BBCA", Candles: input.Request.Candles},
		{Symbol: "BBRI", Candles: input.Request.Candles},
		{Symbol: "TLKM", Candles: input.Request.Candles},
	}
	results := actualWASMFeatures(t, series)
	assertWASMParity(t, series, results)
}

func actualWASMFeatures(t *testing.T, series []marketdata.Series) []core.FeatureResult {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Fatal("Node is required for the requested WASM integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	backendRoot, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatal(err)
	}
	artifact := filepath.Join(t.TempDir(), "signalgen_core.wasm")
	build := exec.CommandContext(ctx, "go", "build", "-trimpath", "-o", artifact, "./cmd/wasm")
	build.Dir = backendRoot
	for _, value := range os.Environ() {
		if !strings.HasPrefix(value, "GOOS=") && !strings.HasPrefix(value, "GOARCH=") {
			build.Env = append(build.Env, value)
		}
	}
	build.Env = append(build.Env, "GOOS=js", "GOARCH=wasm")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build WASM: %v\n%s", err, output)
	}
	goroot, err := exec.CommandContext(ctx, "go", "env", "GOROOT").Output()
	if err != nil {
		t.Fatal(err)
	}
	runtimeFile := filepath.Join(strings.TrimSpace(string(goroot)), "lib", "wasm", "wasm_exec.js")
	script, err := filepath.Abs("fixtures/model_a_wasm.cjs")
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(series)
	if err != nil {
		t.Fatal(err)
	}
	node := exec.CommandContext(ctx, "node", script, runtimeFile, artifact)
	node.Stdin = bytes.NewReader(encoded)
	var stderr bytes.Buffer
	node.Stderr = &stderr
	output, err := node.Output()
	if err != nil {
		t.Fatalf("execute WASM: %v\n%s", err, &stderr)
	}
	var results []core.FeatureResult
	if err := json.Unmarshal(output, &results); err != nil {
		t.Fatalf("invalid WASM result: %v", err)
	}
	return results
}

// Declare the tolerance before comparing. Different runtimes may differ in
// the least significant floating-point bits; symbols/times/counts are exact.
func assertWASMParity(t *testing.T, series []marketdata.Series, results []core.FeatureResult) {
	t.Helper()
	if len(results) != len(series) {
		t.Fatal("WASM lost a dataset series")
	}
	for i, item := range series {
		native, err := core.ComputeFeatures(core.FeatureRequest{Purpose: "screen", Symbol: item.Symbol, Candles: item.Candles})
		if err != nil {
			t.Fatal(err)
		}
		wasm := results[i]
		if wasm.EngineVersion != core.EngineVersion || wasm.FeatureSchemaVersion != core.FeatureSchemaVersion ||
			wasm.CandleCount != native.CandleCount || len(wasm.Candidates) != len(native.Candidates) {
			t.Fatal("WASM changed the version/candle/candidate contract")
		}
		for j, expected := range native.Candidates {
			actual := wasm.Candidates[j]
			if actual.Symbol != expected.Symbol || actual.Timestamp != expected.Timestamp {
				t.Fatal("WASM changed candidate identity/order")
			}
			want := []float64{expected.Features.Price, expected.Features.EMA9, expected.Features.EMA20, expected.Features.RSI14}
			got := []float64{actual.Features.Price, actual.Features.EMA9, actual.Features.EMA20, actual.Features.RSI14}
			for k := range want {
				if math.IsNaN(got[k]) || math.IsInf(got[k], 0) || math.Abs(got[k]-want[k]) > 1e-9+1e-12*math.Abs(want[k]) {
					t.Fatalf("WASM feature parity failed: series=%d candidate=%d feature=%d", i, j, k)
				}
			}
		}
	}
	t.Logf("Actual Model A WASM parity verified: %d series", len(series))
}
