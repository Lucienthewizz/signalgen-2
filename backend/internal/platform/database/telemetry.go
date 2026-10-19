package database

import (
	"context"
	"errors"
	"log/slog"
	"time"

	platformhttp "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/http"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Durations separate connection creation, pool waiting and SQL round trips.
// Never record SQL, arguments, URLs, credentials, user IDs or raw error strings.
type poolTracer struct {
	logger *slog.Logger
	slow   time.Duration
}
type databaseTimingKey string

var (
	_ pgx.QueryTracer       = (*poolTracer)(nil)
	_ pgx.ConnectTracer     = (*poolTracer)(nil)
	_ pgxpool.AcquireTracer = (*poolTracer)(nil)
)

func (trace *poolTracer) start(ctx context.Context, stage string) context.Context {
	return context.WithValue(ctx, databaseTimingKey(stage), time.Now())
}

func (trace *poolTracer) end(ctx context.Context, stage string, err error) {
	started, ok := ctx.Value(databaseTimingKey(stage)).(time.Time)
	if !ok {
		return
	}
	elapsed := time.Since(started)
	if err == nil && elapsed < trace.slow {
		return
	}
	outcome := "ok"
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		outcome = "timeout"
	case errors.Is(err, context.Canceled):
		outcome = "canceled"
	case err != nil:
		outcome = "error"
	}
	trace.logger.Warn("database_operation", "request_id", platformhttp.RequestID(ctx),
		"stage", stage, "duration_us", elapsed.Microseconds(), "outcome", outcome)
}

func (trace *poolTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryStartData) context.Context {
	return trace.start(ctx, "query")
}
func (trace *poolTracer) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData) {
	trace.end(ctx, "query", data.Err)
}
func (trace *poolTracer) TraceAcquireStart(ctx context.Context, _ *pgxpool.Pool, _ pgxpool.TraceAcquireStartData) context.Context {
	return trace.start(ctx, "acquire")
}
func (trace *poolTracer) TraceAcquireEnd(ctx context.Context, _ *pgxpool.Pool, data pgxpool.TraceAcquireEndData) {
	trace.end(ctx, "acquire", data.Err)
}
func (trace *poolTracer) TraceConnectStart(ctx context.Context, _ pgx.TraceConnectStartData) context.Context {
	return trace.start(ctx, "connect")
}
func (trace *poolTracer) TraceConnectEnd(ctx context.Context, data pgx.TraceConnectEndData) {
	trace.end(ctx, "connect", data.Err)
}

// Pool counters explain saturation without exposing a public metrics endpoint.
func LogPoolSummary(logger *slog.Logger, pool *pgxpool.Pool) {
	stats := pool.Stat()
	logger.Info("database_pool_summary", "total", stats.TotalConns(), "acquired", stats.AcquiredConns(),
		"idle", stats.IdleConns(), "max", stats.MaxConns(), "acquire_count", stats.AcquireCount(),
		"acquire_duration_us", stats.AcquireDuration().Microseconds(), "canceled_acquires", stats.CanceledAcquireCount())
}
