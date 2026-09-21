package artifact

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
)

const (
	WASMFile    = "signalgen_core.wasm"
	RuntimeFile = "wasm_exec.js"
)

// Manifest binds a browser WASM file to the exact portable-core contract it
// implements. It intentionally contains no build timestamp so identical input
// artifacts produce identical manifests.
type Manifest struct {
	EngineVersion       string `json:"engine_version"`
	SchemaVersion       string `json:"schema_version"`
	CapabilitiesVersion string `json:"capabilities_version"`
	WorkerProtocol      string `json:"worker_protocol"`
	WASMFile            string `json:"wasm_file"`
	RuntimeFile         string `json:"runtime_file"`
	WASMSHA256          string `json:"wasm_sha256"`
	WASMBytes           int64  `json:"wasm_bytes"`
	RuntimeSHA256       string `json:"runtime_sha256"`
	RuntimeBytes        int64  `json:"runtime_bytes"`
}

func Build(wasmPath, runtimePath string) (Manifest, error) {
	wasm, err := readArtifact(wasmPath, "WASM")
	if err != nil {
		return Manifest{}, err
	}
	runtime, err := readArtifact(runtimePath, "runtime")
	if err != nil {
		return Manifest{}, err
	}
	wasmHash := sha256.Sum256(wasm)
	runtimeHash := sha256.Sum256(runtime)
	return Manifest{
		EngineVersion: core.EngineVersion, SchemaVersion: core.SchemaVersion,
		CapabilitiesVersion: core.CapabilitiesVersion, WorkerProtocol: core.WorkerProtocol,
		WASMFile: WASMFile, RuntimeFile: RuntimeFile,
		WASMSHA256: "sha256:" + hex.EncodeToString(wasmHash[:]), WASMBytes: int64(len(wasm)),
		RuntimeSHA256: "sha256:" + hex.EncodeToString(runtimeHash[:]), RuntimeBytes: int64(len(runtime)),
	}, nil
}

func readArtifact(path, label string) ([]byte, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s artifact: %w", label, err)
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("%s artifact is empty", label)
	}
	return raw, nil
}
