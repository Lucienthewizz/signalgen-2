package dataset

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

func capacityStocks(n int) []universe.Instrument {
	out := make([]universe.Instrument, n)
	for i := range out {
		out[i] = universe.Instrument{Symbol: string(rune('A' + i)), ProviderSymbol: string(rune('A' + i)), Exchange: "XNAS", Currency: "USD"}
	}
	return out
}
func assertCapacityEmpty(t *testing.T, s *DynamicStore) {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.entries) != 0 || len(s.reservations) != 0 || s.bytes != 0 {
		t.Fatalf("leaked entries=%d reservations=%d bytes=%d", len(s.entries), len(s.reservations), s.bytes)
	}
}
func TestStudyBatchSharesCountBudgetWithoutEvictingOrdinaryHandles(t *testing.T) {
	p := &backtestProvider{}
	s, _ := NewDynamicStoreWithLimits(p, fakeUniverseRepository{owner: "user-a"}, SnapshotLimits{TTL: time.Minute, MaxEntries: 3, MaxPerOwner: 2, MaxBytes: 1 << 20})
	input := backtestPrepare()
	ordinary, err := s.Prepare(context.Background(), "user-a", input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.reserveStudy(context.Background(), "user-a", "s-a", 2); !errors.Is(err, ErrCapacity) {
		t.Fatal("owner budget", err)
	}
	reservation, err := s.reserveStudy(context.Background(), "user-b", "s-b", 2)
	if err != nil {
		t.Fatal(err)
	}
	input.NSteps++
	before := p.calls.Load()
	if _, err := s.Prepare(context.Background(), "user-a", input); !errors.Is(err, ErrCapacity) || p.calls.Load() != before {
		t.Fatal("ordinary stole reserved slot", err)
	}
	if _, err := s.reserveStudy(context.Background(), "user-c", "s-c", 1); !errors.Is(err, ErrCapacity) {
		t.Fatal("global budget", err)
	}
	s.ReleaseStudy("user-a", "s-b")
	s.mu.Lock()
	valid := reservation.validLocked("user-b", "s-b")
	s.mu.Unlock()
	if !valid {
		t.Fatal("foreign release canceled reservation")
	}
	s.ReleaseStudy("user-b", "s-b")
	if _, err := s.Manifest(context.Background(), "user-a", ordinary.DatasetID); err != nil {
		t.Fatal("active ordinary handle evicted", err)
	}
	if _, err := s.Prepare(context.Background(), "user-a", input); err != nil {
		t.Fatal("retry after release", err)
	}
}
func TestStudyBatchByteFailureRollsBackEveryHandle(t *testing.T) {
	p := &backtestProvider{}
	s, _ := NewDynamicStore(p, fakeUniverseRepository{owner: "user-a"})
	input := backtestPrepare()
	first, errs, err := s.PrepareStudyBatch(context.Background(), "user-a", "s", input, capacityStocks(1))
	if err != nil || errs[0] != nil {
		t.Fatal(err, errs)
	}
	size := first[0].DecodedBytes
	s.ReleaseStudy("user-a", "s")
	// Each symbol fits individually; their combined bytes do not.
	s.limits.MaxBytes = size + 100
	if _, _, err := s.PrepareStudyBatch(context.Background(), "user-a", "s", input, capacityStocks(2)); !errors.Is(err, ErrCapacity) {
		t.Fatal(err)
	}
	assertCapacityEmpty(t, s)
	if _, _, err := s.PrepareStudyBatch(context.Background(), "user-a", "s", input, capacityStocks(1)); err != nil {
		t.Fatal("retry", err)
	}
	s.ReleaseStudy("user-a", "s")
	assertCapacityEmpty(t, s)
}
func TestStudyStagedBytesBlockOrdinaryPublication(t *testing.T) {
	s, _ := NewDynamicStoreWithLimits(&backtestProvider{}, fakeUniverseRepository{owner: "user-a"}, SnapshotLimits{TTL: time.Minute, MaxEntries: 4, MaxPerOwner: 4, MaxBytes: 100})
	r, err := s.reserveStudy(context.Background(), "user-b", "s", 1)
	if err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	err = r.stageLocked(dynamicEntry{owner: "user-b", manifest: Manifest{DatasetID: "staged", Backtest: &BacktestScope{StudyID: "s"}}, content: make([]byte, 100), expiresAt: time.Now().Add(time.Minute)})
	available := s.hasCapacityLocked("user-a", 1)
	s.mu.Unlock()
	if err != nil || available {
		t.Fatal("staged bytes not counted", err)
	}
	if _, err := s.Manifest(context.Background(), "user-b", "staged"); !errors.Is(err, ErrNotFound) {
		t.Fatal("staged handle visible")
	}
	s.ReleaseStudy("user-b", "s")
	assertCapacityEmpty(t, s)
}
func TestStudyReservationExpiryAndCancellationReleaseBudget(t *testing.T) {
	for _, action := range []string{"expiry", "cancel", "release"} {
		t.Run(action, func(t *testing.T) {
			s, _ := NewDynamicStoreWithLimits(&backtestProvider{}, fakeUniverseRepository{owner: "user-a"}, SnapshotLimits{TTL: time.Minute, MaxEntries: 1, MaxPerOwner: 1, MaxBytes: 1 << 20})
			now := time.Now()
			s.now = func() time.Time { return now }
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			r, err := s.reserveStudy(ctx, "user-a", "s", 1)
			if err != nil {
				t.Fatal(err)
			}
			switch action {
			case "expiry":
				now = now.Add(9 * time.Second)
			case "cancel":
				cancel()
			case "release":
				s.ReleaseStudy("user-a", "s")
			}
			if err := r.commit(); err == nil {
				t.Fatal("dead reservation committed")
			}
			assertCapacityEmpty(t, s)
			if _, _, err := s.PrepareStudyBatch(context.Background(), "user-a", "retry", backtestPrepare(), capacityStocks(1)); err != nil {
				t.Fatal("retry", err)
			}
			s.ReleaseStudy("user-a", "retry")
			assertCapacityEmpty(t, s)
		})
	}
}

type capacityProvider struct {
	backtestProvider
	entered, proceed chan struct{}
	once             sync.Once
	missing          string
}

func (p *capacityProvider) DailyHistory(ctx context.Context, in universe.Instrument, from, to time.Time) (marketdata.History, error) {
	if p.entered != nil {
		p.once.Do(func() { close(p.entered) })
		select {
		case <-p.proceed:
		case <-ctx.Done():
			return marketdata.History{}, ctx.Err()
		}
	}
	if in.Symbol == p.missing {
		return marketdata.History{}, marketdata.ErrInsufficientCandles
	}
	return p.backtestProvider.DailyHistory(ctx, in, from, to)
}
func TestStudyConcurrentWholeBatchAdmissionAndReleaseDuringFetch(t *testing.T) {
	for _, stop := range []bool{false, true} {
		t.Run(map[bool]string{false: "complete", true: "release"}[stop], func(t *testing.T) {
			p := &capacityProvider{entered: make(chan struct{}), proceed: make(chan struct{})}
			s, _ := NewDynamicStoreWithLimits(p, fakeUniverseRepository{owner: "user-a"}, SnapshotLimits{TTL: time.Minute, MaxEntries: 2, MaxPerOwner: 2, MaxBytes: 1 << 20})
			done := make(chan error, 1)
			go func() {
				_, _, err := s.PrepareStudyBatch(context.Background(), "user-a", "s", backtestPrepare(), capacityStocks(2))
				done <- err
			}()
			<-p.entered
			if _, _, err := s.PrepareStudyBatch(context.Background(), "user-b", "other", backtestPrepare(), capacityStocks(1)); !errors.Is(err, ErrCapacity) {
				t.Fatal("concurrent owner stole slots", err)
			}
			if stop {
				s.ReleaseStudy("user-a", "s")
			}
			close(p.proceed)
			err := <-done
			if stop {
				if err == nil {
					t.Fatal("released batch published")
				}
				assertCapacityEmpty(t, s)
			} else {
				if err != nil || len(s.entries) != 2 || len(s.reservations) != 0 {
					t.Fatal("whole batch failed", err)
				}
				s.ReleaseStudy("user-a", "s")
				assertCapacityEmpty(t, s)
			}
		})
	}
}
func TestStudyBatchKeepsGenuineProviderPartialFailures(t *testing.T) {
	p := &capacityProvider{missing: "B"}
	s, _ := NewDynamicStore(p, fakeUniverseRepository{owner: "user-a"})
	manifests, failures, err := s.PrepareStudyBatch(context.Background(), "user-a", "s", backtestPrepare(), capacityStocks(3))
	if err != nil || failures[0] != nil || !errors.Is(failures[1], marketdata.ErrInsufficientCandles) || failures[2] != nil || manifests[0].DatasetID == "" || manifests[2].DatasetID == "" || len(s.entries) != 2 || len(s.reservations) != 0 {
		t.Fatal("provider partial lost", err, failures)
	}
	s.ReleaseStudy("user-a", "s")
	assertCapacityEmpty(t, s)
}

func TestStudyBatchRefusalPreservesActiveStudyHandles(t *testing.T) {
	s, _ := NewDynamicStoreWithLimits(&backtestProvider{}, fakeUniverseRepository{owner: "user-a"}, SnapshotLimits{TTL: time.Minute, MaxEntries: 3, MaxPerOwner: 3, MaxBytes: 1 << 20})
	manifests, _, err := s.PrepareStudyBatch(context.Background(), "user-a", "s", backtestPrepare(), capacityStocks(2))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.PrepareStudyBatch(context.Background(), "user-a", "s", backtestPrepare(), capacityStocks(2)); !errors.Is(err, ErrCapacity) {
		t.Fatal("expected whole refusal", err)
	}
	for _, m := range manifests {
		if _, err := s.Manifest(context.Background(), "user-a", m.DatasetID); err != nil {
			t.Fatal("existing active study handle evicted", err)
		}
	}
	if len(s.reservations) != 0 || len(s.entries) != 2 {
		t.Fatal("refusal leaked budget")
	}
	s.ReleaseStudy("user-a", "s")
	assertCapacityEmpty(t, s)
}
func TestStudyBatchRequestCancelAndTimeoutDuringFetch(t *testing.T) {
	for _, deadline := range []bool{false, true} {
		t.Run(map[bool]string{false: "cancel", true: "timeout"}[deadline], func(t *testing.T) {
			p := &capacityProvider{entered: make(chan struct{}), proceed: make(chan struct{})}
			s, _ := NewDynamicStore(p, fakeUniverseRepository{owner: "user-a"})
			ctx, cancel := context.WithCancel(context.Background())
			if deadline {
				cancel()
				ctx, cancel = context.WithTimeout(context.Background(), 100*time.Millisecond)
			}
			defer cancel()
			done := make(chan error, 1)
			go func() {
				_, _, err := s.PrepareStudyBatch(ctx, "user-a", "s", backtestPrepare(), capacityStocks(2))
				done <- err
			}()
			<-p.entered
			if !deadline {
				cancel()
			}
			err := <-done
			expected := context.Canceled
			if deadline {
				expected = context.DeadlineExceeded
			}
			if !errors.Is(err, expected) {
				t.Fatal("wrong stop error", err)
			}
			assertCapacityEmpty(t, s)
			close(p.proceed)
			if _, _, err := s.PrepareStudyBatch(context.Background(), "user-a", "retry", backtestPrepare(), capacityStocks(2)); err != nil {
				t.Fatal("retry after stop", err)
			}
			s.ReleaseStudy("user-a", "retry")
			assertCapacityEmpty(t, s)
		})
	}
}
