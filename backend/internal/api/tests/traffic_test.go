package apitests

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	platformhttp "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/http"
)

func TestTrafficObserverCoversGinCORSAndRejectedWebSocket(t *testing.T) {
	var output bytes.Buffer
	observer := platformhttp.NewTrafficObserver(slog.New(slog.NewJSONHandler(&output, nil)))
	server, err := api.NewServer(fakeIdentity{}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{},
		api.WithTrafficObserver(observer), api.WithCORSOrigins([]string{"https://app.example"}))
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range []struct {
		method, path, origin string
		status               int
	}{
		{http.MethodGet, "/health", "", 200},
		{http.MethodGet, "/private-id?ticket=private-query", "", 404},
		{http.MethodOptions, "/private-id", "https://app.example", 204},
		{http.MethodOptions, "/private-id", "https://not-allowed.example", 403},
		{http.MethodGet, "/api/v1/screener/ws?ticket=private-ticket", "", 401},
	} {
		request := httptest.NewRequest(input.method, input.path, nil)
		request.Header.Set("Origin", input.origin)
		request.Header.Set("X-App-Session", "private-session")
		response := httptest.NewRecorder()
		server.ServeHTTP(response, request)
		if response.Code != input.status || response.Header().Get("X-Request-ID") == "" {
			t.Fatalf("%s %s: %d", input.method, input.path, response.Code)
		}
		if input.origin == "https://app.example" && response.Header().Get("Access-Control-Expose-Headers") != "X-Request-ID, Retry-After, ETag" {
			t.Fatal("allowed frontend cannot inspect operational response headers")
		}
	}
	snapshot := observer.Snapshot()
	if snapshot.Totals.Requests != 5 || snapshot.InFlight != 0 || snapshot.Totals.ClientErrors != 3 || snapshot.Totals.Successes != 2 {
		t.Fatalf("snapshot = %+v", snapshot)
	}
	if len(snapshot.Routes) != 4 {
		t.Fatalf("route count = %+v", snapshot.Routes)
	}
	for _, private := range []string{"private-id", "private-query", "private-session", "private-ticket", "not-allowed.example"} {
		if strings.Contains(output.String(), private) {
			t.Fatalf("logs leaked %s", private)
		}
	}
	for _, line := range strings.Split(strings.TrimSpace(output.String()), "\n") {
		var event map[string]any
		if err := json.Unmarshal([]byte(line), &event); err != nil || event["request_id"] == "" {
			t.Fatalf("invalid structured event: %s %v", line, err)
		}
	}
}

func TestTrafficObserverOptionRejectsNil(t *testing.T) {
	_, err := api.NewServer(fakeIdentity{}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{}, api.WithTrafficObserver(nil))
	if err == nil {
		t.Fatal("nil observer silently accepted")
	}
}
