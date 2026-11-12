package collection

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type rangeHistory struct {
	starts []time.Time
	price  float64
	fail   bool
}

func (p *rangeHistory) DailyHistory(_ context.Context, item universe.Instrument, from, to time.Time) (marketdata.History, error) {
	p.starts = append(p.starts, from)
	if p.fail {
		return marketdata.History{}, marketdata.ErrUnavailable
	}
	s := marketdata.Series{Symbol: item.Symbol, Timezone: "UTC"}
	for d := from; d.Before(to); d = d.AddDate(0, 0, 1) {
		s.Candles = append(s.Candles, core.Candle{Timestamp: d.Format(time.RFC3339), Open: p.price, High: p.price + 2, Low: p.price - 1, Close: p.price + 1, Volume: 1000})
	}
	return marketdata.History{Series: s}, nil
}
func syncFixture(t *testing.T) (Catalog, Options, *rangeHistory) {
	t.Helper()
	to := time.Date(2026, 1, 20, 0, 0, 0, 0, time.UTC)
	return Catalog{SourceURL: "https://www.idx.co.id/", RetrievedAt: to.Format(time.RFC3339), SourceSHA256: strings.Repeat("a", 64), Items: []Instrument{{Code: "BBCA", ProviderSymbol: "BBCA.JK"}, {Code: "TLKM", ProviderSymbol: "TLKM.JK"}}}, Options{Directory: t.TempDir(), From: to.AddDate(-5, 0, 0), To: to}, &rangeHistory{price: 100}
}
func TestSyncBackfillIncrementalCorrectionAndIdempotency(t *testing.T) {
	c, o, p := syncFixture(t)
	ctx := context.Background()
	if _, err := Sync(ctx, c, p, o, 7, nil); err != nil {
		t.Fatal(err)
	}
	store, err := NewStoreProvider(o.Directory)
	if err != nil {
		t.Fatal(err)
	}
	initial := len(p.starts)
	oldTo := o.To
	o.To = o.To.AddDate(0, 0, 1)
	o.From = o.To.AddDate(-5, 0, 0)
	p.price = 200
	if _, err = Sync(ctx, c, p, o, 7, nil); err != nil {
		t.Fatal(err)
	}
	if len(p.starts) != initial+2 || !p.starts[initial].Equal(oldTo.AddDate(0, 0, -7)) {
		t.Fatalf("refetched history: %+v", p.starts)
	}
	item := universe.Instrument{Symbol: "BBCA.JK", ProviderSymbol: "BBCA.JK"}
	h, err := store.DailyHistory(ctx, item, o.From, o.To.AddDate(0, 0, 3))
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, bar := range h.Series.Candles {
		if seen[bar.Timestamp] {
			t.Fatal("duplicate corrected candle")
		}
		seen[bar.Timestamp] = true
		ts, _ := time.Parse(time.RFC3339, bar.Timestamp)
		want := 101.0
		if !ts.Before(oldTo.AddDate(0, 0, -7)) {
			want = 201
		}
		if bar.Close != want {
			t.Fatalf("incorrect merge: %s %v", bar.Timestamp, bar.Close)
		}
	}
	if len(h.Series.Candles) < 1800 {
		t.Fatal("backfill lost")
	}
	if _, err = Sync(ctx, c, p, o, 7, nil); err != nil || len(p.starts) != initial+2 {
		t.Fatalf("repeated published run fetched again: %v", err)
	}
}
func TestSyncFailureRetainsPublicationAndResumes(t *testing.T) {
	c, o, p := syncFixture(t)
	ctx := context.Background()
	if _, err := Sync(ctx, c, p, o, 7, nil); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(filepath.Join(o.Directory, "current.json"))
	o.To = o.To.AddDate(0, 0, 1)
	o.From = o.To.AddDate(-5, 0, 0)
	p.fail = true
	r, err := Sync(ctx, c, p, o, 7, nil)
	if err == nil || r.Entries[0].Status != "failed" {
		t.Fatalf("failure hidden: %+v %v", r, err)
	}
	after, _ := os.ReadFile(filepath.Join(o.Directory, "current.json"))
	if string(before) != string(after) {
		t.Fatal("partial publication exposed")
	}
	p.fail = false
	if _, err = Sync(ctx, c, p, o, 7, nil); err != nil {
		t.Fatal(err)
	}
	after, _ = os.ReadFile(filepath.Join(o.Directory, "current.json"))
	if string(before) == string(after) {
		t.Fatal("retry did not publish")
	}
}
func TestSyncLocksCancellationAndCorruption(t *testing.T) {
	c, o, p := syncFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Sync(ctx, c, p, o, 7, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel not preserved: %v", err)
	}
	if _, err := os.Stat(filepath.Join(o.Directory, "current.json")); !os.IsNotExist(err) {
		t.Fatal("canceled publication")
	}
	if _, err := Sync(context.Background(), c, p, o, 7, nil); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(o.Directory, ".sync.lock"), nil, 0600)
	if _, err := Sync(context.Background(), c, p, o, 7, nil); err == nil {
		t.Fatal("overlapping collector accepted")
	}
	os.Remove(filepath.Join(o.Directory, ".sync.lock"))
	a, _ := publishedArchive(o.Directory)
	os.WriteFile(filepath.Join(a.directory, "BBCA.json"), []byte(`{}`), 0600)
	o.To = o.To.AddDate(0, 0, 1)
	if _, err := Sync(context.Background(), c, p, o, 7, nil); err == nil {
		t.Fatal("corrupt baseline accepted")
	}
}
func TestPublicationRejectsTraversal(t *testing.T) {
	dir := t.TempDir()
	writeJSON(filepath.Join(dir, "current.json"), Publication{Schema: "idx-store-1", Generation: "generation-../../other"})
	if _, err := NewStoreProvider(dir); err == nil {
		t.Fatal("unsafe publication accepted")
	}
}
