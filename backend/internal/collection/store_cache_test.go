package collection

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type publicationUniverse struct {
	universe.Repository
	items []universe.Instrument
}

func (u publicationUniverse) Instruments(_ context.Context, owner, id string) ([]universe.Instrument, error) {
	if owner != "owner-a" || id != "owned" {
		return nil, universe.ErrNotFound
	}
	return u.items, nil
}
func TestStorePublicationImmediatelyRefreshesLatestHistoryAndPreservesDataset(t *testing.T) {
	c, o, p := publicationFixture(t, 2)
	store, err := NewStoreProvider(o.Directory)
	if err != nil {
		t.Fatal(err)
	}
	cache, _ := marketdata.NewCachedProvider(store, marketdata.DefaultCacheOptions())
	item := universe.Instrument{Symbol: c.Items[0].ProviderSymbol, ProviderSymbol: c.Items[0].ProviderSymbol, Exchange: "XIDX", Currency: "IDR"}
	items := []universe.Instrument{item}
	ctx := context.Background()
	a, err := cache.Daily(ctx, items, 20)
	if err != nil {
		t.Fatal(err)
	}
	historyA, err := cache.DailyHistory(ctx, item, o.From, o.To)
	if err != nil {
		t.Fatal(err)
	}
	encodedA, _ := json.Marshal(a)
	hashA := sha256.Sum256(encodedA)
	snapshots, err := dataset.NewDynamicStore(cache, publicationUniverse{items: items})
	if err != nil {
		t.Fatal(err)
	}
	manifestA, err := snapshots.Prepare(ctx, "owner-a", dataset.PrepareRequest{Purpose: "screen", RuleID: "fixture", UniverseID: "owned"})
	if err != nil {
		t.Fatal(err)
	}
	contentA, _, err := snapshots.Content(ctx, "owner-a", manifestA.DatasetID)
	if err != nil {
		t.Fatal(err)
	}
	revisionA, viewA, err := store.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, sameView, err := store.Snapshot(ctx)
	if err != nil || viewA != sameView {
		t.Fatal("metadata view not reused", err)
	}
	// A failed collection retains A. No partially written generation is selected.
	oldTo := o.To
	o.To = o.To.AddDate(0, 0, 1)
	p.fail = true
	if _, err := Sync(ctx, c, p, o, 7, nil); err == nil {
		t.Fatal("failed collection published")
	}
	unchanged, err := cache.Daily(ctx, items, 20)
	if err != nil || unchanged[0].Candles[19].Close != 101 {
		t.Fatal("failed publication changed A", err)
	}
	p.fail = false
	p.price = 200
	if _, err := Sync(ctx, c, p, o, 7, nil); err != nil {
		t.Fatal(err)
	}
	b, err := cache.Daily(ctx, items, 20)
	if err != nil || b[0].Candles[19].Close != 201 {
		t.Fatal("new latest hidden behind TTL", err)
	}
	historyB, err := cache.DailyHistory(ctx, item, o.From, oldTo)
	if err != nil || historyB.Series.Candles[len(historyB.Series.Candles)-1].Close != 201 {
		t.Fatal("new history hidden behind TTL", err)
	}
	revisionB, _, err := store.Snapshot(ctx)
	if err != nil || revisionA == revisionB {
		t.Fatal("revision unchanged", err)
	}
	if !strings.Contains(strings.Join(a[0].QualityWarnings, " "), revisionA) || !strings.Contains(strings.Join(b[0].QualityWarnings, " "), revisionB) {
		t.Fatal("generation provenance missing")
	}
	encodedAfter, _ := json.Marshal(a)
	if hashA != sha256.Sum256(encodedAfter) || historyA.Series.Candles[len(historyA.Series.Candles)-1].Close != 101 {
		t.Fatal("frozen result mutated")
	}
	oldAgain, err := viewA.Daily(ctx, items, 20)
	if err != nil || oldAgain[0].Candles[19].Close != 101 {
		t.Fatal("pinned A reread current pointer", err)
	}
	contentAgain, manifestAgain, err := snapshots.Content(ctx, "owner-a", manifestA.DatasetID)
	if err != nil || string(contentAgain) != string(contentA) || manifestAgain.Checksum != manifestA.Checksum {
		t.Fatal("frozen owner dataset/checksum mutated", err)
	}
	if _, _, err := snapshots.Content(ctx, "owner-b", manifestA.DatasetID); !errors.Is(err, dataset.ErrNotFound) {
		t.Fatal("owner isolation changed", err)
	}
	b[0].Candles[0].Close = 1
	b[0].QualityWarnings[0] = "changed"
	historyB.Series.Candles[0].Close = 1
	again, err := cache.Daily(ctx, items, 20)
	if err != nil || again[0].Candles[0].Close == 1 || again[0].QualityWarnings[0] == "changed" {
		t.Fatal("cached slices aliased", err)
	}
	if strings.Contains(strings.Join(store.Source().Warnings, " "), "subject to the shared cache TTL") || !strings.Contains(strings.Join(store.Source().Warnings, " "), "Published IDX archive") {
		t.Fatal("stale provenance claim")
	}
}
func TestStoreInvalidPublicationNeverServesWarmCache(t *testing.T) {
	c, o, _ := publicationFixture(t, 1)
	store, _ := NewStoreProvider(o.Directory)
	cache, _ := marketdata.NewCachedProvider(store, marketdata.DefaultCacheOptions())
	item := universe.Instrument{Symbol: c.Items[0].ProviderSymbol, ProviderSymbol: c.Items[0].ProviderSymbol}
	if _, err := cache.Daily(context.Background(), []universe.Instrument{item}, 20); err != nil {
		t.Fatal(err)
	}
	pointer := filepath.Join(o.Directory, "current.json")
	original, _ := os.ReadFile(pointer)
	invalid := []string{`{`, string(original) + `{}`, `{"schema":"idx-store-1","generation":"generation-../../outside"}`, `{"schema":"idx-store-1","generation":"generation-missing"}`, strings.Repeat(" ", publicationPointerLimit+1) + string(original)}
	for _, raw := range invalid {
		if err := os.WriteFile(pointer, []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := cache.Daily(context.Background(), []universe.Instrument{item}, 20); !errors.Is(err, marketdata.ErrUnavailable) {
			t.Fatal("corrupt publication became stale success", err)
		}
		if _, err := cache.DailyHistory(context.Background(), item, o.From, o.To); !errors.Is(err, marketdata.ErrUnavailable) {
			t.Fatal("corrupt history publication became stale success", err)
		}
	}
	os.Remove(pointer)
	if err := os.Symlink("report.json", pointer); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.Snapshot(context.Background()); !errors.Is(err, marketdata.ErrUnavailable) {
		t.Fatal("linked pointer accepted", err)
	}
	os.Remove(pointer)
	os.WriteFile(pointer, original, 0600)
	if _, err := cache.Daily(context.Background(), []universe.Instrument{item}, 20); err != nil {
		t.Fatal("valid pointer restoration failed", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := store.Snapshot(ctx); !errors.Is(err, context.Canceled) {
		t.Fatal("cancel lost", err)
	}
}

type gatedPublication struct {
	store      *StoreProvider
	generation string
	gate       *publicationGate
}
type publicationGate struct {
	entered, release chan struct{}
	once             sync.Once
}
type gatedPublicationView struct {
	marketdata.Provider
	gate *publicationGate
}

func (p *gatedPublication) Snapshot(ctx context.Context) (string, marketdata.Provider, error) {
	revision, view, err := p.store.Snapshot(ctx)
	if err == nil && revision == p.generation {
		return revision, &gatedPublicationView{Provider: view, gate: p.gate}, nil
	}
	return revision, view, err
}
func (p *gatedPublication) Daily(ctx context.Context, items []universe.Instrument, size int) ([]marketdata.Series, error) {
	return p.store.Daily(ctx, items, size)
}
func (p *gatedPublication) DailyHistory(ctx context.Context, item universe.Instrument, from, to time.Time) (marketdata.History, error) {
	return p.store.DailyHistory(ctx, item, from, to)
}
func (p *gatedPublicationView) wait(ctx context.Context) error {
	p.gate.once.Do(func() { close(p.gate.entered) })
	select {
	case <-p.gate.release:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (p *gatedPublicationView) Daily(ctx context.Context, items []universe.Instrument, size int) ([]marketdata.Series, error) {
	if err := p.wait(ctx); err != nil {
		return nil, err
	}
	return p.Provider.Daily(ctx, items, size)
}
func (p *gatedPublicationView) DailyHistory(ctx context.Context, item universe.Instrument, from, to time.Time) (marketdata.History, error) {
	if err := p.wait(ctx); err != nil {
		return marketdata.History{}, err
	}
	return p.Provider.(marketdata.HistoryProvider).DailyHistory(ctx, item, from, to)
}
func TestRealPublicationDuringInflightReadKeepsPinnedGeneration(t *testing.T) {
	for _, history := range []bool{false, true} {
		t.Run(map[bool]string{false: "latest", true: "history"}[history], func(t *testing.T) {
			c, o, p := publicationFixture(t, 2)
			store, _ := NewStoreProvider(o.Directory)
			revision, _, _ := store.Snapshot(context.Background())
			gate := &publicationGate{entered: make(chan struct{}), release: make(chan struct{})}
			defer func() {
				select {
				case <-gate.release:
				default:
					close(gate.release)
				}
			}()
			cache, _ := marketdata.NewCachedProvider(&gatedPublication{store: store, generation: revision, gate: gate}, marketdata.DefaultCacheOptions())
			item := universe.Instrument{Symbol: c.Items[0].ProviderSymbol, ProviderSymbol: c.Items[0].ProviderSymbol}
			from, to := o.From, o.To
			read := func() (float64, error) {
				if history {
					h, err := cache.DailyHistory(context.Background(), item, from, to)
					if err != nil {
						return 0, err
					}
					return h.Series.Candles[len(h.Series.Candles)-1].Close, nil
				}
				s, err := cache.Daily(context.Background(), []universe.Instrument{item}, 20)
				if err != nil {
					return 0, err
				}
				return s[0].Candles[len(s[0].Candles)-1].Close, nil
			}
			old := make(chan float64, 1)
			failure := make(chan error, 1)
			go func() { value, err := read(); old <- value; failure <- err }()
			<-gate.entered
			o.To = o.To.AddDate(0, 0, 1)
			p.price = 200
			if _, err := Sync(context.Background(), c, p, o, 7, nil); err != nil {
				t.Fatal(err)
			}
			value, err := read()
			if err != nil || value != 201 {
				t.Fatal("new request saw old generation", value, err)
			}
			close(gate.release)
			if value := <-old; value != 101 {
				t.Fatal("in-flight generation changed", value)
			}
			if err := <-failure; err != nil {
				t.Fatal(err)
			}
		})
	}
}
