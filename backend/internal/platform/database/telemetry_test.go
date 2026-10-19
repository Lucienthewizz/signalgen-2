package database

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

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
		if suffix == "?connect_timeout=2" && cfg.ConnConfig.ConnectTimeout != 2*time.Second {
			t.Fatal("shorter deployment timeout was increased")
		}
	}
}

func TestDatabaseTimingsNeverLogQueriesArgumentsOrRawErrors(t *testing.T) {
	var output bytes.Buffer
	trace := &poolTracer{logger: slog.New(slog.NewJSONHandler(&output, nil))}
	ctx := trace.TraceQueryStart(context.Background(), nil, pgx.TraceQueryStartData{SQL: "select private-query", Args: []any{"private-token"}})
	trace.TraceQueryEnd(ctx, nil, pgx.TraceQueryEndData{Err: errors.New("private-password")})
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
	for _, expected := range []string{`"stage":"query"`, `"stage":"acquire"`, `"stage":"connect"`, `"outcome":"timeout"`, `"outcome":"canceled"`} {
		if !strings.Contains(logs, expected) {
			t.Fatalf("missing safe timing %s", expected)
		}
	}
}
