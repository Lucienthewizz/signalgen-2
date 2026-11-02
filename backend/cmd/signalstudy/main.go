// signalstudy is a deterministic local fixture harness, never a server fallback.
package main

import (
	"encoding/json"
	"fmt"
	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"io"
	"os"
)

func main() {
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, (8<<20)+1))
	if err == nil && len(raw) > 8<<20 {
		err = fmt.Errorf("study input exceeds 8 MiB")
	}
	if err == nil {
		var request core.SignalStudyRequest
		request, err = core.DecodeSignalStudyRequest(raw)
		if err == nil {
			var result core.SignalStudyResult
			result, err = core.RunSignalStudy(request)
			if err == nil {
				err = json.NewEncoder(os.Stdout).Encode(result)
			}
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
