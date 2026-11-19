package marketdata

import (
	"context"
	"encoding/json"
	"time"
)

// SharedCache stores only public provider data. Owner-bound datasets, rules,
// grants and authentication never cross this boundary.
type SharedCache interface {
	Get(context.Context, string) ([]byte, error)
	Set(context.Context, string, []byte, time.Duration) error
}

const maxSharedPayload = 2 * 1024 * 1024

// Series intentionally omits these fields from API JSON. Preserve them in the
// cache envelope so cache hits retain range and data-quality evidence.
type sharedPayload struct {
	Version          int       `json:"version"`
	Series           Series    `json:"series"`
	RequestedFrom    string    `json:"requested_from"`
	RequestedTo      string    `json:"requested_to"`
	Warnings         []string  `json:"warnings"`
	SkippedNullRows  int       `json:"skipped_null_rows"`
	ExcludedOpenRows int       `json:"excluded_open_rows"`
	ExpiresAt        time.Time `json:"expires_at"`
}

func (provider *CachedProvider) readShared(ctx context.Context, key string, ttl time.Duration, validate func(Series) error) (cachedSeries, bool) {
	if provider.options.Shared == nil {
		return cachedSeries{}, false
	}
	data, err := provider.options.Shared.Get(ctx, key)
	if err != nil || len(data) == 0 || len(data) > maxSharedPayload {
		return cachedSeries{}, false
	}
	var payload sharedPayload
	if json.Unmarshal(data, &payload) != nil || payload.Version != 1 ||
		!payload.ExpiresAt.After(provider.now()) || payload.ExpiresAt.After(provider.now().Add(ttl)) ||
		payload.SkippedNullRows < 0 || payload.ExcludedOpenRows < 0 {
		return cachedSeries{}, false
	}
	payload.Series.RequestedFrom = payload.RequestedFrom
	payload.Series.RequestedTo = payload.RequestedTo
	payload.Series.QualityWarnings = payload.Warnings
	if validate(payload.Series) != nil {
		return cachedSeries{}, false
	}
	return cachedSeries{series: payload.Series, expiresAt: payload.ExpiresAt, history: History{
		SkippedNullRows: payload.SkippedNullRows, ExcludedOpenRows: payload.ExcludedOpenRows,
	}}, true
}

func (provider *CachedProvider) writeShared(ctx context.Context, key string, entry cachedSeries) {
	if provider.options.Shared == nil || len(entry.series.Candles) > provider.options.MaxCandles {
		return
	}
	data, err := json.Marshal(sharedPayload{
		Version: 1, Series: entry.series, RequestedFrom: entry.series.RequestedFrom,
		RequestedTo: entry.series.RequestedTo, Warnings: entry.series.QualityWarnings,
		SkippedNullRows: entry.history.SkippedNullRows, ExcludedOpenRows: entry.history.ExcludedOpenRows,
		ExpiresAt: entry.expiresAt,
	})
	if err != nil || len(data) > maxSharedPayload {
		return
	}
	if ttl := entry.expiresAt.Sub(provider.now()); ttl > 0 {
		// Redis failure must not turn valid provider data into a screening error.
		_ = provider.options.Shared.Set(ctx, key, data, ttl)
	}
}
