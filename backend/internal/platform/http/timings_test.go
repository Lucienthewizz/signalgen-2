package http

import (
	"bytes"
	"encoding/json"
	"log/slog"
	stdhttp "net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestRequestTimingsAreBoundedConcurrentAndRequestScoped(t *testing.T) {
	var output bytes.Buffer
	observer := NewTrafficObserver(slog.New(slog.NewJSONHandler(&output, nil)))
	handler := observer.Observe(stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		if r.URL.Path == "/timed" {
			var readers sync.WaitGroup
			for i := 0; i < 10; i++ {
				readers.Add(1)
				go func() { defer readers.Done(); RecordTiming(r.Context(), AuthLocal, time.Millisecond) }()
			}
			readers.Wait()
			RecordTiming(r.Context(), DBQuery, 2*time.Millisecond)
			RecordTiming(r.Context(), TimingStage(255), time.Hour)
		}
		w.WriteHeader(200)
	}))
	for _, path := range []string{"/timed", "/empty"} {
		output.Reset()
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", path, nil))
		var entry struct {
			Timings map[string]int64 `json:"timings_us"`
		}
		if err := json.Unmarshal(output.Bytes(), &entry); err != nil {
			t.Fatal(err)
		}
		if path == "/timed" && (len(entry.Timings) != 2 || entry.Timings["auth_local"] != 10000 || entry.Timings["db_query"] != 2000) {
			t.Fatalf("timings = %v", entry.Timings)
		}
		if path == "/empty" && len(entry.Timings) != 0 {
			t.Fatal("timings crossed requests")
		}
	}
}
