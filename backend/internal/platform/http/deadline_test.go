package http

import (
	"context"
	"encoding/json"
	stdhttp "net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestReadDeadlineCancelsDependencyAndReturnsCorrelatedTimeout(t *testing.T) {
	handler := RequestContext(readDeadline(stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		<-r.Context().Done()
		WriteError(w, r, 503, "SERVICE_UNAVAILABLE", "dependency failed")
	}), 5*time.Millisecond))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/rules", nil))
	var body struct {
		Error map[string]string `json:"error"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if w.Code != 504 || body.Error["code"] != "REQUEST_TIMEOUT" || body.Error["request_id"] == "" || body.Error["request_id"] != w.Header().Get("X-Request-ID") {
		t.Fatalf("unexpected timeout: %d %s", w.Code, w.Body.String())
	}
}

func TestReadDeadlinePreservesEarlierCancellationAndDenials(t *testing.T) {
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	r := httptest.NewRequest("GET", "/api/v1/rules", nil).WithContext(ctx)
	w := httptest.NewRecorder()
	ReadDeadline(stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		if r.Context().Err() != context.DeadlineExceeded {
			t.Fatal("parent deadline was lost")
		}
		WriteError(w, r, 403, "SESSION_REVOKED", "denied")
	})).ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("security denial became %d", w.Code)
	}
}

func TestReadDeadlineDoesNotBoundWebSocketOrMutations(t *testing.T) {
	for _, item := range []struct{ method, path string }{{"GET", "/api/v1/screener/ws"}, {"POST", "/api/v1/datasets/prepare"}, {"PATCH", "/api/v1/rules/example"}} {
		ReadDeadline(stdhttp.HandlerFunc(func(_ stdhttp.ResponseWriter, r *stdhttp.Request) {
			if _, exists := r.Context().Deadline(); exists {
				t.Fatalf("unexpected read deadline for %s %s", item.method, item.path)
			}
		})).ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(item.method, item.path, nil))
	}
}
