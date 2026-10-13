// Package workspace persists owner-scoped presentation state, never permissions
// or authoritative scoring/journal data. Client run snapshots remain unverified.
package workspace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"time"
)

var ErrConflict = errors.New("workspace version conflict")
var ErrInvalid = errors.New("invalid workspace state")

const MaxData = 120_000

type Item struct {
	Kind      string          `json:"kind"`
	Data      json.RawMessage `json:"data"`
	Version   int64           `json:"version"`
	UpdatedAt time.Time       `json:"updated_at"`
}
type Store interface {
	List(context.Context, string) ([]Item, error)
	Put(context.Context, string, string, int64, json.RawMessage) (Item, error)
}
type PostgresStore struct{ DB *pgxpool.Pool }

func Valid(kind string, data json.RawMessage) bool {
	if len(data) == 0 || len(data) > MaxData || !json.Valid(data) {
		return false
	}
	switch kind {
	case "rule-draft", "screener-preferences", "monitor-history", "watchlist":
	default:
		return false
	}
	var value any
	if json.Unmarshal(data, &value) != nil {
		return false
	}
	if value == nil {
		return true
	}
	// Bound nesting and reject accidental credential/authorization serialization.
	var safe func(any, int) bool
	safe = func(v any, depth int) bool {
		if depth > 14 {
			return false
		}
		switch t := v.(type) {
		case map[string]any:
			if len(t) > 60 {
				return false
			}
			for k, c := range t {
				switch k {
				case "access_token", "refresh_token", "session_token", "password", "role", "entitlement":
					return false
				}
				if !safe(c, depth+1) {
					return false
				}
			}
		case []any:
			if len(t) > 100 {
				return false
			}
			for _, c := range t {
				if !safe(c, depth+1) {
					return false
				}
			}
		case string:
			if len(t) > 4096 {
				return false
			}
		}
		return true
	}
	if !safe(value, 0) {
		return false
	}
	switch kind {
	case "watchlist":
		values, ok := value.([]any)
		if !ok || len(values) > 30 {
			return false
		}
		for _, v := range values {
			s, ok := v.(string)
			if !ok || len(s) != 4 {
				return false
			}
			for _, c := range s {
				if c < 'A' || c > 'Z' {
					return false
				}
			}
		}
	case "monitor-history":
		values, ok := value.([]any)
		return ok && len(values) <= 10
	default:
		_, ok := value.(map[string]any)
		return ok
	}
	return true
}

func (s *PostgresStore) List(ctx context.Context, owner string) ([]Item, error) {
	rows, err := s.DB.Query(ctx, `select kind,data,version,updated_at from signalgen.workspace_state where user_id=$1::uuid order by kind`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Item{}
	for rows.Next() {
		var item Item
		if err = rows.Scan(&item.Kind, &item.Data, &item.Version, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
func (s *PostgresStore) Put(ctx context.Context, owner, kind string, version int64, data json.RawMessage) (Item, error) {
	if version < 0 || !Valid(kind, data) {
		return Item{}, ErrInvalid
	}
	var item Item
	err := s.DB.QueryRow(ctx, `insert into signalgen.workspace_state(user_id,kind,data,version)
 select $1::uuid,$2,$3::jsonb,1 where $4::bigint=0
 on conflict(user_id,kind) do update set data=excluded.data,version=workspace_state.version+1,updated_at=now()
 where workspace_state.version=$4
 returning kind,data,version,updated_at`, owner, kind, data, version).Scan(&item.Kind, &item.Data, &item.Version, &item.UpdatedAt)
	// Existing rows with nonzero version need an UPDATE: the INSERT predicate
	// above intentionally permits creation only at version zero.
	if errors.Is(err, pgx.ErrNoRows) && version > 0 {
		err = s.DB.QueryRow(ctx, `update signalgen.workspace_state set data=$3::jsonb,version=version+1,updated_at=now()
  where user_id=$1::uuid and kind=$2 and version=$4 returning kind,data,version,updated_at`, owner, kind, data, version).Scan(&item.Kind, &item.Data, &item.Version, &item.UpdatedAt)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrConflict
	}
	if err != nil {
		return Item{}, fmt.Errorf("workspace write: %w", err)
	}
	return item, nil
}
