// Public indicator harness; does not import the private decision kernel.
package main

import (
	"encoding/json"
	"fmt"
	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"io"
	"os"
)

func main() {
	decoder := json.NewDecoder(io.LimitReader(os.Stdin, 32<<20))
	decoder.DisallowUnknownFields()
	var request core.FeatureRequest
	if err := decoder.Decode(&request); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		fmt.Fprintln(os.Stderr, "one JSON request required")
		os.Exit(1)
	}
	result, err := core.ComputeFeatures(request)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err = json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
