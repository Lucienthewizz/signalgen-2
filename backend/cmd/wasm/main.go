//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
)

func runSignals(_ js.Value, args []js.Value) interface{} {
	if len(args) != 1 || args[0].Type() != js.TypeString {
		return marshalResponse(nil, "request must be one JSON string")
	}

	var request core.RunRequest
	if err := json.Unmarshal([]byte(args[0].String()), &request); err != nil {
		return marshalResponse(nil, "invalid request JSON: "+err.Error())
	}
	result, err := core.RunSignals(request)
	if err != nil {
		return marshalResponse(nil, err.Error())
	}
	return marshalResponse(result, "")
}

func marshalResponse(result interface{}, message string) string {
	payload := map[string]interface{}{"ok": message == ""}
	if message != "" {
		payload["error"] = map[string]string{"code": "CORE_RUN_FAILED", "message": message}
	} else {
		payload["result"] = result
	}
	encoded, _ := json.Marshal(payload)
	return string(encoded)
}

func main() {
	js.Global().Set("signalgenRunSignals", js.FuncOf(runSignals))
	select {}
}
