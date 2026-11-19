package marketarchive

import (
	"context"
	"fmt"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Provider struct {
	db   *pgxpool.Pool
	live marketdata.Provider
}
type publication struct {
	revision            int64
	from, to, published time.Time
}
type archiveView struct {
	provider     *Provider
	publications map[string]publication
}

func NewProvider(db *pgxpool.Pool, live marketdata.Provider) (*Provider, error) {
	if db == nil || live == nil {
		return nil, fmt.Errorf("Postgres archive requires database and intraday provider")
	}
	return &Provider{db: db, live: live}, nil
}

func (p *Provider) Ready(ctx context.Context) error {
	var ready bool
	err := p.db.QueryRow(ctx, `select coalesce(bool_and(has_table_privilege(current_user,relation,'SELECT') and not has_table_privilege(current_user,relation,'INSERT,UPDATE,DELETE')),false)
from unnest(array['signalgen.market_publications','signalgen.market_sync_runs','signalgen.market_sync_items','signalgen.market_candles']) relation`).Scan(&ready)
	if err != nil || !ready {
		return fmt.Errorf("Postgres archive schema/read privileges are incomplete")
	}
	return nil
}

func (p *Provider) Snapshot(ctx context.Context) (string, marketdata.Provider, error) {
	rows, err := p.db.Query(ctx, `select p.market,p.revision,r.requested_from,r.requested_to,p.published_at from signalgen.market_publications p join signalgen.market_sync_runs r on r.id=p.run_id where p.scope='production'`)
	if err != nil {
		return "", nil, marketdata.ErrUnavailable
	}
	defer rows.Close()
	view := &archiveView{provider: p, publications: map[string]publication{}}
	for rows.Next() {
		var market string
		var item publication
		if err := rows.Scan(&market, &item.revision, &item.from, &item.to, &item.published); err != nil {
			return "", nil, marketdata.ErrUnavailable
		}
		view.publications[market] = item
	}
	if rows.Err() != nil {
		return "", nil, marketdata.ErrUnavailable
	}
	return fmt.Sprintf("pg-idx-%d-us-%d", view.publications["IDX"].revision, view.publications["US"].revision), view, nil
}

func (p *Provider) Daily(ctx context.Context, items []universe.Instrument, size int) ([]marketdata.Series, error) {
	_, view, err := p.Snapshot(ctx)
	if err != nil {
		return nil, err
	}
	return view.Daily(ctx, items, size)
}
func (p *Provider) Candles(ctx context.Context, items []universe.Instrument, size int, timeframe string) ([]marketdata.Series, error) {
	_, view, err := p.Snapshot(ctx)
	if err != nil {
		return nil, err
	}
	return marketdata.ReadCandles(ctx, view, items, size, timeframe)
}
func (p *Provider) DailyHistory(ctx context.Context, item universe.Instrument, from, to time.Time) (marketdata.History, error) {
	_, view, err := p.Snapshot(ctx)
	if err != nil {
		return marketdata.History{}, err
	}
	return view.(marketdata.HistoryProvider).DailyHistory(ctx, item, from, to)
}
func (p *Provider) Source() marketdata.Source {
	return marketdata.Source{Provider: "yahoo_finance", Warnings: []string{"Shared PostgreSQL daily archive: rolling three calendar months. Coverage is per instrument; not a real-time licensed feed. Intraday remains periodic Yahoo data."}}
}

func (v *archiveView) Candles(ctx context.Context, items []universe.Instrument, size int, timeframe string) ([]marketdata.Series, error) {
	if timeframe == "" || timeframe == "1d" {
		return v.Daily(ctx, items, size)
	}
	return marketdata.ReadCandles(ctx, v.provider.live, items, size, timeframe)
}

func (v *archiveView) Daily(ctx context.Context, items []universe.Instrument, size int) ([]marketdata.Series, error) {
	market, _, err := universe.InstrumentMarket(items)
	if err != nil || size < 20 || size > 5000 {
		return nil, marketdata.ErrInvalidData
	}
	pub, ok := v.publications[market]
	if !ok {
		return nil, marketdata.ErrUnavailable
	}
	series, _, err := v.read(ctx, items, pub.from, pub.to, size)
	if err != nil {
		return nil, err
	}
	if err := marketdata.ValidateSeries(series, items, size); err != nil {
		return nil, marketdata.ErrInsufficientCandles
	}
	return series, nil
}

func (v *archiveView) DailyHistory(ctx context.Context, item universe.Instrument, from, to time.Time) (marketdata.History, error) {
	market, _, err := universe.InstrumentMarket([]universe.Instrument{item})
	if err != nil || !from.Before(to) {
		return marketdata.History{}, marketdata.ErrInvalidData
	}
	pub, ok := v.publications[market]
	if !ok {
		return marketdata.History{}, marketdata.ErrUnavailable
	}
	if from.Before(pub.from) {
		return marketdata.History{}, marketdata.ErrHistoryUnavailable
	}
	series, quality, err := v.read(ctx, []universe.Instrument{item}, from, to, 2500)
	if err != nil {
		return marketdata.History{}, err
	}
	if err = marketdata.ValidateHistory(series[0], item.Symbol, from, to); err != nil {
		return marketdata.History{}, err
	}
	return marketdata.History{Series: series[0], SkippedNullRows: quality[item.Symbol].SkippedNullRows, ExcludedOpenRows: quality[item.Symbol].ExcludedOpenRows}, nil
}

func (v *archiveView) read(ctx context.Context, items []universe.Instrument, from, to time.Time, size int) ([]marketdata.Series, map[string]Quality, error) {
	market, _, err := universe.InstrumentMarket(items)
	if err != nil {
		return nil, nil, marketdata.ErrInvalidData
	}
	pub := v.publications[market]
	symbols := make([]string, len(items))
	for i, item := range items {
		symbols[i] = item.Symbol
	}
	rows, err := v.provider.db.Query(ctx, `select c.symbol,c.timestamp,c.open,c.high,c.low,c.close,c.volume,s.provider_symbol,s.exchange,s.currency
from signalgen.market_candles c join signalgen.stock_catalog s on s.symbol=c.symbol
where c.scope='production' and c.symbol=any($1::text[]) and c.provider='yahoo_finance' and c.timeframe='1d'
and c.timestamp>=$2 and c.timestamp<$3 and c.valid_from<=$4 and (c.valid_to is null or c.valid_to>$4)
order by c.symbol,c.timestamp`, symbols, from, to, pub.revision)
	if err != nil {
		return nil, nil, marketdata.ErrUnavailable
	}
	bySymbol := map[string][]core.Candle{}
	expected := map[string]universe.Instrument{}
	for _, item := range items {
		expected[item.Symbol] = item
	}
	for rows.Next() {
		var symbol, providerSymbol, exchange, currency string
		var stamp time.Time
		var c core.Candle
		if err = rows.Scan(&symbol, &stamp, &c.Open, &c.High, &c.Low, &c.Close, &c.Volume, &providerSymbol, &exchange, &currency); err != nil {
			break
		}
		item := expected[symbol]
		if item.ProviderSymbol != providerSymbol || item.Exchange != exchange || item.Currency != currency {
			err = marketdata.ErrInvalidData
			break
		}
		c.Timestamp = stamp.UTC().Format(time.RFC3339)
		bySymbol[symbol] = append(bySymbol[symbol], c)
		if len(bySymbol[symbol]) > 2500 {
			err = marketdata.ErrInvalidData
			break
		}
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return nil, nil, marketdata.ErrUnavailable
	}
	qualities := map[string]Quality{}
	latest := map[string]string{}
	meta, err := v.provider.db.Query(ctx, `select distinct on(i.symbol) i.symbol,i.quality,coalesce((select recent.status from signalgen.market_sync_items recent join signalgen.market_sync_runs head on head.id=recent.run_id where head.revision=$3 and recent.symbol=i.symbol),'missing') from signalgen.market_sync_items i join signalgen.market_sync_runs r on r.id=i.run_id
where i.scope='production' and i.market=$1 and i.symbol=any($2::text[]) and i.status='success' and r.status in ('published','partial') and r.revision<=$3 order by i.symbol,r.revision desc`, market, symbols, pub.revision)
	if err != nil {
		return nil, nil, marketdata.ErrUnavailable
	}
	for meta.Next() {
		var symbol string
		var q Quality
		var status string
		if err = meta.Scan(&symbol, &q, &status); err != nil {
			break
		}
		qualities[symbol] = q
		latest[symbol] = status
	}
	if err == nil {
		err = meta.Err()
	}
	meta.Close()
	if err != nil {
		return nil, nil, marketdata.ErrUnavailable
	}
	result := make([]marketdata.Series, len(items))
	for i, item := range items {
		candles := bySymbol[item.Symbol]
		if len(candles) == 0 {
			return nil, nil, marketdata.ErrUnavailable
		}
		if len(candles) > size {
			candles = candles[len(candles)-size:]
		}
		warnings := append([]string(nil), qualities[item.Symbol].Warnings...)
		if latest[item.Symbol] != "success" {
			warnings = append(warnings, "Latest collection failed for this instrument; retained candles are not a successful refresh.")
		}
		warnings = append(warnings, "Instrument last successfully checked "+qualities[item.Symbol].CheckedAt.UTC().Format(time.RFC3339))
		if time.Since(pub.published) > 72*time.Hour {
			warnings = append(warnings, "Archive publication is older than 72 hours; data may be stale.")
		}
		warnings = append(warnings, fmt.Sprintf("Postgres archive %s revision %d; collection published %s; requested coverage %s to %s", market, pub.revision, pub.published.UTC().Format(time.RFC3339), pub.from.Format(time.RFC3339), pub.to.Format(time.RFC3339)))
		result[i] = marketdata.Series{Symbol: item.Symbol, Timezone: "UTC", Candles: candles, RequestedFrom: from.Format(time.RFC3339), RequestedTo: to.Format(time.RFC3339), QualityWarnings: warnings}
	}
	return result, qualities, nil
}
