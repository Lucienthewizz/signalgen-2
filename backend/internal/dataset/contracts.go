package dataset

import "context"

// Repository provides immutable, checksummed market-data artifacts.
// DynamicStore prepares market data in the active runtime; FixtureStore provides
// deterministic test data. Both keep provider details out of HTTP handlers.
type Repository interface {
	Prepare(ctx context.Context, owner string, request PrepareRequest) (Manifest, error)
	Manifest(ctx context.Context, owner, id string) (Manifest, error)
	Content(ctx context.Context, owner, id string) ([]byte, Manifest, error)
}
