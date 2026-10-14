package screener

import "time"

// Observation carries operational measurements only. No user, dataset, rule,
// symbol, token, client message ID or raw error can cross this observer boundary.
// RequestID is the server-generated HTTP correlation ID, not a client claim.
type Observation struct {
	RequestID      string
	Outcome        Outcome
	FailedStage    Stage
	Upgraded       bool
	ReplyWritten   bool
	Candidates     int
	ReceivedBytes  int
	Duration       time.Duration
	StageDurations [StageCount]time.Duration
}

// Observer implementations must not retain per-user state or serialize errors.
// This contract has no dependency on Gin, net/http, WebSocket or storage.
type Observer interface{ Record(Observation) }

type Outcome string

const (
	OutcomeWritten     Outcome = "result_written"
	OutcomeRejected    Outcome = "authorization_rejected"
	OutcomeInvalid     Outcome = "invalid_message"
	OutcomeUnavailable Outcome = "service_unavailable"
	OutcomeCapacity    Outcome = "capacity_rejected"
	OutcomeUpgrade     Outcome = "upgrade_failed"
	OutcomeRead        Outcome = "read_failed"
	OutcomeWrite       Outcome = "write_failed"
	OutcomeCanceled    Outcome = "canceled"
	OutcomeDeadline    Outcome = "deadline_exceeded"
	OutcomePanic       Outcome = "panic"
	OutcomeInternal    Outcome = "internal_failure"
)

// Outcomes is a value copy of the bounded label vocabulary, not mutable globals.
func Outcomes() []Outcome {
	return []Outcome{OutcomeWritten, OutcomeRejected, OutcomeInvalid, OutcomeUnavailable,
		OutcomeCapacity, OutcomeUpgrade, OutcomeRead, OutcomeWrite, OutcomeCanceled,
		OutcomeDeadline, OutcomePanic, OutcomeInternal}
}

type Stage uint8

const (
	StageNone Stage = iota
	StageAuthorize
	StageUpgrade
	StageRead
	StageValidate
	StageRecheck
	StageEvaluate
	StageWrite
	StageClose
	StageCount
)

func (stage Stage) String() string {
	switch stage {
	case StageAuthorize:
		return "authorize"
	case StageUpgrade:
		return "upgrade"
	case StageRead:
		return "read"
	case StageValidate:
		return "validate"
	case StageRecheck:
		return "recheck"
	case StageEvaluate:
		return "evaluate"
	case StageWrite:
		return "write"
	case StageClose:
		return "close"
	default:
		return "none"
	}
}
