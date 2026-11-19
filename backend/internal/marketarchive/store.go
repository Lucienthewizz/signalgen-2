package marketarchive

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct{ DB *pgxpool.Pool }

// Report contains collection metadata and coverage, never a database credential.
func (s *Store) Report(ctx context.Context, id string) (Run, error) {
	var r Run
	err := s.DB.QueryRow(ctx, `select id,revision,scope,market,external_id,trigger,requested_from,requested_to,status,total,successful,failed,inserted,changed,unchanged,coalesce(preflight_bytes,0),coalesce(projected_bytes,0),started_at,finished_at from signalgen.market_sync_runs where id=$1`, id).Scan(&r.ID, &r.Revision, &r.Scope, &r.Market, &r.ExternalID, &r.Trigger, &r.From, &r.To, &r.Status, &r.Total, &r.Successful, &r.Failed, &r.Inserted, &r.Changed, &r.Unchanged, &r.PreflightBytes, &r.ProjectedBytes, &r.StartedAt, &r.FinishedAt)
	return r, err
}

func (s *Store) DatabaseBytes(ctx context.Context) (int64, error) {
	var size int64
	err := s.DB.QueryRow(ctx, `select pg_database_size(current_database())`).Scan(&size)
	return size, err
}

func (s *Store) Lock(ctx context.Context, scope, market string) (context.Context, func(), error) {
	conn, err := s.DB.Acquire(ctx)
	if err != nil {
		return ctx, nil, err
	}
	var locked bool
	key := "signalgen:market:" + scope + ":" + market
	err = conn.QueryRow(ctx, `select pg_try_advisory_lock(hashtextextended($1,0))`, key).Scan(&locked)
	if err != nil || !locked {
		conn.Release()
		if err != nil {
			return ctx, nil, err
		}
		return ctx, nil, ErrBusy
	}
	leased, cancelLease := context.WithCancel(ctx)
	done := make(chan struct{})
	// Keep the session lease alive during multi-hour imports. If its socket
	// dies, cancel collection before a second scheduler can publish concurrently.
	go func() {
		defer close(done)
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-leased.Done():
				return
			case <-ticker.C:
				probe, cancel := context.WithTimeout(leased, 5*time.Second)
				err := conn.Ping(probe)
				cancel()
				if err != nil {
					cancelLease()
					return
				}
			}
		}
	}()
	return leased, func() {
		cancelLease()
		<-done
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := conn.Exec(cleanup, `select pg_advisory_unlock(hashtextextended($1,0))`, key); err != nil {
			_ = conn.Conn().Close(cleanup)
		}
		conn.Release()
	}, nil
}

func (s *Store) Catalog(ctx context.Context, market, scope string) ([]universe.Instrument, error) {
	if market != "IDX" && market != "US" || scope != "production" && scope != "smoke" {
		return nil, universe.ErrInvalid
	}
	rows, err := s.DB.Query(ctx, `select symbol,provider_symbol,name,exchange,currency from signalgen.stock_catalog
where active and provider='yahoo_finance' and (($1='IDX' and exchange='XIDX') or ($1='US' and exchange in ('XNAS','XNYS')))
and ($2='production' or symbol=any(array['BBCA.JK','BBRI.JK','TLKM.JK','AAPL','MSFT','NVDA'])) order by symbol`, market, scope)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []universe.Instrument{}
	for rows.Next() {
		var item universe.Instrument
		if err := rows.Scan(&item.Symbol, &item.ProviderSymbol, &item.Name, &item.Exchange, &item.Currency); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(items) == 0 || scope == "smoke" && len(items) != 3 {
		return nil, fmt.Errorf("required market catalog is incomplete")
	}
	return items, nil
}

func (s *Store) Begin(ctx context.Context, scope, market, external, event string, from, to time.Time, items []universe.Instrument) (Run, error) {
	run := Run{ID: uuid.NewString(), Scope: scope, Market: market, ExternalID: external, Trigger: event, From: from, To: to, Status: "running", Total: len(items)}
	if len(items) == 0 || !from.Before(to) || scope != "production" && scope != "smoke" || len(external) < 1 || len(external) > 160 {
		return run, universe.ErrInvalid
	}
	for _, item := range items {
		actual, _, err := universe.InstrumentMarket([]universe.Instrument{item})
		if err != nil || actual != market {
			return run, universe.ErrInvalid
		}
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return run, err
	}
	defer tx.Rollback(context.Background())
	var boundHash string
	var boundFrom, boundTo time.Time
	var total int
	err = tx.QueryRow(ctx, `insert into signalgen.market_sync_runs(id,scope,market,external_id,trigger,catalog_sha256,requested_from,requested_to,total)
values($1,$2,$3,$4,$5,$6,$7,$8,$9)
on conflict(scope,market,external_id) do update set external_id=excluded.external_id
returning id,revision,status,catalog_sha256,requested_from,requested_to,total`, run.ID, scope, market, external, event, catalogHash(items), from, to, len(items)).Scan(&run.ID, &run.Revision, &run.Status, &boundHash, &boundFrom, &boundTo, &total)
	if err != nil {
		return run, err
	}
	if boundHash != catalogHash(items) || !boundFrom.Equal(from) || !boundTo.Equal(to) || total != len(items) {
		return run, fmt.Errorf("run identifier belongs to another frozen context")
	}
	if run.Status != "running" {
		return run, tx.Commit(ctx)
	}
	batch := &pgx.Batch{}
	for _, item := range items {
		batch.Queue(`insert into signalgen.market_sync_items(run_id,scope,market,symbol) values($1,$2,$3,$4) on conflict do nothing`, run.ID, scope, market, item.Symbol)
	}
	if err := tx.SendBatch(ctx, batch).Close(); err != nil {
		return run, err
	}
	return run, tx.Commit(ctx)
}

func (s *Store) Stage(ctx context.Context, run Run, item universe.Instrument, history marketdata.History, attempts int, sourceErr error) error {
	quality := Quality{Warnings: history.Series.QualityWarnings, SkippedNullRows: history.SkippedNullRows, ExcludedOpenRows: history.ExcludedOpenRows, CheckedAt: time.Now().UTC()}
	status, code := "success", ""
	if sourceErr == nil {
		sourceErr = marketdata.ValidateHistory(history.Series, item.Symbol, run.From, run.To)
	}
	var payload []byte
	if sourceErr == nil {
		payload, _ = json.Marshal(history.Series.Candles)
	} else {
		status = "failed"
		code = sourceCode(sourceErr)
		history.Series.Candles = nil
	}
	raw, _ := json.Marshal(quality)
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('signalgen:market:capacity',0))`); err != nil {
		return err
	}
	var size int64
	if err = tx.QueryRow(ctx, `select pg_database_size(current_database())`).Scan(&size); err != nil {
		return err
	}
	if size+int64(len(payload))*2+32768 >= HardBudget {
		return ErrCapacity
	}
	_, err = tx.Exec(ctx, `update signalgen.market_sync_items set status=$3,candle_count=$4,attempts=$5,error_code=nullif($6,''),quality=$7,payload=$8,checked_at=clock_timestamp() where run_id=$1 and symbol=$2 and exists(select 1 from signalgen.market_sync_runs r where r.id=$1 and r.status='running')`, run.ID, item.Symbol, status, len(history.Series.Candles), attempts, code, raw, payload)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func sourceCode(err error) string {
	var httpErr *marketdata.HTTPError
	if errors.As(err, &httpErr) {
		return fmt.Sprintf("PROVIDER_HTTP_%d", httpErr.Status)
	}
	if errors.Is(err, context.Canceled) {
		return "CANCELLED"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "TIMEOUT"
	}
	if errors.Is(err, marketdata.ErrInvalidData) {
		return "INVALID_OHLCV"
	}
	return "PROVIDER_UNAVAILABLE"
}

func (s *Store) MarkStopped(ctx context.Context, run Run, status string) error {
	if status != "cancelled" && status != "failed" && status != "capacity_blocked" {
		return universe.ErrInvalid
	}
	_, err := s.DB.Exec(ctx, `update signalgen.market_sync_runs set status=$2,finished_at=clock_timestamp(),successful=(select count(*) from signalgen.market_sync_items where run_id=$1 and status='success'),failed=total-(select count(*) from signalgen.market_sync_items where run_id=$1 and status='success') where id=$1 and status='running'`, run.ID, status)
	return err
}

// Publish applies staged results in one transaction. Only changed candle rows
// get a new version; old pinned readers remain valid during the 72h grace.
func (s *Store) Publish(ctx context.Context, run Run) (Run, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return run, err
	}
	defer tx.Rollback(context.Background())
	// Both markets share one database budget, despite separate market locks.
	if _, err = tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('signalgen:market:capacity',0))`); err != nil {
		return run, err
	}
	var status string
	if err = tx.QueryRow(ctx, `select status from signalgen.market_sync_runs where id=$1 for update`, run.ID).Scan(&status); err != nil {
		return run, err
	}
	if status != "running" {
		run.Status = status
		return run, nil
	}
	var size int64
	if err = tx.QueryRow(ctx, `select pg_database_size(current_database())`).Scan(&size); err != nil {
		return run, err
	}
	if size >= HardBudget {
		return run, ErrCapacity
	}
	var stagedCount int64
	if err = tx.QueryRow(ctx, `select coalesce(sum(candle_count),0) from signalgen.market_sync_items where run_id=$1 and status='success'`, run.ID).Scan(&stagedCount); err != nil {
		return run, err
	}
	// Reserve tuple/index space before the atomic insert, not after exceeding
	// the hard ceiling. Staging bytes are already included in database size.
	if size+stagedCount*512 >= HardBudget {
		return run, ErrCapacity
	}
	if err = tx.QueryRow(ctx, `select count(*) filter(where status='success'),count(*) filter(where status<>'success') from signalgen.market_sync_items where run_id=$1`, run.ID).Scan(&run.Successful, &run.Failed); err != nil {
		return run, err
	}
	if run.Successful == 0 {
		if _, err = tx.Exec(ctx, `update signalgen.market_sync_runs set status='failed',failed=total,finished_at=clock_timestamp() where id=$1`, run.ID); err != nil {
			return run, err
		}
		run.Status = "failed"
		return run, tx.Commit(ctx)
	}
	staged := `select i.symbol,c.* from signalgen.market_sync_items i cross join lateral jsonb_to_recordset(i.payload) as c(timestamp timestamptz,open float8,high float8,low float8,close float8,volume bigint) where i.run_id=$1 and i.status='success'`
	changed, err := tx.Exec(ctx, `with staged as (`+staged+`) update signalgen.market_candles old set valid_to=$2 from staged s
where old.scope=$3 and old.symbol=s.symbol and old.provider='yahoo_finance' and old.timeframe='1d' and old.timestamp=s.timestamp and old.valid_to is null
and row(old.open,old.high,old.low,old.close,old.volume) is distinct from row(s.open,s.high,s.low,s.close,s.volume)`, run.ID, run.Revision, run.Scope)
	if err != nil {
		return run, err
	}
	inserted, err := tx.Exec(ctx, `with staged as (`+staged+`) insert into signalgen.market_candles(scope,symbol,timestamp,valid_from,open,high,low,close,volume)
select $3,s.symbol,s.timestamp,$2,s.open,s.high,s.low,s.close,s.volume from staged s
where not exists(select 1 from signalgen.market_candles c where c.scope=$3 and c.symbol=s.symbol and c.provider='yahoo_finance' and c.timeframe='1d' and c.timestamp=s.timestamp and c.valid_to is null)`, run.ID, run.Revision, run.Scope)
	if err != nil {
		return run, err
	}
	run.Changed = int(changed.RowsAffected())
	run.Inserted = int(inserted.RowsAffected()) - run.Changed
	if _, err = tx.Exec(ctx, `update signalgen.market_sync_items i set changed=(select count(*) from signalgen.market_candles c where c.scope=i.scope and c.symbol=i.symbol and c.valid_to=$2),
inserted=(select count(*) from signalgen.market_candles c where c.scope=i.scope and c.symbol=i.symbol and c.valid_from=$2)
where i.run_id=$1 and i.status='success'`, run.ID, run.Revision); err != nil {
		return run, err
	}
	if _, err = tx.Exec(ctx, `update signalgen.market_sync_items set unchanged=candle_count-inserted,inserted=inserted-changed where run_id=$1 and status='success'`, run.ID); err != nil {
		return run, err
	}
	if err = tx.QueryRow(ctx, `select coalesce(sum(unchanged),0) from signalgen.market_sync_items where run_id=$1`, run.ID).Scan(&run.Unchanged); err != nil {
		return run, err
	}
	// Retire out-of-window rows without breaking snapshots from before this run.
	if _, err = tx.Exec(ctx, `update signalgen.market_candles c set valid_to=$1 from signalgen.stock_catalog s where c.symbol=s.symbol and c.scope=$2 and c.valid_to is null and c.timestamp<$3
and (($4='IDX' and s.exchange='XIDX') or ($4='US' and s.exchange in ('XNAS','XNYS')))`, run.Revision, run.Scope, run.From, run.Market); err != nil {
		return run, err
	}
	run.Status = "published"
	if run.Failed > 0 {
		run.Status = "partial"
	}
	if _, err = tx.Exec(ctx, `update signalgen.market_sync_runs set status=$2,successful=$3,failed=$4,inserted=$5,changed=$6,unchanged=$7,finished_at=clock_timestamp() where id=$1`, run.ID, run.Status, run.Successful, run.Failed, run.Inserted, run.Changed, run.Unchanged); err != nil {
		return run, err
	}
	if _, err = tx.Exec(ctx, `insert into signalgen.market_publications(scope,market,revision,run_id) values($1,$2,$3,$4)
on conflict(scope,market) do update set revision=excluded.revision,run_id=excluded.run_id,published_at=clock_timestamp()
where signalgen.market_publications.revision<excluded.revision`, run.Scope, run.Market, run.Revision, run.ID); err != nil {
		return run, err
	}
	if _, err = tx.Exec(ctx, `update signalgen.market_sync_items set payload=null where run_id=$1`, run.ID); err != nil {
		return run, err
	}
	return run, tx.Commit(ctx)
}

func (s *Store) Prune(ctx context.Context, scope string) error {
	// Remove only retired versions whose retiring publication is older than 72h.
	_, err := s.DB.Exec(ctx, `delete from signalgen.market_candles c using signalgen.market_sync_runs r where c.scope=$1 and c.valid_to=r.revision and r.finished_at<clock_timestamp()-interval '72 hours'`, scope)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(ctx, `delete from signalgen.market_sync_items i using signalgen.market_sync_runs r where i.run_id=r.id and i.scope=$1 and r.finished_at<clock_timestamp()-interval '72 hours'
and (i.status<>'success' or exists(select 1 from signalgen.market_sync_items newer join signalgen.market_sync_runs nr on nr.id=newer.run_id where newer.scope=i.scope and newer.market=i.market and newer.symbol=i.symbol and newer.status='success' and nr.status in ('published','partial') and newer.checked_at>i.checked_at))`, scope)
	return err
}
