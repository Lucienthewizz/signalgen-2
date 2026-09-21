package artifact

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
)

func TestBuildProducesVersionedDeterministicManifest(t *testing.T) {
	path := filepath.Join(t.TempDir(), WASMFile)
	if err := os.WriteFile(path, []byte("portable-wasm"), 0o600); err != nil {
		t.Fatal(err)
	}
	runtimePath := filepath.Join(t.TempDir(), RuntimeFile)
	if err := os.WriteFile(runtimePath, []byte("go-runtime"), 0o600); err != nil {
		t.Fatal(err)
	}
	manifest, err := Build(path, runtimePath)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.EngineVersion != core.EngineVersion || manifest.SchemaVersion != core.SchemaVersion ||
		manifest.CapabilitiesVersion != core.CapabilitiesVersion || manifest.WorkerProtocol != core.WorkerProtocol {
		t.Fatalf("versions = %+v", manifest)
	}
	if manifest.WASMFile != WASMFile || manifest.RuntimeFile != RuntimeFile || manifest.WASMBytes != 13 {
		t.Fatalf("artifact metadata = %+v", manifest)
	}
	if manifest.WASMSHA256 != "sha256:cfe6136c3712b017518bfba09d460f1e0f19047f7ee44363700970912abefea1" {
		t.Fatalf("hash = %q", manifest.WASMSHA256)
	}
	if manifest.RuntimeSHA256 != "sha256:abb8352a20f027918444a38c51601d9eb7be17bc7ddda5c3bc47ecd6af06a8ec" || manifest.RuntimeBytes != 10 {
		t.Fatalf("runtime metadata = %+v", manifest)
	}
}

func TestBuildRejectsMissingAndEmptyArtifact(t *testing.T) {
	runtimePath := filepath.Join(t.TempDir(), RuntimeFile)
	if err := os.WriteFile(runtimePath, []byte("go-runtime"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Build(filepath.Join(t.TempDir(), "missing.wasm"), runtimePath); err == nil {
		t.Fatal("missing artifact unexpectedly accepted")
	}
	empty := filepath.Join(t.TempDir(), WASMFile)
	if err := os.WriteFile(empty, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Build(empty, runtimePath); err == nil {
		t.Fatal("empty artifact unexpectedly accepted")
	}
	wasmPath := filepath.Join(t.TempDir(), WASMFile)
	if err := os.WriteFile(wasmPath, []byte("portable-wasm"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Build(wasmPath, filepath.Join(t.TempDir(), "missing.js")); err == nil {
		t.Fatal("missing runtime unexpectedly accepted")
	}
}
