package universe

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresRepository struct{ db *pgxpool.Pool }

func NewPostgresRepository(db *pgxpool.Pool) *PostgresRepository { return &PostgresRepository{db: db} }

func (store *PostgresRepository) Catalog(ctx context.Context) ([]Instrument, error) {
	rows, err := store.db.Query(ctx, `select symbol,provider_symbol,name,exchange,currency
from signalgen.stock_catalog where active order by symbol`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Instrument, 0, MaxSymbols)
	for rows.Next() {
		var item Instrument
		if err := rows.Scan(&item.Symbol, &item.ProviderSymbol, &item.Name, &item.Exchange, &item.Currency); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

const universeSelect = `select universe.id,universe.name,universe.version,
universe.created_at,universe.updated_at,
coalesce(array_agg(member.symbol order by member.position) filter (where member.symbol is not null),'{}')
from signalgen.stock_universes universe
left join signalgen.stock_universe_members member on member.universe_id=universe.id`

func (store *PostgresRepository) List(ctx context.Context, owner string) ([]Universe, error) {
	rows, err := store.db.Query(ctx, universeSelect+`
where universe.owner_user_id=$1::uuid group by universe.id order by universe.updated_at desc,universe.id limit 100`, strings.TrimSpace(owner))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Universe, 0)
	for rows.Next() {
		item, err := scanUniverse(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (store *PostgresRepository) Get(ctx context.Context, owner, id string) (Universe, error) {
	item, err := scanUniverse(store.db.QueryRow(ctx, universeSelect+`
where universe.owner_user_id=$1::uuid and universe.id=$2 group by universe.id`, strings.TrimSpace(owner), strings.TrimSpace(id)))
	if errors.Is(err, pgx.ErrNoRows) {
		return Universe{}, ErrNotFound
	}
	return item, err
}

func (store *PostgresRepository) Instruments(ctx context.Context, owner, id string) ([]Instrument, error) {
	rows, err := store.db.Query(ctx, `select catalog.symbol,catalog.provider_symbol,catalog.name,catalog.exchange,catalog.currency
from signalgen.stock_universes universe
join signalgen.stock_universe_members member on member.universe_id=universe.id
join signalgen.stock_catalog catalog on catalog.symbol=member.symbol and catalog.active
where universe.owner_user_id=$1::uuid and universe.id=$2 order by member.position`, strings.TrimSpace(owner), strings.TrimSpace(id))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]Instrument, 0, MaxSymbols)
	for rows.Next() {
		var item Instrument
		if err := rows.Scan(&item.Symbol, &item.ProviderSymbol, &item.Name, &item.Exchange, &item.Currency); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if len(items) == 0 {
		return nil, ErrNotFound
	}
	return items, rows.Err()
}

func (store *PostgresRepository) Create(ctx context.Context, owner, name string, symbols []string) (Universe, error) {
	owner, name = strings.TrimSpace(owner), strings.TrimSpace(name)
	if owner == "" || name == "" || !validSymbols(symbols) {
		return Universe{}, ErrInvalid
	}
	tx, err := store.db.Begin(ctx)
	if err != nil {
		return Universe{}, err
	}
	defer tx.Rollback(ctx)
	var id string
	if err := tx.QueryRow(ctx, `insert into signalgen.stock_universes(owner_user_id,name) values($1::uuid,$2) returning id`, owner, name).Scan(&id); err != nil {
		return Universe{}, err
	}
	if err := replaceMembers(ctx, tx, id, symbols); err != nil {
		return Universe{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Universe{}, err
	}
	return store.Get(ctx, owner, id)
}

func (store *PostgresRepository) Update(ctx context.Context, owner, id, name string, symbols []string, version int) (Universe, error) {
	owner, id, name = strings.TrimSpace(owner), strings.TrimSpace(id), strings.TrimSpace(name)
	if owner == "" || id == "" || name == "" || version < 1 || !validSymbols(symbols) {
		return Universe{}, ErrInvalid
	}
	tx, err := store.db.Begin(ctx)
	if err != nil {
		return Universe{}, err
	}
	defer tx.Rollback(ctx)
	command, err := tx.Exec(ctx, `update signalgen.stock_universes set name=$3,version=version+1,updated_at=now()
where owner_user_id=$1::uuid and id=$2 and version=$4`, owner, id, name, version)
	if err != nil {
		return Universe{}, err
	}
	if command.RowsAffected() != 1 {
		if _, err := store.Get(ctx, owner, id); errors.Is(err, ErrNotFound) {
			return Universe{}, ErrNotFound
		}
		return Universe{}, ErrVersionConflict
	}
	if _, err := tx.Exec(ctx, `delete from signalgen.stock_universe_members where universe_id=$1`, id); err != nil {
		return Universe{}, err
	}
	if err := replaceMembers(ctx, tx, id, symbols); err != nil {
		return Universe{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Universe{}, err
	}
	return store.Get(ctx, owner, id)
}

func (store *PostgresRepository) Delete(ctx context.Context, owner, id string, version int) error {
	if strings.TrimSpace(owner) == "" || strings.TrimSpace(id) == "" || version < 1 {
		return ErrInvalid
	}
	command, err := store.db.Exec(ctx, `delete from signalgen.stock_universes where owner_user_id=$1::uuid and id=$2 and version=$3`, owner, id, version)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 1 {
		return nil
	}
	if _, err := store.Get(ctx, owner, id); errors.Is(err, ErrNotFound) {
		return ErrNotFound
	}
	return ErrVersionConflict
}

func replaceMembers(ctx context.Context, tx pgx.Tx, id string, symbols []string) error {
	for position, symbol := range symbols {
		command, err := tx.Exec(ctx, `insert into signalgen.stock_universe_members(universe_id,symbol,position)
select $1,symbol,$3 from signalgen.stock_catalog where symbol=$2 and active`, id, strings.TrimSpace(symbol), position)
		if err != nil {
			return err
		}
		if command.RowsAffected() != 1 {
			return fmt.Errorf("%w: unsupported symbol", ErrInvalid)
		}
	}
	return nil
}

func validSymbols(symbols []string) bool {
	if len(symbols) < 1 || len(symbols) > MaxSymbols {
		return false
	}
	seen := map[string]bool{}
	for _, symbol := range symbols {
		symbol = strings.TrimSpace(symbol)
		if symbol == "" || seen[symbol] {
			return false
		}
		seen[symbol] = true
	}
	return true
}

type scanner interface{ Scan(...any) error }

func scanUniverse(row scanner) (Universe, error) {
	var item Universe
	if err := row.Scan(&item.ID, &item.Name, &item.Version, &item.CreatedAt, &item.UpdatedAt, &item.Symbols); err != nil {
		return Universe{}, err
	}
	return item, nil
}
