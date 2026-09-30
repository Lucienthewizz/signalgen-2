package dataset

import "context"

// Repository provides immutable, checksummed market-data artifacts.
// The fixture implementation can later be replaced by an IDX data provider
// without changing HTTP handlers.
type Repository interface {
	Prepare(ctx context.Context, owner string, request PrepareRequest) (Manifest, error)
	Manifest(ctx context.Context, owner, id string) (Manifest, error)
	Content(ctx context.Context, owner, id string) ([]byte, Manifest, error)
}
