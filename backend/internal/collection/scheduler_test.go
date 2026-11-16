package collection

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

func schedulerFixture(t *testing.T) ScheduleOptions {
	t.Helper()
	root := t.TempDir()
	catalog := filepath.Join(root, "catalog.csv")
	writeScheduleCatalog(t, catalog, false)
	return ScheduleOptions{CatalogPath: catalog, SourceURL: "https://fixtures.test.invalid/idx", Directory: filepath.Join(root, "store"), Every: 24 * time.Hour, RetryDelay: time.Hour, RunTimeout: time.Minute, Keep: 3, RetirementGrace: 72 * time.Hour}
}
func writeScheduleCatalog(t *testing.T, path string, second bool) {
	t.Helper()
	raw := "Kode,Nama Perusahaan,Tanggal Pencatatan\nBBCA,Synthetic,31 Mei 2000\n"
	if second {
		raw += "TLKM,Synthetic second,31 Mei 2000\n"
	}
	if e := os.WriteFile(path, []byte(raw), 0600); e != nil {
		t.Fatal(e)
	}
}
func TestSchedulerRecomputesWindowCatalogAndSameDayIdempotency(t *testing.T) {
	o := schedulerFixture(t)
	jakarta, _ := time.LoadLocation("Asia/Jakarta")
	now := time.Date(2026, 1, 20, 17, 0, 0, 0, jakarta)
	p := &rangeHistory{price: 100}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	results := []ScheduledResult{}
	calls := []int{}
	waits := 0
	err := runScheduler(ctx, o, p, func(r ScheduledResult) {
		results = append(results, r)
		calls = append(calls, len(p.starts))
		if len(results) == 4 {
			cancel()
		}
	}, func() time.Time { return now }, func(_ context.Context, delay time.Duration) error {
		if delay != o.Every {
			t.Fatal("unexpected retry")
		}
		waits++
		switch waits {
		case 1:
			now = now.Add(30 * time.Minute)
		case 2:
			writeScheduleCatalog(t, o.CatalogPath, true)
		case 3:
			now = now.Add(30 * time.Minute)
		}
		return nil
	})
	if err != nil || len(results) != 4 {
		t.Fatalf("runs=%d err=%v", len(results), err)
	}
	for i, r := range results {
		if r.Err != nil {
			t.Fatal(r.Err)
		}
		if !r.From.Equal(r.To.AddDate(-5, 0, 0)) {
			t.Fatal("window frozen or not five years")
		}
		want := "2026-01-20"
		if i == 3 {
			want = "2026-01-21"
		}
		if r.To.Format("2006-01-02") != want {
			t.Fatal("wrong completed day")
		}
	}
	if calls[0] != 1 || calls[1] != 1 || calls[2] != 3 || calls[3] != 5 {
		t.Fatalf("provider calls=%v", calls)
	}
	if len(results[2].Report.Entries) != 2 {
		t.Fatal("catalog was not reread")
	}
}
func TestSchedulerFailurePreservesPublicationAndRetriesLater(t *testing.T) {
	o := schedulerFixture(t)
	now := time.Date(2026, 1, 20, 12, 0, 0, 0, time.UTC)
	p := &rangeHistory{price: 100}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var prior []byte
	runs := 0
	waits := []time.Duration{}
	e := runScheduler(ctx, o, p, func(r ScheduledResult) {
		runs++
		raw, err := os.ReadFile(filepath.Join(o.Directory, "current.json"))
		if err != nil {
			t.Fatal(err)
		}
		switch runs {
		case 1:
			if r.Err != nil {
				t.Fatal(r.Err)
			}
			prior = raw
		case 2:
			if r.Err == nil || string(raw) != string(prior) {
				t.Fatal("failed run changed publication")
			}
		case 3:
			if r.Err != nil || string(raw) == string(prior) {
				t.Fatal("retry failed to publish")
			}
			cancel()
		}
	}, func() time.Time { return now }, func(_ context.Context, d time.Duration) error {
		waits = append(waits, d)
		if len(waits) == 1 {
			now = now.AddDate(0, 0, 1)
			p.fail = true
		} else {
			p.fail = false
		}
		return nil
	})
	if e != nil || len(waits) != 2 || waits[0] != o.Every || waits[1] != o.RetryDelay {
		t.Fatalf("retry cadence=%v err=%v", waits, e)
	}
	assertScheduleLocksRemoved(t, o.Directory)
}

type blockedScheduleProvider struct{ active, max atomic.Int32 }

func (p *blockedScheduleProvider) DailyHistory(ctx context.Context, _ universe.Instrument, _, _ time.Time) (marketdata.History, error) {
	current := p.active.Add(1)
	defer p.active.Add(-1)
	if current > p.max.Load() {
		p.max.Store(current)
	}
	<-ctx.Done()
	return marketdata.History{}, ctx.Err()
}
func TestSchedulerTimeoutSerialRunsAndCancel(t *testing.T) {
	o := schedulerFixture(t)
	o.RunTimeout = 20 * time.Millisecond
	p := &blockedScheduleProvider{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runs, waits := 0, 0
	e := runScheduler(ctx, o, p, func(r ScheduledResult) {
		runs++
		if r.Err == nil {
			t.Fatal("timeout was hidden")
		}
		if runs == 2 {
			cancel()
		}
	}, time.Now, func(_ context.Context, d time.Duration) error {
		waits++
		if p.active.Load() != 0 || d != o.RetryDelay {
			t.Fatal("overlapping run or tight retry")
		}
		return nil
	})
	if e != nil || p.max.Load() != 1 || runs != 2 || waits != 1 {
		t.Fatalf("runs=%d waits=%d max=%d err=%v", runs, waits, p.max.Load(), e)
	}
	assertScheduleLocksRemoved(t, o.Directory)
	ctx, cancel = context.WithCancel(context.Background())
	cancel()
	if e = RunScheduler(ctx, o, p, nil); e != nil {
		t.Fatal(e)
	}
}
func TestSchedulerCancelWaitingDoesNotStartAnotherRun(t *testing.T) {
	o := schedulerFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runs := 0
	e := RunScheduler(ctx, o, &rangeHistory{price: 100}, func(r ScheduledResult) { runs++; cancel() })
	if e != nil || runs != 1 {
		t.Fatalf("cancel=%v runs=%d", e, runs)
	}
	ctx, cancel = context.WithCancel(context.Background())
	cancel()
	if !errors.Is(waitSchedule(ctx, time.Hour), context.Canceled) {
		t.Fatal("timer ignored cancellation")
	}
}
func TestSchedulerRejectsInvalidOptions(t *testing.T) {
	good := schedulerFixture(t)
	for _, change := range []func(*ScheduleOptions){func(o *ScheduleOptions) { o.Every = 0 }, func(o *ScheduleOptions) { o.RetryDelay = time.Second }, func(o *ScheduleOptions) { o.RunTimeout = 0 }, func(o *ScheduleOptions) { o.RunTimeout = 7 * time.Hour }, func(o *ScheduleOptions) { o.SourceURL = "http://invalid" }, func(o *ScheduleOptions) { o.Keep = 1 }, func(o *ScheduleOptions) { o.RetirementGrace = time.Hour }, func(o *ScheduleOptions) { o.CatalogPath = "" }} {
		o := good
		change(&o)
		if e := RunScheduler(context.Background(), o, &rangeHistory{}, nil); e == nil {
			t.Fatal("invalid scheduler accepted")
		}
	}
	if RunScheduler(context.Background(), good, nil, nil) == nil {
		t.Fatal("nil provider accepted")
	}
}
func assertScheduleLocksRemoved(t *testing.T, root string) {
	t.Helper()
	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err == nil && (info.Name() == ".sync.lock" || info.Name() == ".collect.lock") {
			t.Errorf("lock leaked: %s", path)
		}
		return err
	})
}

// Opt-in real timer smoke through the production entrypoint, with synthetic data only.
func TestSchedulerAutonomousTimerSmoke(t *testing.T) {
	if os.Getenv("SIGNALGEN_TEST_SCHEDULER_SMOKE") != "1" {
		t.Skip("opt-in one-minute offline timer smoke")
	}
	o := schedulerFixture(t)
	o.Every = time.Minute
	p := &rangeHistory{price: 100}
	ctx, cancel := context.WithTimeout(context.Background(), 85*time.Second)
	defer cancel()
	runs := 0
	start := time.Now()
	var firstEnd time.Time
	expectedFetches := 1
	err := RunScheduler(ctx, o, p, func(r ScheduledResult) {
		if r.Err != nil {
			t.Error(r.Err)
			cancel()
			return
		}
		runs++
		if runs == 1 {
			firstEnd = r.To
		}
		if runs == 2 {
			if !r.To.Equal(firstEnd) {
				expectedFetches = 2
			}
			cancel()
		}
	})
	if err != nil || runs != 2 || time.Since(start) < time.Minute || len(p.starts) != expectedFetches {
		t.Fatalf("automatic runs=%d fetches=%d err=%v", runs, len(p.starts), err)
	}
	assertScheduleLocksRemoved(t, o.Directory)
	t.Logf("PASS: production scheduler ran twice autonomously with real one-minute timer, %d synthetic provider fetches, no website/API/Yahoo", len(p.starts))
}
