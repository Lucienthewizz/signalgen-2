// backtest is a local fixture/handoff harness, not an HTTP compute fallback.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
)

func main() {
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, (8<<20)+1))
	if err == nil {
		var request core.BacktestRequest
		request, err = core.DecodeBacktestRequest(raw)
		if err == nil {
			var result core.BacktestResult
			result, err = core.RunBacktest(request)
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
