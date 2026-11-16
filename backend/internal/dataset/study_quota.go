package dataset

import "strings"

// MaxStudyDatasetUses bounds compute-grant and decision calls for one prepared
// study symbol. Study calls use this fixed quota instead of the per-minute
// mutation limiter: study admission and batch capacity already bound how many
// symbols can be prepared, so a whole-catalog study is not throttled to
// 60 symbols per minute.
const MaxStudyDatasetUses = 3

const (
	StudyUseGrant   = "grant"
	StudyUseSignals = "signals"
)

// ConsumeStudyUse reports whether id is a live study snapshot owned by owner
// and, if so, whether one more use of kind is allowed. Any other dataset
// returns isStudy=false so the caller applies its normal rate limit.
func (store *DynamicStore) ConsumeStudyUse(owner, id, kind string) (isStudy, allowed bool) {
	if kind != StudyUseGrant && kind != StudyUseSignals {
		return false, false
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	store.pruneExpiredLocked()
	id = strings.TrimSpace(id)
	entry, ok := store.entries[id]
	if !ok || entry.owner != strings.TrimSpace(owner) || entry.manifest.Backtest == nil || entry.manifest.Backtest.StudyID == "" {
		return false, false
	}
	used := &entry.grantUses
	if kind == StudyUseSignals {
		used = &entry.signalUses
	}
	if *used >= MaxStudyDatasetUses {
		return true, false
	}
	*used++
	store.entries[id] = entry
	return true, true
}
