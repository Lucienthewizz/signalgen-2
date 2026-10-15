package http

import (
	"encoding/json"
	stdhttp "net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRouterFallbackErrorsPreserveContract(t *testing.T) {
	router := NewRouter()
	router.Handle(stdhttp.MethodGet, "/known", func(writer stdhttp.ResponseWriter, _ *stdhttp.Request) {
		writer.WriteHeader(stdhttp.StatusNoContent)
	})
	for _, tc := range []struct {
		method, path, code string
		status             int
	}{
		{"GET", "/private-id?ticket=private-ticket", "RESOURCE_NOT_FOUND", 404},
		{"POST", "/known?ticket=private-ticket", "METHOD_NOT_ALLOWED", 405},
	} {
		t.Run(tc.code, func(t *testing.T) {
			response := httptest.NewRecorder()
			RequestContext(router.Handler()).ServeHTTP(response, httptest.NewRequest(tc.method, tc.path, nil))
			var body struct {
				Error struct {
					Code      string `json:"code"`
					RequestID string `json:"request_id"`
				} `json:"error"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if response.Code != tc.status || body.Error.Code != tc.code || body.Error.RequestID == "" || body.Error.RequestID != response.Header().Get("X-Request-ID") {
				t.Fatalf("invalid fallback contract: %d %s", response.Code, response.Body.String())
			}
			if response.Header().Get("Cache-Control") != "private, no-store" || !strings.HasPrefix(response.Header().Get("Content-Type"), "application/json") {
				t.Fatal("fallback headers bypassed error contract")
			}
			if strings.Contains(response.Body.String(), "private-") {
				t.Fatal("fallback leaked request URL")
			}
			if tc.status == 405 && response.Header().Get("Allow") != "GET" {
				t.Fatal("missing Allow header")
			}
		})
	}
}
