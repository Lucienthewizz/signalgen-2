// Package observability adapts domain measurements to private operational logs.
// Counters are process-local, bounded and not a durable audit or billing ledger.
package observability

import (
	"encoding/hex"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/screener"
)

type ScreenerObserver struct {
	mu                                        sync.Mutex
	logger                                    *slog.Logger
	attempts                                  int64
	upgrades                                  int64
	replies                                   int64
	counts                                    map[screener.Outcome]int64
	candidates, receivedBytes, durationMicros int64
	stages                                    [screener.StageCount]int64
}

type ScreenerSnapshot struct {
	Attempts       int64            `json:"attempts"`
	Upgrades       int64            `json:"upgrades"`
	RepliesWritten int64            `json:"replies_written"`
	Outcomes       map[string]int64 `json:"outcomes"`
	Candidates     int64            `json:"contract_candidate_count"`
	ReceivedBytes  int64            `json:"received_text_bytes"`
	DurationMicros int64            `json:"duration_us_total"`
	Stages         map[string]int64 `json:"stage_duration_us_total"`
}

func NewScreenerObserver(logger *slog.Logger) *ScreenerObserver {
	observer := &ScreenerObserver{logger: logger, counts: make(map[screener.Outcome]int64)}
	for _, outcome := range screener.Outcomes() {
		observer.counts[outcome] = 0
	}
	return observer
}

// Record accepts only bounded labels and aggregate numbers. A future adapter
// mistake cannot turn a raw database error or client ID into a metric/log label.
func (observer *ScreenerObserver) Record(event screener.Observation) {
	observer.mu.Lock()
	if _, valid := observer.counts[event.Outcome]; !valid {
		event.Outcome = screener.OutcomeInternal
	}
	// A computation or upgrade alone must never become a successful result.
	if event.Outcome == screener.OutcomeWritten && (!event.Upgraded || !event.ReplyWritten) {
		event.Outcome = screener.OutcomeInternal
	}
	if event.FailedStage >= screener.StageCount {
		event.FailedStage = screener.StageNone
	}
	event.RequestID = safeRequestID(event.RequestID)
	event.Candidates = boundedCount(event.Candidates, screener.MaxCandidates)
	event.ReceivedBytes = boundedCount(event.ReceivedBytes, int(screener.MaxMessageBytes))
	event.Duration = nonnegative(event.Duration)
	observer.attempts++
	observer.counts[event.Outcome]++
	if event.Upgraded {
		observer.upgrades++
	}
	if event.ReplyWritten {
		observer.replies++
	}
	observer.candidates += int64(event.Candidates)
	observer.receivedBytes += int64(event.ReceivedBytes)
	observer.durationMicros += event.Duration.Microseconds()
	var stageMicros map[string]int64
	if observer.logger != nil {
		stageMicros = make(map[string]int64, int(screener.StageCount)-1)
	}
	for stage := screener.StageAuthorize; stage < screener.StageCount; stage++ {
		duration := nonnegative(event.StageDurations[stage]).Microseconds()
		observer.stages[stage] += duration
		if stageMicros != nil {
			stageMicros[stage.String()] = duration
		}
	}
	observer.mu.Unlock()
	if observer.logger != nil {
		// Log no raw errors, request/client structs or decision/feature payloads.
		observer.logger.Info("screener_evaluation", "request_id", event.RequestID,
			"outcome", string(event.Outcome), "failed_stage", event.FailedStage.String(),
			"upgraded", event.Upgraded, "reply_written", event.ReplyWritten,
			"contract_candidate_count", event.Candidates, "received_text_bytes", event.ReceivedBytes,
			"duration_us", event.Duration.Microseconds(), "stage_duration_us", stageMicros)
	}
}

func (observer *ScreenerObserver) Snapshot() ScreenerSnapshot {
	observer.mu.Lock()
	defer observer.mu.Unlock()
	snapshot := ScreenerSnapshot{
		Attempts: observer.attempts, Upgrades: observer.upgrades, RepliesWritten: observer.replies,
		Candidates: observer.candidates, ReceivedBytes: observer.receivedBytes, DurationMicros: observer.durationMicros,
		Outcomes: make(map[string]int64, len(observer.counts)), Stages: make(map[string]int64),
	}
	for outcome, count := range observer.counts {
		snapshot.Outcomes[string(outcome)] = count
	}
	for stage := screener.StageAuthorize; stage < screener.StageCount; stage++ {
		snapshot.Stages[stage.String()] = observer.stages[stage]
	}
	return snapshot
}

// LogSummary is called beside the HTTP summary; no extra timer/goroutine needed.
func (observer *ScreenerObserver) LogSummary() {
	if observer.logger != nil {
		observer.logger.Info("screener_summary", "screening", observer.Snapshot())
	}
}

func safeRequestID(value string) string {
	if len(value) == len("req_")+24 && strings.HasPrefix(value, "req_") {
		if _, err := hex.DecodeString(value[4:]); err == nil {
			return value
		}
	}
	return "req_unavailable"
}

func boundedCount(value, maximum int) int {
	if value < 0 || value > maximum {
		return 0
	}
	return value
}

func nonnegative(value time.Duration) time.Duration {
	if value < 0 {
		return 0
	}
	return value
}
