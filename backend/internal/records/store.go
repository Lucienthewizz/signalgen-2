// Package records stores private user records. Every transaction has both an
// explicit owner predicate and a transaction-local RLS owner context.
package records

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrConflict = errors.New("record version conflict")
var ErrNotFound = errors.New("record not found")
var ErrQuota = errors.New("record quota reached")

const MaxArchiveBytes = 8 << 20

type Item struct {
	ID      string          `json:"id"`
	Data    json.RawMessage `json:"data"`
	Version int64           `json:"version"`
	Bytes   int64           `json:"bytes"`
}
type Store interface {
	List(context.Context, string, string) ([]Item, error)
	Get(context.Context, string, string, string) (Item, error)
	Put(context.Context, string, string, string, int64, json.RawMessage) (Item, error)
	Delete(context.Context, string, string, string, int64) error
}
type PostgresStore struct{ DB *pgxpool.Pool }

func (s *PostgresStore) begin(ctx context.Context, owner string, write bool) (pgx.Tx, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `select set_config('signalgen.owner_id',$1,true)`, owner); err == nil && write {
		_, err = tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1,0))`, owner)
	}
	if err != nil {
		_ = tx.Rollback(ctx)
		return nil, err
	}
	return tx, nil
}
func scan(row pgx.Row) (Item, error) {
	var item Item
	err := row.Scan(&item.ID, &item.Data, &item.Version, &item.Bytes)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return item, err
}
func (s *PostgresStore) List(ctx context.Context, owner, kind string) ([]Item, error) {
	tx, err := s.begin(ctx, owner, false)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `select id, case when kind='backtest' then data - 'result' else data end,version,octet_length(data::text) from signalgen.user_records where user_id=$1::uuid and kind=$2 order by created_at desc,id limit 1000`, owner, kind)
	if err != nil {
		return nil, err
	}
	items := []Item{}
	for rows.Next() {
		item, e := scan(rows)
		if e != nil {
			rows.Close()
			return nil, e
		}
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	return items, tx.Commit(ctx)
}
func (s *PostgresStore) Get(ctx context.Context, owner, kind, id string) (Item, error) {
	tx, err := s.begin(ctx, owner, false)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback(ctx)
	item, err := scan(tx.QueryRow(ctx, `select id,data,version,octet_length(data::text) from signalgen.user_records where user_id=$1::uuid and kind=$2 and id=$3::uuid`, owner, kind, id))
	if err != nil {
		return Item{}, err
	}
	return item, tx.Commit(ctx)
}
func (s *PostgresStore) Put(ctx context.Context, owner, kind, id string, version int64, data json.RawMessage) (Item, error) {
	tx, err := s.begin(ctx, owner, true)
	if err != nil {
		return Item{}, err
	}
	defer tx.Rollback(ctx)
	if version == 0 {
		var count int
		var existing bool
		if err = tx.QueryRow(ctx, `select count(*),coalesce(bool_or(id=$3::uuid),false) from signalgen.user_records where user_id=$1::uuid and kind=$2`, owner, kind, id).Scan(&count, &existing); err != nil {
			return Item{}, err
		}
		if kind == "journal" && count >= 1000 && !existing {
			return Item{}, ErrQuota
		}
	}
	var item Item
	if version == 0 {
		item, err = scan(tx.QueryRow(ctx, `insert into signalgen.user_records(user_id,kind,id,data) values($1::uuid,$2,$3::uuid,$4::jsonb) on conflict(user_id,kind,id) do update set data=user_records.data where (user_records.kind='backtest' or user_records.version=1) and user_records.data=excluded.data returning id,data,version,octet_length(data::text)`, owner, kind, id, data))
	} else {
		item, err = scan(tx.QueryRow(ctx, `update signalgen.user_records set data=$4::jsonb,version=version+1,updated_at=now() where user_id=$1::uuid and kind=$2 and id=$3::uuid and version=$5 returning id,data,version,octet_length(data::text)`, owner, kind, id, data, version))
	}
	if errors.Is(err, ErrNotFound) {
		return Item{}, ErrConflict
	}
	if err != nil {
		return Item{}, err
	}
	if kind == "backtest" {
		// The newest ten, and at most 50 MiB, are retained atomically per owner.
		_, err = tx.Exec(ctx, `delete from signalgen.user_records where user_id=$1::uuid and kind='backtest' and id in (select id from (select id,row_number() over(order by created_at desc,id) n,sum(octet_length(data::text)) over(order by created_at desc,id) bytes from signalgen.user_records where user_id=$1::uuid and kind='backtest') bounded where n>10 or bytes>52428800)`, owner)
		if err != nil {
			return Item{}, err
		}
	}
	return item, tx.Commit(ctx)
}
func (s *PostgresStore) Delete(ctx context.Context, owner, kind, id string, version int64) error {
	tx, err := s.begin(ctx, owner, true)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var n int64
	if id == "" && kind == "backtest" {
		tag, e := tx.Exec(ctx, `delete from signalgen.user_records where user_id=$1::uuid and kind=$2`, owner, kind)
		err = e
		n = tag.RowsAffected()
	} else {
		tag, e := tx.Exec(ctx, `delete from signalgen.user_records where user_id=$1::uuid and kind=$2 and id=$3::uuid and version=$4`, owner, kind, id, version)
		err = e
		n = tag.RowsAffected()
		if err == nil && n == 0 {
			return ErrConflict
		}
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
