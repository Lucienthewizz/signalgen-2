package screenerapi

import (
	"context"
	"errors"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
)

// evaluationTrace measures one socket attempt without copying any private data.
// It is request-local and used by one goroutine; aggregate observers synchronize.
type evaluationTrace struct {
	observer              screener.Observer
	event                 screener.Observation
	started, stageStarted time.Time
	stage                 screener.Stage
}

func newEvaluationTrace(observer screener.Observer, requestID string) *evaluationTrace {
	now := time.Now()
	return &evaluationTrace{observer: observer, started: now, stageStarted: now,
		stage: screener.StageAuthorize,
		event: screener.Observation{RequestID: requestID, Outcome: screener.OutcomeInternal}}
}

func (trace *evaluationTrace) begin(stage screener.Stage) {
	now := time.Now()
	trace.event.StageDurations[trace.stage] += now.Sub(trace.stageStarted)
	trace.stage, trace.stageStarted = stage, now
}

func (trace *evaluationTrace) fail(outcome screener.Outcome) {
	trace.event.Outcome, trace.event.FailedStage = outcome, trace.stage
}

// finish must be directly deferred. It observes panics but rethrows unchanged
// so the safe HTTP recovery layer remains responsible for the response.
func (trace *evaluationTrace) finish() {
	failure := recover()
	if failure != nil && trace.event.Outcome != screener.OutcomePanic {
		trace.fail(screener.OutcomePanic)
	}
	now := time.Now()
	trace.event.StageDurations[trace.stage] += now.Sub(trace.stageStarted)
	trace.event.Duration = now.Sub(trace.started)
	if trace.observer != nil {
		trace.observer.Record(trace.event)
	}
	if failure != nil {
		panic(failure)
	}
}

// closeCompleted is directly deferred so a panic's original stage is captured
// before cleanup starts. It rethrows the panic, never logging its value.
func (trace *evaluationTrace) closeCompleted(connection interface{ CloseCompleted() error }) {
	failure := recover()
	if failure != nil {
		trace.fail(screener.OutcomePanic)
	}
	trace.begin(screener.StageClose)
	_ = connection.CloseCompleted()
	if failure != nil {
		panic(failure)
	}
}

type resultWriter interface {
	WriteJSON(context.Context, any) error
}

// A computed decision is not a delivered result. Only a successful WriteJSON
// reaches result_written; client receipt/display is still not proven.
func (trace *evaluationTrace) writeResult(ctx context.Context, writer resultWriter, value any) bool {
	trace.begin(screener.StageWrite)
	if err := writer.WriteJSON(ctx, value); err != nil {
		trace.transportFailure(ctx, screener.OutcomeWrite)
		return false
	}
	trace.event.Outcome, trace.event.FailedStage = screener.OutcomeWritten, screener.StageNone
	trace.event.ReplyWritten = true
	return true
}

func (trace *evaluationTrace) transportFailure(ctx context.Context, fallback screener.Outcome) {
	switch {
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		trace.fail(screener.OutcomeDeadline)
	case errors.Is(ctx.Err(), context.Canceled):
		trace.fail(screener.OutcomeCanceled)
	default:
		trace.fail(fallback)
	}
}
