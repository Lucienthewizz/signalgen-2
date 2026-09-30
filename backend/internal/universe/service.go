package universe

import "context"

type Repository interface {
	Catalog(ctx context.Context) ([]Instrument, error)
	List(ctx context.Context, owner string) ([]Universe, error)
	Get(ctx context.Context, owner, id string) (Universe, error)
	Instruments(ctx context.Context, owner, id string) ([]Instrument, error)
	Create(ctx context.Context, owner, name string, symbols []string) (Universe, error)
	Update(ctx context.Context, owner, id, name string, symbols []string, version int) (Universe, error)
	Delete(ctx context.Context, owner, id string, version int) error
}
