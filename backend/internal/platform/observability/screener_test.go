package observability

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
)

func TestScreenerObserverOnlyLogsBoundedMeasurements(t *testing.T) {
	var output bytes.Buffer
	observer := NewScreenerObserver(slog.New(slog.NewJSONHandler(&output, nil)))
	observer.Record(screener.Observation{
		RequestID: "private-client-token", Outcome: screener.Outcome("private-database-error"),
		FailedStage: screener.Stage(250), Candidates: screener.MaxCandidates + 1,
		ReceivedBytes: int(screener.MaxMessageBytes) + 1, Duration: -time.Second,
		StageDurations: [screener.StageCount]time.Duration{screener.StageEvaluate: -time.Second},
	})
	var event map[string]any
	if err := json.Unmarshal(output.Bytes(), &event); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(output.String(), "private-") || event["request_id"] != "req_unavailable" || event["outcome"] != string(screener.OutcomeInternal) || event["failed_stage"] != "none" {
		t.Fatalf("unsafe event = %+v", event)
	}
	snapshot := observer.Snapshot()
	if snapshot.Attempts != 1 || snapshot.Outcomes[string(screener.OutcomeInternal)] != 1 ||
		snapshot.Candidates != 0 || snapshot.ReceivedBytes != 0 || snapshot.DurationMicros != 0 || snapshot.Stages["evaluate"] != 0 || len(snapshot.Outcomes) != len(screener.Outcomes()) {
		t.Fatalf("invalid observation entered counters: %+v", snapshot)
	}
}

func TestScreenerObserverCorrelatesServerIDsAndSeparatesUpgradeFromWrittenResult(t *testing.T) {
	var output bytes.Buffer
	observer := NewScreenerObserver(slog.New(slog.NewJSONHandler(&output, nil)))
	requestID := "req_0123456789abcdef01234567"
	observer.Record(screener.Observation{RequestID: requestID, Outcome: screener.OutcomeInvalid,
		FailedStage: screener.StageValidate, Upgraded: true, ReplyWritten: true, ReceivedBytes: 30,
		Duration: 10 * time.Millisecond, StageDurations: [screener.StageCount]time.Duration{screener.StageValidate: time.Millisecond}})
	observer.Record(screener.Observation{RequestID: requestID, Outcome: screener.OutcomeWrite,
		FailedStage: screener.StageWrite, Upgraded: true, Candidates: 5, Duration: time.Millisecond})
	observer.Record(screener.Observation{RequestID: requestID, Outcome: screener.OutcomeWritten,
		Upgraded: true, ReplyWritten: true, Candidates: 8, ReceivedBytes: 200, Duration: time.Millisecond})
	snapshot := observer.Snapshot()
	if snapshot.Attempts != 3 || snapshot.Upgrades != 3 || snapshot.RepliesWritten != 2 || snapshot.Candidates != 13 || snapshot.Outcomes[string(screener.OutcomeWritten)] != 1 || snapshot.Stages["validate"] != 1000 {
		t.Fatalf("outcomes = %+v", snapshot)
	}
	for _, line := range strings.Split(strings.TrimSpace(output.String()), "\n") {
		var event map[string]any
		if err := json.Unmarshal([]byte(line), &event); err != nil || event["request_id"] != requestID {
			t.Fatalf("missing server correlation ID: %s %v", line, err)
		}
	}
	observer.LogSummary()
	if !strings.Contains(output.String(), `"msg":"screener_summary"`) {
		t.Fatal("missing aggregate summary")
	}
}

func TestScreenerObserverIsConcurrentAndSnapshotsAreDetached(t *testing.T) {
	observer := NewScreenerObserver(nil)
	var workers sync.WaitGroup
	for i := 0; i < 300; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			observer.Record(screener.Observation{Outcome: screener.OutcomeWritten, Upgraded: true, ReplyWritten: true, Candidates: 2})
			_ = observer.Snapshot()
		}()
	}
	workers.Wait()
	snapshot := observer.Snapshot()
	if snapshot.Attempts != 300 || snapshot.Candidates != 600 || snapshot.Outcomes[string(screener.OutcomeWritten)] != 300 {
		t.Fatalf("race lost measurements: %+v", snapshot)
	}
	snapshot.Outcomes["private-dynamic-label"] = 999
	snapshot.Stages["evaluate"] = 999
	if snapshot := observer.Snapshot(); len(snapshot.Outcomes) != len(screener.Outcomes()) || snapshot.Stages["evaluate"] != 0 {
		t.Fatal("snapshot mutated internal counter maps")
	}
}

func TestScreenerObserverRejectsFalseSuccessfulResults(t *testing.T) {
	observer := NewScreenerObserver(nil)
	observer.Record(screener.Observation{Outcome: screener.OutcomeWritten, Upgraded: true})
	observer.Record(screener.Observation{Outcome: screener.OutcomeWritten, ReplyWritten: true})
	if snapshot := observer.Snapshot(); snapshot.Outcomes[string(screener.OutcomeWritten)] != 0 || snapshot.Outcomes[string(screener.OutcomeInternal)] != 2 {
		t.Fatalf("incomplete deliveries counted as results: %+v", snapshot)
	}
}
