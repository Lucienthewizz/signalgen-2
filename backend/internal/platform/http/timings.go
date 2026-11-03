package http

import (
	"context"
	"sync"
	"time"
)

type TimingStage uint8

const (
	AuthLocal TimingStage = iota
	AuthRemote
	AuthKeys
	DBAcquire
	DBConnect
	DBQuery
	DBBatch
	timingStages
)

var timingNames = [timingStages]string{"auth_local", "auth_remote", "auth_keys", "db_acquire", "db_connect", "db_query", "db_batch"}

type requestTimings struct {
	mu        sync.Mutex
	durations [timingStages]time.Duration
}

// Fixed numeric stages cannot leak SQL, claims, tokens or user-supplied labels.
// Nested operations overlap: these durations must not be added to HTTP time.
func RecordTiming(ctx context.Context, stage TimingStage, elapsed time.Duration) {
	trace, ok := ctx.Value(trafficKey{}).(*requestTraffic)
	if !ok || stage >= timingStages || elapsed < 0 {
		return
	}
	trace.timings.mu.Lock()
	trace.timings.durations[stage] += elapsed
	trace.timings.mu.Unlock()
}

func (timings *requestTimings) snapshot() map[string]int64 {
	timings.mu.Lock()
	defer timings.mu.Unlock()
	result := make(map[string]int64)
	for stage, elapsed := range timings.durations {
		if elapsed > 0 {
			result[timingNames[stage]] = elapsed.Microseconds()
		}
	}
	return result
}
