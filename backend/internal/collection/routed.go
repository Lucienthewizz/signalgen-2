package collection

import (
	"context"
	"fmt"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

// RoutedStoreProvider keeps the archive scoped to IDX history while preserving
// the existing Yahoo behavior for US instruments and live/latest requests.
// Missing IDX entries are returned as unavailable by ArchiveProvider; they
// never fall through to a user-triggered Yahoo download.
type RoutedStoreProvider struct {
	store *StoreProvider
	live  marketdata.Provider
}

func NewRoutedStoreProvider(root string, live marketdata.Provider) (*RoutedStoreProvider, error) {
	if live == nil {
		return nil, fmt.Errorf("live market provider is required")
	}
	store, err := NewStoreProvider(root)
	if err != nil {
		return nil, err
	}
	return &RoutedStoreProvider{store: store, live: live}, nil
}

var _ marketdata.SnapshotProvider = (*RoutedStoreProvider)(nil)

func (p *RoutedStoreProvider) Snapshot(ctx context.Context) (string, marketdata.Provider, error) {
	revision, archive, err := p.store.Snapshot(ctx)
	if err != nil {
		return "", nil, err
	}
	return revision + "\x00yahoo-live", &routedView{archive: archive, live: p.live}, nil
}

func (p *RoutedStoreProvider) Daily(ctx context.Context, instruments []universe.Instrument, outputSize int) ([]marketdata.Series, error) {
	_, view, err := p.Snapshot(ctx)
	if err != nil {
		return nil, err
	}
	return view.Daily(ctx, instruments, outputSize)
}

func (p *RoutedStoreProvider) DailyHistory(ctx context.Context, instrument universe.Instrument, from, to time.Time) (marketdata.History, error) {
	_, view, err := p.Snapshot(ctx)
	if err != nil {
		return marketdata.History{}, err
	}
	return view.(interface {
		DailyHistory(context.Context, universe.Instrument, time.Time, time.Time) (marketdata.History, error)
	}).DailyHistory(ctx, instrument, from, to)
}

func (p *RoutedStoreProvider) Source() marketdata.Source {
	return marketdata.Source{Provider: "yahoo_finance", Warnings: []string{
		"IDX daily history uses the published local archive; US and live/latest requests use Yahoo Finance.",
		"Missing IDX archive entries remain unavailable and never fall back to per-user downloads.",
	}}
}

type routedView struct {
	archive marketdata.Provider
	live    marketdata.Provider
}

func (v *routedView) Daily(ctx context.Context, instruments []universe.Instrument, outputSize int) ([]marketdata.Series, error) {
	idx, us := make([]universe.Instrument, 0, len(instruments)), make([]universe.Instrument, 0, len(instruments))
	for _, instrument := range instruments {
		switch universe.SymbolMarket(instrument.Symbol) {
		case "IDX":
			idx = append(idx, instrument)
		case "US":
			us = append(us, instrument)
		default:
			return nil, marketdata.ErrInvalidData
		}
	}
	var result []marketdata.Series
	if len(idx) > 0 {
		series, err := v.archive.Daily(ctx, idx, outputSize)
		if err != nil {
			return nil, err
		}
		result = append(result, series...)
	}
	if len(us) > 0 {
		series, err := v.live.Daily(ctx, us, outputSize)
		if err != nil {
			return nil, err
		}
		result = append(result, series...)
	}
	ordered := make(map[string]marketdata.Series, len(result))
	for _, series := range result {
		ordered[series.Symbol] = series
	}
	result = make([]marketdata.Series, 0, len(instruments))
	for _, instrument := range instruments {
		series, ok := ordered[instrument.Symbol]
		if !ok {
			return nil, marketdata.ErrInvalidData
		}
		result = append(result, series)
	}
	return result, marketdata.ValidateSeries(result, instruments, outputSize)
}

func (v *routedView) DailyHistory(ctx context.Context, instrument universe.Instrument, from, to time.Time) (marketdata.History, error) {
	switch universe.SymbolMarket(instrument.Symbol) {
	case "IDX":
		provider, ok := v.archive.(interface {
			DailyHistory(context.Context, universe.Instrument, time.Time, time.Time) (marketdata.History, error)
		})
		if !ok {
			return marketdata.History{}, marketdata.ErrHistoryUnavailable
		}
		return provider.DailyHistory(ctx, instrument, from, to)
	case "US":
		provider, ok := v.live.(interface {
			DailyHistory(context.Context, universe.Instrument, time.Time, time.Time) (marketdata.History, error)
		})
		if !ok {
			return marketdata.History{}, marketdata.ErrHistoryUnavailable
		}
		return provider.DailyHistory(ctx, instrument, from, to)
	default:
		return marketdata.History{}, marketdata.ErrInvalidData
	}
}
