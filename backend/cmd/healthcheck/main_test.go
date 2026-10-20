package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/platform/healthcheck"
)

func TestProbeWaitsForColdReadinessAndRejectsNonReadyStatus(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusServiceUnavailable, http.StatusInternalServerError} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if status == http.StatusOK {
					time.Sleep(2100 * time.Millisecond)
				}
				w.WriteHeader(status)
			}))
			defer server.Close()
			err := check(&http.Client{Timeout: healthcheck.ProbeTimeout}, server.URL)
			if (err == nil) != (status == http.StatusOK) {
				t.Fatalf("status=%d error=%v", status, err)
			}
		})
	}
}

func TestProbeReportsConnectionFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	server.Close()
	if err := check(&http.Client{Timeout: healthcheck.ProbeTimeout}, server.URL); err == nil {
		t.Fatal("unreachable backend reported ready")
	}
}
