package http

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	stdhttp "net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	platformws "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/websocket"
	ws "github.com/coder/websocket"
)

func TestTrafficCountsAndLogsOnlyServerAssignedTemplates(t *testing.T) {
	var output bytes.Buffer
	observer := NewTrafficObserver(slog.New(slog.NewJSONHandler(&output, nil)))
	router := NewRouter()
	router.Handle(stdhttp.MethodPatch, "/rules/:id", func(writer stdhttp.ResponseWriter, request *stdhttp.Request) {
		if request.PathValue("id") != "private-rule-id" {
			t.Fatal("Gin adapter lost URL parameter")
		}
		writer.WriteHeader(stdhttp.StatusConflict)
		_, _ = writer.Write([]byte("private-response"))
	})
	handler := RequestContext(observer.Observe(router.Handler()))
	request := httptest.NewRequest(stdhttp.MethodPatch, "/rules/private-rule-id?ticket=private-ticket", strings.NewReader("private-request-body"))
	request.Header.Set("Authorization", "Bearer private-bearer")
	request.Header.Set("X-App-Session", "private-session")
	request.Header.Set("Cookie", "private-cookie")
	request.Header.Set("X-Request-ID", "untrusted-client-id")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	snapshot := observer.Snapshot()
	if snapshot.InFlight != 0 || snapshot.Totals.Requests != 1 || snapshot.Totals.ClientErrors != 1 || snapshot.Totals.HTTPBytes != int64(len("private-response")) {
		t.Fatalf("counts = %+v", snapshot)
	}
	if len(snapshot.Routes) != 1 || snapshot.Routes[0].Route != "/rules/:id" {
		t.Fatalf("route = %+v", snapshot.Routes)
	}
	for _, sensitive := range []string{"private-rule-id", "private-ticket", "private-bearer", "private-session", "private-cookie", "private-request-body", "private-response", "untrusted-client-id"} {
		if strings.Contains(output.String(), sensitive) {
			t.Fatalf("logs leaked %s", sensitive)
		}
	}
	var event map[string]any
	if err := json.Unmarshal(output.Bytes(), &event); err != nil {
		t.Fatal(err)
	}
	if event["request_id"] != response.Header().Get("X-Request-ID") || event["route"] != "/rules/:id" || event["status"] != float64(409) {
		t.Fatalf("event = %+v", event)
	}
}

func TestTrafficRecoveryDoesNotDumpRequestsOrPanicValues(t *testing.T) {
	for _, useGin := range []bool{false, true} {
		t.Run(fmt.Sprintf("gin=%t", useGin), func(t *testing.T) {
			var output bytes.Buffer
			observer := NewTrafficObserver(slog.New(slog.NewJSONHandler(&output, nil)))
			panicHandler := stdhttp.HandlerFunc(func(stdhttp.ResponseWriter, *stdhttp.Request) { panic("private-panic-value") })
			var next stdhttp.Handler = panicHandler
			if useGin {
				router := NewRouter()
				router.Handle(stdhttp.MethodPost, "/panic", panicHandler)
				next = router.Handler()
			}
			handler := RequestContext(observer.Observe(next))
			request := httptest.NewRequest(stdhttp.MethodPost, "/panic?ticket=private-ticket", strings.NewReader("private-body"))
			request.Header.Set("X-App-Session", "private-session")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != 500 || !strings.Contains(response.Body.String(), `"code":"INTERNAL_ERROR"`) || response.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatalf("response = %d %s", response.Code, response.Body.String())
			}
			for _, sensitive := range []string{"private-panic-value", "private-ticket", "private-session", "private-body"} {
				if strings.Contains(output.String()+response.Body.String(), sensitive) {
					t.Fatalf("recovery leaked %s", sensitive)
				}
			}
			counts := observer.Snapshot().Totals
			if counts.ServerErrors != 1 || counts.Panics != 1 || counts.Requests != 1 {
				t.Fatalf("counts = %+v", counts)
			}
		})
	}
}

func TestGinRecoveryIsSafeWithoutObserver(t *testing.T) {
	router := NewRouter()
	router.Handle(stdhttp.MethodGet, "/panic", func(stdhttp.ResponseWriter, *stdhttp.Request) { panic("private-panic-value") })
	response := httptest.NewRecorder()
	RequestContext(router.Handler()).ServeHTTP(response, httptest.NewRequest(stdhttp.MethodGet, "/panic", nil))
	if response.Code != 500 || strings.Contains(response.Body.String(), "private-panic-value") {
		t.Fatalf("response = %d %s", response.Code, response.Body.String())
	}
}

func TestTrafficPartialResponsePanicAbortsWithoutFalseStatus(t *testing.T) {
	observer := NewTrafficObserver(nil)
	router := NewRouter()
	router.Handle(stdhttp.MethodGet, "/partial", func(writer stdhttp.ResponseWriter, _ *stdhttp.Request) {
		_, _ = writer.Write([]byte("partial"))
		panic("private-panic")
	})
	response := httptest.NewRecorder()
	func() {
		defer func() {
			if failure := recover(); failure != stdhttp.ErrAbortHandler {
				t.Fatalf("panic = %v", failure)
			}
		}()
		RequestContext(observer.Observe(router.Handler())).ServeHTTP(response, httptest.NewRequest(stdhttp.MethodGet, "/partial", nil))
		t.Fatal("partial response was not aborted")
	}()
	counts := observer.Snapshot().Totals
	if counts.Panics != 1 || counts.Aborted != 1 || counts.Successes != 1 || counts.ServerErrors != 0 || observer.Snapshot().InFlight != 0 {
		t.Fatalf("partial response counts = %+v", counts)
	}
	if response.Body.String() != "partial" {
		t.Fatalf("recovery appended JSON to committed response: %s", response.Body.String())
	}
}

func TestTrafficIntentionalAbortDoesNotInventHTTP200OrPanic(t *testing.T) {
	var output bytes.Buffer
	observer := NewTrafficObserver(slog.New(slog.NewJSONHandler(&output, nil)))
	router := NewRouter()
	router.Handle(stdhttp.MethodGet, "/abort", func(stdhttp.ResponseWriter, *stdhttp.Request) { panic(stdhttp.ErrAbortHandler) })
	func() {
		defer func() {
			if failure := recover(); failure != stdhttp.ErrAbortHandler {
				t.Fatalf("abort = %v", failure)
			}
		}()
		observer.Observe(router.Handler()).ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(stdhttp.MethodGet, "/abort", nil))
		t.Fatal("intentional abort was swallowed")
	}()
	counts := observer.Snapshot().Totals
	if counts.Aborted != 1 || counts.Panics != 0 || counts.Successes != 0 {
		t.Fatalf("intentional abort = %+v", counts)
	}
	var event map[string]any
	if err := json.Unmarshal(output.Bytes(), &event); err != nil || event["status"] != float64(0) || event["aborted"] != true {
		t.Fatalf("event = %+v %v", event, err)
	}
}

func TestTrafficConcurrentSnapshotsAreDetached(t *testing.T) {
	observer := NewTrafficObserver(nil)
	handler := observer.Observe(stdhttp.HandlerFunc(func(writer stdhttp.ResponseWriter, request *stdhttp.Request) {
		LabelRoute(request, "/health")
		_, _ = writer.Write([]byte("ok"))
	}))
	var workers sync.WaitGroup
	for i := 0; i < 100; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(stdhttp.MethodGet, "/health", nil))
			_ = observer.Snapshot()
		}()
	}
	workers.Wait()
	snapshot := observer.Snapshot()
	if snapshot.Totals.Requests != 100 || snapshot.Totals.Successes != 100 || snapshot.InFlight != 0 || snapshot.Totals.HTTPBytes != 200 {
		t.Fatalf("snapshot = %+v", snapshot)
	}
	snapshot.Routes[0].Route = "mutated"
	if observer.Snapshot().Routes[0].Route != "/health" {
		t.Fatal("snapshot exposed mutable observer state")
	}
}

func TestTrafficUnmatchedMethodsAndLabelsStayBounded(t *testing.T) {
	observer := NewTrafficObserver(nil)
	handler := observer.Observe(stdhttp.NotFoundHandler())
	for i := 0; i < 200; i++ {
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(fmt.Sprintf("PRIVATE%d", i), fmt.Sprintf("/private-id-%d?ticket=secret", i), nil))
	}
	snapshot := observer.Snapshot()
	if len(snapshot.Routes) != 1 || snapshot.Routes[0].Route != "_unmatched" || snapshot.Routes[0].Method != "OTHER" {
		t.Fatalf("unsafe labels = %+v", snapshot.Routes)
	}
	// Bound even mistakes made by server-side route registration code.
	for i := 0; i < 200; i++ {
		template := fmt.Sprintf("/registered/%d", i)
		next := observer.Observe(stdhttp.HandlerFunc(func(_ stdhttp.ResponseWriter, request *stdhttp.Request) { LabelRoute(request, template) }))
		next.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(stdhttp.MethodGet, "/", nil))
	}
	if len(observer.Snapshot().Routes) > maxTrafficRoutes+1 {
		t.Fatal("metric cardinality exceeded bound")
	}
}

func TestTrafficKeepsRawWebSocketUpgradeWorking(t *testing.T) {
	var output bytes.Buffer
	observer := NewTrafficObserver(slog.New(slog.NewJSONHandler(&output, nil)))
	completed := make(chan struct{})
	handler := RequestContext(observer.Observe(stdhttp.HandlerFunc(func(writer stdhttp.ResponseWriter, request *stdhttp.Request) {
		LabelRoute(request, "/api/v1/screener/ws")
		connection, err := platformws.Accept(writer, request, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer connection.CloseCompleted()
		ctx, cancel := context.WithTimeout(request.Context(), 3*time.Second)
		defer cancel()
		if raw, ok := connection.ReadText(ctx); !ok || string(raw) != "private-features" {
			t.Error("lost WebSocket frame through telemetry writer")
			return
		}
		_ = connection.WriteJSON(ctx, map[string]string{"type": "screener.result"})
	})))
	server := httptest.NewServer(stdhttp.HandlerFunc(func(writer stdhttp.ResponseWriter, request *stdhttp.Request) {
		defer close(completed)
		handler.ServeHTTP(writer, request)
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	connection, _, err := ws.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/api/v1/screener/ws?ticket=private-ticket", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.CloseNow()
	if err := connection.Write(ctx, ws.MessageText, []byte("private-features")); err != nil {
		t.Fatal(err)
	}
	if _, raw, err := connection.Read(ctx); err != nil || !bytes.Contains(raw, []byte("screener.result")) {
		t.Fatalf("result = %s %v", raw, err)
	}
	_ = connection.Close(ws.StatusNormalClosure, "completed")
	select {
	case <-completed:
	case <-ctx.Done():
		t.Fatal("WebSocket handler did not finish")
	}
	snapshot := observer.Snapshot()
	if snapshot.InFlight != 0 || snapshot.Totals.Requests != 1 || snapshot.Totals.Upgrades != 1 || snapshot.Totals.HTTPBytes != 0 {
		t.Fatalf("upgrade = %+v", snapshot)
	}
	// completed closes after the observer/logger finishes, avoiding a test race.
	if strings.Contains(output.String(), "private-ticket") || strings.Contains(output.String(), "private-features") {
		t.Fatal("WebSocket logs leaked ticket or frames")
	}
}

func TestTrafficSummariesStopAndUseOnlyGoRuntimeCounters(t *testing.T) {
	var output bytes.Buffer
	observer := NewTrafficObserver(slog.New(slog.NewJSONHandler(&output, nil)))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	screeningSummaries := 0
	observer.RunSummaries(ctx, 0, nil, func() { screeningSummaries++ })
	if screeningSummaries != 1 {
		t.Fatalf("shutdown screening summaries = %d", screeningSummaries)
	}
	var event map[string]any
	if err := json.Unmarshal(output.Bytes(), &event); err != nil {
		t.Fatal(err)
	}
	if event["msg"] != "backend_traffic_summary" || event["go_heap_alloc_bytes"] == nil || event["totals"] == nil {
		t.Fatalf("summary = %+v", event)
	}
	if event["cpu_usage"] != nil || event["process_rss"] != nil {
		t.Fatal("Go memory counters were falsely advertised as CPU/RSS")
	}
}

func TestTrafficWriterPreservesHTTPResponseSemantics(t *testing.T) {
	response := httptest.NewRecorder()
	writer := &trafficWriter{ResponseWriter: response}
	if writer.Unwrap() != response {
		t.Fatal("missing ResponseController unwrap")
	}
	writer.WriteHeader(103)
	if writer.status != 0 {
		t.Fatal("informational response counted as final")
	}
	// ResponseRecorder treats the first header as final; use a fresh recorder
	// here and test real 1xx behavior with a network server below.
	response = httptest.NewRecorder()
	writer = &trafficWriter{ResponseWriter: response}
	writer.WriteHeader(201)
	writer.WriteHeader(500)
	if writer.status != 201 {
		t.Fatal("duplicate WriteHeader changed status")
	}
	_, _ = writer.Write([]byte("abc"))
	if writer.bytes != 3 {
		t.Fatalf("bytes = %d", writer.bytes)
	}
	if err := writer.FlushError(); err != nil || !response.Flushed {
		t.Fatalf("flush = %v", err)
	}
	if _, _, err := writer.Hijack(); err == nil || writer.status != 201 {
		t.Fatal("unsupported hijack changed status")
	}
}

func TestTrafficWriterInformationalHeadersWithRealServer(t *testing.T) {
	observer := NewTrafficObserver(nil)
	completed := make(chan struct{})
	handler := observer.Observe(stdhttp.HandlerFunc(func(writer stdhttp.ResponseWriter, _ *stdhttp.Request) {
		writer.WriteHeader(103)
		writer.WriteHeader(201)
		_, _ = writer.Write([]byte("abc"))
	}))
	server := httptest.NewServer(stdhttp.HandlerFunc(func(writer stdhttp.ResponseWriter, request *stdhttp.Request) {
		defer close(completed)
		handler.ServeHTTP(writer, request)
	}))
	defer server.Close()
	response, err := server.Client().Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 201 {
		t.Fatalf("status = %d", response.StatusCode)
	}
	<-completed
	if counts := observer.Snapshot().Totals; counts.Successes != 1 || counts.HTTPBytes != 3 {
		t.Fatalf("counts = %+v", counts)
	}
}
