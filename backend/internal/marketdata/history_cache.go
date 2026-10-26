package marketdata

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

var ErrHistoryUnavailable = errors.New("configured provider does not support historical ranges")

type HistoryProvider interface {
	DailyHistory(context.Context, universe.Instrument, time.Time, time.Time) (History, error)
}

// Range queries share the same bounded cache/flight budget as screening. The
// full window is part of the key; latest-100 screening entries cannot satisfy it.
func (provider *CachedProvider) DailyHistory(ctx context.Context, instrument universe.Instrument, from, to time.Time) (History, error) {
	upstream, ok := provider.upstream.(HistoryProvider)
	if !ok {
		return History{}, ErrHistoryUnavailable
	}
	if instrument.Symbol == "" || instrument.ProviderSymbol == "" || !from.Before(to) || to.Sub(from) > 6*366*24*time.Hour {
		return History{}, ErrInvalidData
	}
	if err := ctx.Err(); err != nil {
		return History{}, err
	}
	key := fmt.Sprintf("history\x00%s\x00%s\x00%s\x00%s\x00%s\x00%s", instrument.Symbol, instrument.ProviderSymbol, instrument.Exchange, instrument.Currency, from.UTC().Format(time.RFC3339), to.UTC().Format(time.RFC3339))
	provider.mu.Lock()
	provider.pruneExpiredLocked()
	if entry, ok := provider.entries[key]; ok {
		result := entry.history
		result.Series = cloneSeries(entry.series)
		provider.mu.Unlock()
		return result, nil
	}
	flight, exists := provider.flights[key]
	if !exists {
		if len(provider.flights) >= provider.options.MaxInFlight {
			provider.mu.Unlock()
			return History{}, ErrUnavailable
		}
		flight = &providerFlight{done: make(chan struct{})}
		provider.flights[key] = flight
		go provider.fetchHistory(key, flight, upstream, instrument, from, to)
	}
	provider.mu.Unlock()
	select {
	case <-ctx.Done():
		return History{}, ctx.Err()
	case <-flight.done:
		result := flight.history
		result.Series = cloneSeries(flight.series)
		return result, flight.err
	}
}

func (provider *CachedProvider) fetchHistory(key string, flight *providerFlight, upstream HistoryProvider, instrument universe.Instrument, from, to time.Time) {
	ctx, cancel := context.WithTimeout(context.Background(), provider.options.FetchTimeout)
	defer cancel()
	result, err := upstream.DailyHistory(ctx, instrument, from, to)
	if err == nil {
		err = ValidateHistory(result.Series, instrument.Symbol, from, to)
	}
	provider.mu.Lock()
	defer provider.mu.Unlock()
	if err == nil {
		flight.series = cloneSeries(result.Series)
		result.Series = Series{}
		flight.history = result
		provider.pruneExpiredLocked()
		count := len(flight.series.Candles)
		if count <= provider.options.MaxCandles {
			for len(provider.entries) >= provider.options.MaxEntries || provider.candles+count > provider.options.MaxCandles {
				provider.evictOldestLocked()
			}
			provider.entries[key] = cachedSeries{series: cloneSeries(flight.series), history: result, expiresAt: provider.now().Add(provider.options.TTL)}
			provider.candles += count
		}
	}
	flight.err = err
	delete(provider.flights, key)
	close(flight.done)
}
