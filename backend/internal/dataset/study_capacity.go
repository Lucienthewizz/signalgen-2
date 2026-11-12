package dataset

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

// Reserved slots and staged bytes share the ordinary snapshot budget. Staged
// handles remain private until the whole batch can be published.
type studyReservation struct {
	store          *DynamicStore
	owner, studyID string
	slots, bytes   int
	entries        []dynamicEntry
	ctx            context.Context
	cancel         context.CancelFunc
	expiresAt      time.Time
}

func (store *DynamicStore) reservedLocked(owner string) (slots, ownerSlots, bytes int) {
	for r := range store.reservations {
		slots += r.slots
		bytes += r.bytes
		if r.owner == owner {
			ownerSlots += r.slots
		}
	}
	return
}

func (store *DynamicStore) reserveStudy(ctx context.Context, owner, studyID string, slots int) (*studyReservation, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	owner = strings.TrimSpace(owner)
	if owner == "" || studyID == "" || slots < 1 || slots > 10 {
		return nil, ErrInvalidRequest
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	store.pruneExpiredLocked()
	reserved, ownerReserved, bytes := store.reservedLocked(owner)
	count := 0
	for _, e := range store.entries {
		if e.owner == owner {
			count++
		}
	}
	if len(store.entries)+reserved+slots > store.limits.MaxEntries || count+ownerReserved+slots > store.limits.MaxPerOwner || store.bytes+bytes >= store.limits.MaxBytes {
		return nil, ErrCapacity
	}
	workCtx, cancel := context.WithTimeout(ctx, min(store.limits.TTL, 8*time.Second))
	r := &studyReservation{store: store, owner: owner, studyID: studyID, slots: slots, ctx: workCtx, cancel: cancel, expiresAt: store.now().Add(min(store.limits.TTL, 8*time.Second))}
	store.reservations[r] = struct{}{}
	return r, nil
}

func (r *studyReservation) validLocked(owner, studyID string) bool {
	_, ok := r.store.reservations[r]
	return ok && r.owner == owner && r.studyID == studyID && r.ctx.Err() == nil && r.store.now().Before(r.expiresAt)
}

func (r *studyReservation) closeLocked() {
	delete(r.store.reservations, r)
	r.entries = nil
	r.bytes = 0
	r.cancel()
}

func (r *studyReservation) stageLocked(e dynamicEntry) error {
	if !r.validLocked(e.owner, e.manifest.Backtest.StudyID) {
		return ErrCapacity
	}
	_, _, bytes := r.store.reservedLocked(r.owner)
	if len(r.entries) >= r.slots || r.store.bytes+bytes+len(e.content) > r.store.limits.MaxBytes {
		return ErrCapacity
	}
	r.entries = append(r.entries, e)
	r.bytes += len(e.content)
	return nil
}

func (r *studyReservation) commit() error {
	r.store.mu.Lock()
	defer r.store.mu.Unlock()
	r.store.pruneExpiredLocked()
	if err := r.ctx.Err(); err != nil {
		return err
	}
	if !r.validLocked(r.owner, r.studyID) {
		return ErrCapacity
	}
	for _, e := range r.entries {
		if !r.store.now().Before(e.expiresAt) {
			return ErrCapacity
		}
	}
	for _, e := range r.entries {
		r.store.entries[e.manifest.DatasetID] = e
		r.store.bytes += len(e.content)
	}
	r.closeLocked()
	return nil
}

// PrepareStudyBatch admits all requested slots before fetching. Provider failures
// may be partial; capacity failure or cancellation publishes none of this batch.
func (store *DynamicStore) PrepareStudyBatch(ctx context.Context, owner, studyID string, input PrepareRequest, instruments []universe.Instrument) ([]Manifest, []error, error) {
	r, err := store.reserveStudy(ctx, owner, studyID, len(instruments))
	if err != nil {
		return nil, nil, err
	}
	defer func() { store.mu.Lock(); r.closeLocked(); store.mu.Unlock() }()
	manifests := make([]Manifest, len(instruments))
	failures := make([]error, len(instruments))
	var workers sync.WaitGroup
	for offset := 0; offset < min(3, len(instruments)); offset++ {
		workers.Add(1)
		go func(offset int) {
			defer workers.Done()
			for i := offset; i < len(instruments); i += 3 {
				request := input
				request.StudyID = studyID
				request.UniverseID = studyID
				request.StudyInstruments = []universe.Instrument{instruments[i]}
				manifests[i], failures[i] = store.prepareBacktestReserved(r.ctx, r.owner, request, r)
			}
		}(offset)
	}
	workers.Wait()
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	for _, err := range failures {
		if errors.Is(err, ErrCapacity) {
			return nil, nil, ErrCapacity
		}
	}
	if err := r.commit(); err != nil {
		return nil, nil, err
	}
	return manifests, failures, nil
}
