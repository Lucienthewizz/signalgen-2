package marketdata

import (
	"context"
	"strings"
)

// SnapshotProvider pins an immutable view and its opaque revision together.
// CachedProvider resolves it once per logical latest/range request, before keys
// or flights are created. Providers without it retain their existing TTL path.
type SnapshotProvider interface {
	Snapshot(context.Context) (revision string, view Provider, err error)
}

func (provider *CachedProvider) snapshot(ctx context.Context) (Provider, string, error) {
	if err := ctx.Err(); err != nil {
		return nil, "", err
	}
	if snapshots, ok := provider.upstream.(SnapshotProvider); ok {
		revision, view, err := snapshots.Snapshot(ctx)
		if err != nil {
			return nil, "", err
		}
		if view == nil || len(revision) == 0 || len(revision) > 128 || strings.ContainsRune(revision, 0) {
			return nil, "", ErrInvalidData
		}
		return view, revision, nil
	}
	return provider.upstream, "", nil
}
