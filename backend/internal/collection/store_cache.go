package collection

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

const publicationPointerLimit = 4096

// StoreProvider retains only the latest validated metadata view. In-flight
// requests own their pinned older view; retention's existing grace still applies.
type StoreProvider struct {
	root string
	mu   sync.Mutex
	view *storeView
}

type storeView struct {
	*ArchiveProvider
	generation string
}

var _ marketdata.SnapshotProvider = (*StoreProvider)(nil)

func NewStoreProvider(root string) (*StoreProvider, error) {
	p := &StoreProvider{root: root}
	if _, err := p.resolve(context.Background()); err != nil {
		return nil, err
	}
	return p, nil
}

// Read one bounded regular pointer file, preserving strict JSON validation.
func readPublication(root string) (Publication, error) {
	var p Publication
	path := filepath.Join(root, "current.json")
	info, err := os.Lstat(path)
	if err != nil {
		return p, err
	}
	if !info.Mode().IsRegular() {
		return p, fmt.Errorf("publication must be a regular file")
	}
	file, err := os.Open(path)
	if err != nil {
		return p, err
	}
	defer file.Close()
	info, err = file.Stat()
	if err != nil {
		return p, err
	}
	if !info.Mode().IsRegular() || info.Size() > publicationPointerLimit {
		return p, fmt.Errorf("publication exceeds pointer bound")
	}
	raw, err := io.ReadAll(io.LimitReader(file, publicationPointerLimit+1))
	if err != nil {
		return p, err
	}
	if len(raw) > publicationPointerLimit {
		return p, fmt.Errorf("publication exceeds pointer bound")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&p); err != nil {
		return p, err
	}
	if decoder.Decode(new(any)) != io.EOF {
		return p, fmt.Errorf("trailing publication data")
	}
	if p.Schema != "idx-store-1" || !strings.HasPrefix(p.Generation, "generation-") || filepath.Base(p.Generation) != p.Generation || len(p.Generation) > 128 {
		return p, fmt.Errorf("invalid IDX publication")
	}
	return p, nil
}

func (p *StoreProvider) resolve(ctx context.Context) (*storeView, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	publication, err := readPublication(p.root)
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if p.view != nil && p.view.generation == publication.Generation {
		return p.view, nil
	}
	archive, err := NewArchiveProvider(filepath.Join(p.root, publication.Generation))
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	p.view = &storeView{ArchiveProvider: archive, generation: publication.Generation}
	return p.view, nil
}

func (p *StoreProvider) Snapshot(ctx context.Context) (string, marketdata.Provider, error) {
	view, err := p.resolve(ctx)
	if err != nil {
		if ctx.Err() != nil {
			return "", nil, ctx.Err()
		}
		return "", nil, marketdata.ErrUnavailable
	}
	return view.generation, view, nil
}
func (p *StoreProvider) Daily(ctx context.Context, items []universe.Instrument, size int) ([]marketdata.Series, error) {
	_, view, err := p.Snapshot(ctx)
	if err != nil {
		return nil, err
	}
	return view.Daily(ctx, items, size)
}
func (p *StoreProvider) DailyHistory(ctx context.Context, item universe.Instrument, from, to time.Time) (marketdata.History, error) {
	_, view, err := p.Snapshot(ctx)
	if err != nil {
		return marketdata.History{}, err
	}
	return view.(marketdata.HistoryProvider).DailyHistory(ctx, item, from, to)
}
func (p *StoreProvider) Source() marketdata.Source {
	return marketdata.Source{Provider: "yahoo_finance", Warnings: []string{"Published IDX archive; daily data, not real-time. Publication is pinned per shared-cache request; existing dataset snapshots retain their original data."}}
}
func (p *storeView) warnings() []string {
	return append([]string{"Published IDX archive " + p.generation}, p.ArchiveProvider.warnings...)
}
func (p *storeView) Daily(ctx context.Context, items []universe.Instrument, size int) ([]marketdata.Series, error) {
	series, err := p.ArchiveProvider.Daily(ctx, items, size)
	if err == nil {
		for i := range series {
			series[i].QualityWarnings = append(series[i].QualityWarnings, p.warnings()...)
		}
	}
	return series, err
}
func (p *storeView) DailyHistory(ctx context.Context, item universe.Instrument, from, to time.Time) (marketdata.History, error) {
	history, err := p.ArchiveProvider.DailyHistory(ctx, item, from, to)
	if err == nil {
		history.Series.QualityWarnings = append(history.Series.QualityWarnings, p.warnings()...)
	}
	return history, err
}
