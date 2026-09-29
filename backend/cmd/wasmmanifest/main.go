package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/artifact"
)

func main() {
	wasmPath := flag.String("wasm", "", "path to signalgen_core.wasm")
	runtimePath := flag.String("runtime", "", "path to wasm_exec.js")
	outputPath := flag.String("output", "", "path to output manifest JSON")
	flag.Parse()
	if *wasmPath == "" || *runtimePath == "" || *outputPath == "" {
		fatal("--wasm, --runtime, and --output are required")
	}
	manifest, err := artifact.Build(*wasmPath, *runtimePath)
	if err != nil {
		fatal(err.Error())
	}
	encoded, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		fatal("encode manifest: " + err.Error())
	}
	encoded = append(encoded, '\n')
	if err := os.WriteFile(*outputPath, encoded, 0o644); err != nil {
		fatal("write manifest: " + err.Error())
	}
}

func fatal(message string) {
	_, _ = fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
