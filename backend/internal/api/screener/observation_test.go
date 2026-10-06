package screenerapi

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
)

type observationCapture struct{ events []screener.Observation }

func (capture *observationCapture) Record(event screener.Observation) {
	capture.events = append(capture.events, event)
}

type fakeResultWriter struct{ err error }

func (writer fakeResultWriter) WriteJSON(context.Context, any) error { return writer.err }

type fakeClose struct{ closed bool }

func (close *fakeClose) CloseCompleted() error { close.closed = true; return nil }

func TestResultWriteOutcomeIsNotComputedDecisionSuccess(t *testing.T) {
	for _, tc := range []struct {
		name     string
		err      error
		cancel   bool
		deadline bool
		outcome  screener.Outcome
	}{
		{name: "written", outcome: screener.OutcomeWritten},
		{name: "broken-write", err: errors.New("private-socket-error"), outcome: screener.OutcomeWrite},
		{name: "canceled", err: errors.New("private-error"), cancel: true, outcome: screener.OutcomeCanceled},
		{name: "deadline", err: errors.New("private-error"), deadline: true, outcome: screener.OutcomeDeadline},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if tc.cancel {
				cancel()
			}
			if tc.deadline {
				var stop context.CancelFunc
				ctx, stop = context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
				defer stop()
			}
			capture := &observationCapture{}
			trace := newEvaluationTrace(capture, "req_0123456789abcdef01234567")
			trace.event.Upgraded = true
			func() {
				defer trace.finish()
				trace.begin(screener.StageEvaluate)
				if trace.writeResult(ctx, fakeResultWriter{tc.err}, struct{}{}) != (tc.err == nil) {
					t.Fatal("wrong result delivery state")
				}
			}()
			if len(capture.events) != 1 || capture.events[0].Outcome != tc.outcome || capture.events[0].ReplyWritten != (tc.err == nil) {
				t.Fatalf("outcome = %+v", capture.events)
			}
			if tc.err != nil && capture.events[0].FailedStage != screener.StageWrite {
				t.Fatal("write failure lost its stage")
			}
		})
	}
}

func TestTraceRethrowsPanicAndPreservesStageBeforeClose(t *testing.T) {
	capture := &observationCapture{}
	trace := newEvaluationTrace(capture, "req_0123456789abcdef01234567")
	connection := &fakeClose{}
	marker := errors.New("private-panic-details")
	func() {
		defer func() {
			if recover() != marker {
				t.Fatal("trace swallowed or changed panic")
			}
		}()
		func() {
			defer trace.finish()
			defer trace.closeCompleted(connection)
			trace.begin(screener.StageRecheck)
			panic(marker)
		}()
	}()
	if !connection.closed || len(capture.events) != 1 || capture.events[0].Outcome != screener.OutcomePanic || capture.events[0].FailedStage != screener.StageRecheck {
		t.Fatalf("panic/cleanup = %+v", capture.events)
	}
	var sum time.Duration
	for _, duration := range capture.events[0].StageDurations {
		sum += duration
	}
	if sum != capture.events[0].Duration {
		t.Fatal("stage timing double-counted or omitted handler time")
	}
}

func TestTraceWorksWithoutConfiguredObserver(t *testing.T) {
	trace := newEvaluationTrace(nil, "")
	func() { defer trace.finish(); trace.fail(screener.OutcomeRejected) }()
}
