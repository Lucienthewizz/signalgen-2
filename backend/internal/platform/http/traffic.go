package http

import (
	"context"
	"log/slog"
	stdhttp "net/http"
	"runtime"
	"sort"
	"sync"
	"time"
)

const maxTrafficRoutes = 128

// TrafficObserver keeps process-local operational counters, not user analytics.
// It never reads request bodies, headers, query strings, IPs or resource IDs.
// Only route templates assigned by server code can become metric labels.
type TrafficObserver struct {
	mu       sync.Mutex
	logger   *slog.Logger
	started  time.Time
	inFlight int64
	totals   TrafficCounts
	routes   map[routeKey]TrafficCounts
}

type routeKey struct{ method, route string }
type trafficKey struct{}
type requestTraffic struct {
	route    string
	panicked bool
	aborted  bool
}

// TrafficCounts contains cumulative counts since this process started. Duration
// includes handler time only; WebSocket duration covers its entire handler life.
// HTTPBytes excludes WebSocket frames, which bypass ResponseWriter after hijack.
type TrafficCounts struct {
	Requests       int64 `json:"requests"`
	Successes      int64 `json:"successes"`
	Redirects      int64 `json:"redirects"`
	ClientErrors   int64 `json:"client_errors"`
	ServerErrors   int64 `json:"server_errors"`
	Upgrades       int64 `json:"upgrades"`
	Panics         int64 `json:"panics"`
	Aborted        int64 `json:"aborted"`
	HTTPBytes      int64 `json:"http_response_bytes"`
	DurationMicros int64 `json:"duration_us_total"`
	MaxMicros      int64 `json:"duration_us_max"`
}

type RouteTraffic struct {
	Method string `json:"method"`
	Route  string `json:"route"`
	TrafficCounts
}

type TrafficSnapshot struct {
	InFlight int64          `json:"in_flight"`
	Totals   TrafficCounts  `json:"totals"`
	Routes   []RouteTraffic `json:"routes"`
}

// A nil logger disables output, not counters, making tests deterministic.
func NewTrafficObserver(logger *slog.Logger) *TrafficObserver {
	return &TrafficObserver{logger: logger, started: time.Now(), routes: make(map[routeKey]TrafficCounts)}
}

// Observe must sit inside RequestContext but outside CORS and routing, so even
// rejected preflights and missing routes receive one server-generated request ID.
// The writer adapter preserves ResponseController/hijacking for raw WebSocket.
func (observer *TrafficObserver) Observe(next stdhttp.Handler) stdhttp.Handler {
	return stdhttp.HandlerFunc(func(writer stdhttp.ResponseWriter, request *stdhttp.Request) {
		started := time.Now()
		trace := &requestTraffic{route: "_unmatched"}
		if request.Method == stdhttp.MethodOptions {
			trace.route = "_preflight"
		}
		request = request.WithContext(context.WithValue(request.Context(), trafficKey{}, trace))
		captured := &trafficWriter{ResponseWriter: writer}
		observer.mu.Lock()
		observer.inFlight++
		observer.mu.Unlock()
		defer func() {
			failure := recover()
			abort := failure != nil && (captured.status != 0 || failure == stdhttp.ErrAbortHandler)
			trace.aborted = abort
			if failure != nil {
				// ErrAbortHandler can be an intentional transport abort. Preserve
				// an actual panic already marked by Gin, without inventing one.
				trace.panicked = trace.panicked || failure != stdhttp.ErrAbortHandler
				// Never print the panic value or original request. An already
				// committed response/upgraded connection cannot become HTTP 500.
				if captured.status == 0 && failure != stdhttp.ErrAbortHandler {
					WriteError(captured, request, stdhttp.StatusInternalServerError, "INTERNAL_ERROR", "Terjadi kesalahan internal.")
				}
			}
			status := captured.status
			if status == 0 && !abort {
				status = stdhttp.StatusOK
			}
			observer.record(request, trace, status, captured.bytes, time.Since(started))
			if abort {
				// Let net/http abort a partial HTTP response or upgraded socket
				// without logging its default stack/request details.
				panic(stdhttp.ErrAbortHandler)
			}
		}()
		next.ServeHTTP(captured, request)
	})
}

// LabelRoute is called with constants/templates from the router, never URL.Path.
// Client-supplied IDs therefore do not leak into logs or grow metric cardinality.
func LabelRoute(request *stdhttp.Request, template string) {
	if trace, ok := request.Context().Value(trafficKey{}).(*requestTraffic); ok {
		trace.route = template
	}
}

func markRequestPanic(request *stdhttp.Request) {
	if trace, ok := request.Context().Value(trafficKey{}).(*requestTraffic); ok {
		trace.panicked = true
	}
}

func (observer *TrafficObserver) record(request *stdhttp.Request, trace *requestTraffic, status int, size int64, elapsed time.Duration) {
	key := routeKey{safeMethod(request.Method), trace.route}
	observer.mu.Lock()
	// A hard ceiling also guards accidental registration of dynamic templates.
	if _, exists := observer.routes[key]; !exists && len(observer.routes) >= maxTrafficRoutes {
		key = routeKey{"OTHER", "_overflow"}
	}
	counts := observer.routes[key]
	counts.add(status, size, elapsed, trace.panicked, trace.aborted)
	observer.routes[key] = counts
	observer.totals.add(status, size, elapsed, trace.panicked, trace.aborted)
	observer.inFlight--
	observer.mu.Unlock()
	if observer.logger != nil {
		level := slog.LevelInfo
		if status >= 500 || trace.panicked || trace.aborted {
			level = slog.LevelError
		}
		// Use an explicit allowlist, not a generic request/error serializer.
		observer.logger.Log(context.Background(), level, "http_request",
			"request_id", RequestID(request.Context()), "method", key.method,
			"route", key.route, "status", status, "duration_us", elapsed.Microseconds(),
			"http_response_bytes", size, "panicked", trace.panicked, "aborted", trace.aborted)
	}
}

func (counts *TrafficCounts) add(status int, size int64, elapsed time.Duration, panicked, aborted bool) {
	counts.Requests++
	switch {
	case status == stdhttp.StatusSwitchingProtocols:
		counts.Upgrades++
	case status >= 200 && status < 300:
		counts.Successes++
	case status >= 300 && status < 400:
		counts.Redirects++
	case status >= 400 && status < 500:
		counts.ClientErrors++
	case status >= 500:
		counts.ServerErrors++
	}
	if panicked {
		counts.Panics++
	}
	if aborted {
		counts.Aborted++
	}
	counts.HTTPBytes += size
	micros := elapsed.Microseconds()
	counts.DurationMicros += micros
	if micros > counts.MaxMicros {
		counts.MaxMicros = micros
	}
}

// Snapshot returns detached, sorted values safe for tests or private tooling.
// There is intentionally no unauthenticated public /metrics endpoint.
func (observer *TrafficObserver) Snapshot() TrafficSnapshot {
	observer.mu.Lock()
	defer observer.mu.Unlock()
	snapshot := TrafficSnapshot{InFlight: observer.inFlight, Totals: observer.totals, Routes: make([]RouteTraffic, 0, len(observer.routes))}
	for key, counts := range observer.routes {
		snapshot.Routes = append(snapshot.Routes, RouteTraffic{key.method, key.route, counts})
	}
	sort.Slice(snapshot.Routes, func(i, j int) bool {
		left, right := snapshot.Routes[i], snapshot.Routes[j]
		if left.Route == right.Route {
			return left.Method < right.Method
		}
		return left.Route < right.Route
	})
	return snapshot
}

// RunSummaries emits a bounded aggregate periodically and once on shutdown.
// Go heap/runtime counters are not process RSS, CPU usage or browser metrics.
func (observer *TrafficObserver) RunSummaries(ctx context.Context, interval time.Duration, additional ...func()) {
	if interval <= 0 {
		interval = time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	logAll := func() {
		observer.LogSummary()
		for _, summarize := range additional {
			if summarize != nil {
				summarize()
			}
		}
	}
	for {
		select {
		case <-ticker.C:
			logAll()
		case <-ctx.Done():
			logAll()
			return
		}
	}
}

func (observer *TrafficObserver) LogSummary() {
	if observer.logger == nil {
		return
	}
	snapshot := observer.Snapshot()
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	observer.logger.Info("backend_traffic_summary", "uptime_seconds", int64(time.Since(observer.started).Seconds()),
		"in_flight", snapshot.InFlight, "totals", snapshot.Totals,
		"goroutines", runtime.NumGoroutine(), "go_heap_alloc_bytes", memory.HeapAlloc,
		"go_memory_sys_bytes", memory.Sys)
}

func safeMethod(method string) string {
	switch method {
	case stdhttp.MethodGet, stdhttp.MethodHead, stdhttp.MethodPost, stdhttp.MethodPut,
		stdhttp.MethodPatch, stdhttp.MethodDelete, stdhttp.MethodOptions, stdhttp.MethodConnect, stdhttp.MethodTrace:
		return method
	default:
		return "OTHER"
	}
}
