package dataset

import (
	"context"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

// Only the authorized study service supplies instruments; HTTP JSON cannot set them.
func (store *DynamicStore) PrepareStudy(ctx context.Context, owner, studyID string, input PrepareRequest, instruments []universe.Instrument) (Manifest, error) {
	if studyID == "" || len(instruments) < 1 || len(instruments) > 10 {
		return Manifest{}, ErrInvalidRequest
	}
	input.StudyID = studyID
	input.StudyInstruments = append([]universe.Instrument(nil), instruments...)
	input.UniverseID = studyID
	return store.prepareBacktest(ctx, owner, input)
}

// Release only handles belonging to this owner and study, never a shared price cache.
func (store *DynamicStore) ReleaseStudy(owner, studyID string) {
	store.mu.Lock()
	defer store.mu.Unlock()
	for id, e := range store.entries {
		if e.owner == owner && e.manifest.Backtest != nil && e.manifest.Backtest.StudyID == studyID {
			store.bytes -= len(e.content)
			delete(store.entries, id)
		}
	}
}
