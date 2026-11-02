package database

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	platformhttp "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestConnectionConfigBoundsEveryConnectWithoutIncreasingPool(t *testing.T) {
	for _, suffix := range []string{"", "?connect_timeout=30", "?connect_timeout=2"} {
		cfg, err := postgresConfig("postgres://fixture:synthetic-secret@example.invalid/database"+suffix, nil)
		if err != nil {
			t.Fatal("configuration rejected")
		}
		if cfg.ConnConfig.ConnectTimeout <= 0 || cfg.ConnConfig.ConnectTimeout > 5*time.Second || cfg.MaxConns != 5 {
			t.Fatal("connection budget or pool limit is unsafe")
		}
		if cfg.MinConns != 0 || cfg.MaxConnIdleTime != 10*time.Minute || cfg.ShouldPing == nil ||
			cfg.ShouldPing(context.Background(), pgxpool.ShouldPingParams{IdleDuration: 2 * time.Second}) ||
			!cfg.ShouldPing(context.Background(), pgxpool.ShouldPingParams{IdleDuration: 30 * time.Second}) {
			t.Fatal("pool warmth or idle-ping policy changed unexpectedly")
		}
		if suffix == "?connect_timeout=2" && cfg.ConnConfig.ConnectTimeout != 2*time.Second {
			t.Fatal("shorter deployment timeout was increased")
		}
	}
}

func TestFastDatabaseOperationsReachSafeRequestTimings(t *testing.T) {
	var output bytes.Buffer
	observer := platformhttp.NewTrafficObserver(slog.New(slog.NewJSONHandler(&output, nil)))
	trace := &poolTracer{slow: time.Hour}
	handler := observer.Observe(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, stage := range []string{"query", "batch", "acquire", "connect"} {
			ctx := trace.start(r.Context(), stage)
			trace.end(ctx, stage, nil)
		}
		w.WriteHeader(200)
	}))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/timings", nil))
	var event struct {
		Timings map[string]int64 `json:"timings_us"`
	}
	if err := json.Unmarshal(output.Bytes(), &event); err != nil {
		t.Fatal(err)
	}
	for _, stage := range []string{"db_query", "db_batch", "db_acquire", "db_connect"} {
		if _, ok := event.Timings[stage]; !ok {
			t.Fatalf("fast %s timing was dropped", stage)
		}
	}
}

func TestDatabaseTimingsNeverLogQueriesArgumentsOrRawErrors(t *testing.T) {
	var output bytes.Buffer
	trace := &poolTracer{logger: slog.New(slog.NewJSONHandler(&output, nil))}
	ctx := trace.TraceQueryStart(context.Background(), nil, pgx.TraceQueryStartData{SQL: "select private-query", Args: []any{"private-token"}})
	trace.TraceQueryEnd(ctx, nil, pgx.TraceQueryEndData{Err: errors.New("private-password")})
	batch := &pgx.Batch{}
	batch.Queue("select private-query", "private-token")
	ctx = trace.TraceBatchStart(context.Background(), nil, pgx.TraceBatchStartData{Batch: batch})
	trace.TraceBatchQuery(ctx, nil, pgx.TraceBatchQueryData{SQL: "select private-query", Args: []any{"private-token"}})
	trace.TraceBatchEnd(ctx, nil, pgx.TraceBatchEndData{Err: errors.New("private-password")})
	ctx = trace.TraceAcquireStart(context.Background(), nil, pgxpool.TraceAcquireStartData{})
	trace.TraceAcquireEnd(ctx, nil, pgxpool.TraceAcquireEndData{Err: context.DeadlineExceeded})
	ctx = trace.TraceConnectStart(context.Background(), pgx.TraceConnectStartData{})
	trace.TraceConnectEnd(ctx, pgx.TraceConnectEndData{Err: context.Canceled})
	logs := output.String()
	for _, private := range []string{"private-query", "private-token", "private-password"} {
		if strings.Contains(logs, private) {
			t.Fatal("sensitive database context was logged")
		}
	}
	for _, expected := range []string{`"stage":"query"`, `"stage":"batch"`, `"stage":"acquire"`, `"stage":"connect"`, `"outcome":"timeout"`, `"outcome":"canceled"`} {
		if !strings.Contains(logs, expected) {
			t.Fatalf("missing safe timing %s", expected)
		}
	}
}
