package portfolio

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store interface {
	List(context.Context, string) ([]Transaction, error)
	Get(context.Context, string, string) (Transaction, error)
	Put(context.Context, string, string, int64, Data) (Transaction, error)
	Delete(context.Context, string, string, int64) error
}

type PostgresStore struct{ DB *pgxpool.Pool }

const columns = `id::text,book,symbol,market,currency,side,quantity::text,price::text,fee::text,executed_at,note,version,created_at,updated_at`

type scanner interface{ Scan(...any) error }

func scan(row scanner) (Transaction, error) {
	var result Transaction
	d := &result.Data
	err := row.Scan(&result.ID, &d.Book, &d.Symbol, &d.Market, &d.Currency, &d.Side, &d.Quantity, &d.Price, &d.Fee, &d.ExecutedAt, &d.Note, &result.Version, &result.CreatedAt, &result.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Transaction{}, ErrNotFound
	}
	d.ExecutedAt = d.ExecutedAt.UTC()
	return result, err
}

func validID(id string) bool {
	parsed, err := uuid.Parse(id)
	return err == nil && parsed != uuid.Nil && parsed.String() == id
}

func readAll(ctx context.Context, query interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, owner string) ([]Transaction, error) {
	rows, err := query.Query(ctx, `select `+columns+` from signalgen.portfolio_transactions where user_id=$1::uuid order by executed_at,id limit 1001`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return readRows(rows)
}

func readRows(rows pgx.Rows) ([]Transaction, error) {
	items := []Transaction{}
	for rows.Next() {
		item, err := scan(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if len(items) > MaxTransactions {
		return nil, ErrLimit
	}
	return items, rows.Err()
}

// Owner context is transaction-local, including batch reads, before pool reuse.
func (store *PostgresStore) read(ctx context.Context, owner, query string, args ...any) pgx.BatchResults {
	batch := &pgx.Batch{}
	batch.Queue(`select set_config('signalgen.owner_id',$1,true)`, owner)
	batch.Queue(query, args...)
	return store.DB.SendBatch(ctx, batch)
}

func (store *PostgresStore) List(ctx context.Context, owner string) ([]Transaction, error) {
	result := store.read(ctx, owner, `select `+columns+` from signalgen.portfolio_transactions where user_id=$1::uuid order by executed_at,id limit 1001`, owner)
	defer result.Close()
	if _, err := result.Exec(); err != nil {
		return nil, err
	}
	rows, err := result.Query()
	if err != nil {
		return nil, err
	}
	items, err := readRows(rows)
	rows.Close()
	if err != nil {
		return nil, err
	}
	return items, result.Close()
}

func (store *PostgresStore) Get(ctx context.Context, owner, id string) (Transaction, error) {
	if !validID(id) {
		return Transaction{}, ErrInvalid
	}
	result := store.read(ctx, owner, `select `+columns+` from signalgen.portfolio_transactions where user_id=$1::uuid and id=$2::uuid`, owner, id)
	defer result.Close()
	if _, err := result.Exec(); err != nil {
		return Transaction{}, err
	}
	item, err := scan(result.QueryRow())
	if err != nil {
		return Transaction{}, err
	}
	return item, result.Close()
}

func (store *PostgresStore) Put(ctx context.Context, owner, id string, version int64, data Data) (Transaction, error) {
	normal, err := Normalize(data)
	if err != nil {
		return Transaction{}, err
	}
	return store.mutate(ctx, owner, id, version, &normal)
}
func (store *PostgresStore) Delete(ctx context.Context, owner, id string, version int64) error {
	if version < 1 {
		return ErrInvalid
	}
	_, err := store.mutate(ctx, owner, id, version, nil)
	return err
}

// Serialize each owner's mutations, then validate the entire candidate history
// before writing. A backdated edit/delete cannot leave later oversells behind.
func (store *PostgresStore) mutate(ctx context.Context, owner, id string, version int64, data *Data) (Transaction, error) {
	if !validID(owner) || !validID(id) || version < 0 || (data == nil && version == 0) {
		return Transaction{}, ErrInvalid
	}
	tx, err := store.DB.Begin(ctx)
	if err != nil {
		return Transaction{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `select set_config('signalgen.owner_id',$1,true),pg_advisory_xact_lock(hashtextextended($2,0))`, owner, "portfolio:"+owner); err != nil {
		return Transaction{}, err
	}
	items, err := readAll(ctx, tx, owner)
	if err != nil {
		return Transaction{}, err
	}
	index := -1
	for i, item := range items {
		if item.ID == id {
			index = i
			break
		}
	}
	if version == 0 && index >= 0 {
		old := items[index]
		if data != nil && old.Version == 1 && old.Data == *data {
			return old, tx.Commit(ctx)
		}
		return Transaction{}, ErrConflict
	}
	if version > 0 && index < 0 {
		return Transaction{}, ErrNotFound
	}
	if index >= 0 && items[index].Version != version {
		return Transaction{}, ErrConflict
	}
	if data == nil {
		items = append(items[:index], items[index+1:]...)
	} else if index < 0 {
		items = append(items, Transaction{ID: id, Data: *data})
	} else {
		items[index].Data = *data
	}
	if _, err = Recalculate(items); err != nil {
		return Transaction{}, err
	}
	if data == nil {
		if _, err = tx.Exec(ctx, `delete from signalgen.portfolio_transactions where user_id=$1::uuid and id=$2::uuid and version=$3`, owner, id, version); err != nil {
			return Transaction{}, err
		}
		return Transaction{}, tx.Commit(ctx)
	}
	values := []any{owner, id, data.Book, data.Symbol, data.Market, data.Currency, data.Side, data.Quantity, data.Price, data.Fee, data.ExecutedAt, data.Note}
	var row pgx.Row
	if version == 0 {
		row = tx.QueryRow(ctx, `insert into signalgen.portfolio_transactions(user_id,id,book,symbol,market,currency,side,quantity,price,fee,executed_at,note)
values($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8::numeric,$9::numeric,$10::numeric,$11,$12) returning `+columns, values...)
	} else {
		values = append(values, version)
		row = tx.QueryRow(ctx, `update signalgen.portfolio_transactions set book=$3,symbol=$4,market=$5,currency=$6,side=$7,quantity=$8::numeric,price=$9::numeric,fee=$10::numeric,executed_at=$11,note=$12,version=version+1,updated_at=now()
where user_id=$1::uuid and id=$2::uuid and version=$13 returning `+columns, values...)
	}
	item, err := scan(row)
	if err != nil {
		return Transaction{}, err
	}
	return item, tx.Commit(ctx)
}

func (store *PostgresStore) Ready(ctx context.Context) error {
	var ready bool
	err := store.DB.QueryRow(ctx, `select
exists(select 1 from pg_class where oid=to_regclass('signalgen.portfolio_transactions') and relrowsecurity and relforcerowsecurity)
and has_table_privilege(current_user,'signalgen.portfolio_transactions','SELECT')
and has_table_privilege(current_user,'signalgen.portfolio_transactions','INSERT')
and has_table_privilege(current_user,'signalgen.portfolio_transactions','UPDATE')
and has_table_privilege(current_user,'signalgen.portfolio_transactions','DELETE')
and (select count(*)=1 and bool_and(polname='portfolio_owner' and polpermissive and polcmd='*' and polroles=array['signalgen_api'::regrole::oid]
 and pg_get_expr(polqual,polrelid)=$1 and pg_get_expr(polwithcheck,polrelid)=$1)
from pg_policy where polrelid=to_regclass('signalgen.portfolio_transactions'))`,
		`(user_id = (NULLIF(current_setting('signalgen.owner_id'::text, true), ''::text))::uuid)`).Scan(&ready)
	if err != nil || !ready {
		return errors.New("portfolio storage migration/owner policy is unavailable")
	}
	return nil
}

// Query parameters use this allowlist, never SQL fragments from the browser.
func ValidMarketFilter(value string) bool { return value == "" || value == "IDX" || value == "US" }
func Matches(data Data, market, book string) bool {
	return (market == "" || data.Market == market) && (book == "" || data.Book == strings.TrimSpace(book))
}
