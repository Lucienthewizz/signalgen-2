package dataset

// Repository provides immutable, checksummed market-data artifacts.
// The fixture implementation can later be replaced by an IDX data provider
// without changing HTTP handlers.
type Repository interface {
	Prepare(request PrepareRequest) (Manifest, error)
	Manifest(id string) (Manifest, error)
	Content(id string) ([]byte, Manifest, error)
}
