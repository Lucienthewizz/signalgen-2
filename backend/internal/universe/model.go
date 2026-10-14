// Package universe owns the small IDX stock catalog and user-defined bundles.
package universe

import (
	"errors"
	"time"
)

// MaxSymbols bounds one owned universe and its dataset/scoring scope, not the catalog.
const MaxSymbols = 10

var (
	ErrLimit           = errors.New("stock universe plan limit reached")
	ErrNotFound        = errors.New("stock universe not found")
	ErrInvalid         = errors.New("invalid stock universe")
	ErrVersionConflict = errors.New("stock universe version conflict")
)

type Instrument struct {
	Symbol         string `json:"symbol"`
	ProviderSymbol string `json:"-"`
	Name           string `json:"name"`
	Exchange       string `json:"exchange"`
	Currency       string `json:"currency"`
}

type Universe struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Symbols   []string  `json:"symbols"`
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
