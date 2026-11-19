package marketarchive

import (
	"context"
	"errors"
	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"testing"
	"time"
)

// This opt-in suite requires the disposable signalgen_test database already
// initialized by schematest. Never point it at Supabase or a development DB.
func TestPostgresArchiveRevisionRLSAndSmoke(t *testing.T) {
	raw := os.Getenv("SIGNALGEN_ARCHIVE_TEST_PG_URL")
	if raw == "" {
		t.Skip("isolated PostgreSQL archive URL not configured")
	}
	config, err := pgxpool.ParseConfig(raw)
	if err != nil {
		t.Fatal(err)
	}
	if config.ConnConfig.Host != "127.0.0.1" || config.ConnConfig.Database != "signalgen_test" {
		t.Fatal("requires loopback signalgen_test")
	}
	ctx := context.Background()
	admin, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	if _, err = admin.Exec(ctx, `truncate signalgen.market_smoke_events,signalgen.market_smoke_tests,signalgen.market_publications,signalgen.market_sync_items,signalgen.market_candles,signalgen.market_sync_runs restart identity`); err != nil {
		t.Fatal(err)
	}
	if _, err = admin.Exec(ctx, `alter role signalgen_market_writer login;alter role signalgen_api login`); err != nil {
		t.Fatal(err)
	}
	writerConfig := config.Copy()
	writerConfig.ConnConfig.User = "signalgen_market_writer"
	writerConfig.MaxConns = 4
	writer, err := pgxpool.NewWithConfig(ctx, writerConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()
	apiConfig := config.Copy()
	apiConfig.ConnConfig.User = "signalgen_api"
	api, err := pgxpool.NewWithConfig(ctx, apiConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer api.Close()
	store := &Store{DB: writer}
	items := []universe.Instrument{{Symbol: "BBCA.JK", ProviderSymbol: "BBCA.JK", Exchange: "XIDX", Currency: "IDR"}}
	_, err = admin.Exec(ctx, `insert into signalgen.stock_catalog(symbol,provider,provider_symbol,name,exchange,currency,active) values('BBCA.JK','yahoo_finance','BBCA.JK','Fixture','XIDX','IDR',true) on conflict(symbol) do nothing`)
	if err != nil {
		t.Fatal(err)
	}
	from := time.Date(2026, 8, 20, 0, 0, 0, 0, time.UTC)
	to := from.AddDate(0, 3, 0)
	history := marketdata.History{Series: marketdata.Series{Symbol: "BBCA.JK", Timezone: "UTC", QualityWarnings: []string{"fixture"}}}
	for i := 0; i < 25; i++ {
		history.Series.Candles = append(history.Series.Candles, core.Candle{Timestamp: from.AddDate(0, 0, i).Format(time.RFC3339), Open: 100, High: 110, Low: 90, Close: 105, Volume: 1000})
	}
	publish := func(id string, h marketdata.History) Run {
		t.Helper()
		run, e := store.Begin(ctx, "production", "IDX", id, "fixture", from, to, items)
		if e != nil {
			t.Fatal(e)
		}
		if e = store.Stage(ctx, run, items[0], h, 1, nil); e != nil {
			t.Fatal(e)
		}
		run, e = store.Publish(ctx, run)
		if e != nil {
			t.Fatal(e)
		}
		return run
	}
	first := publish("archive-fixture-1", history)
	if first.Inserted != 25 || first.Changed != 0 {
		t.Fatalf("first %+v", first)
	}
	live, _ := marketdata.NewYahooFinance("https://query1.finance.yahoo.com", nil)
	provider, _ := NewProvider(api, live)
	if err = provider.Ready(ctx); err != nil {
		t.Fatal(err)
	}
	_, pinned, err := provider.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	second := publish("archive-fixture-2", history)
	if second.Inserted != 0 || second.Changed != 0 || second.Unchanged != 25 {
		t.Fatalf("unchanged %+v", second)
	}
	history.Series.Candles[24].Close = 106
	third := publish("archive-fixture-3", history)
	if third.Inserted != 0 || third.Changed != 1 || third.Unchanged != 24 {
		t.Fatalf("changed %+v", third)
	}
	old, err := pinned.Daily(ctx, items, 100)
	if err != nil || old[0].Candles[24].Close != 105 {
		t.Fatalf("pinned old revision %v", err)
	}
	current, err := provider.Daily(ctx, items, 100)
	if err != nil || current[0].Candles[24].Close != 106 {
		t.Fatalf("current %v", err)
	}
	if _, err = store.Begin(ctx, "production", "IDX", "archive-fixture-3", "fixture", from.AddDate(0, 0, 1), to, items); err == nil {
		t.Fatal("mutable frozen context accepted")
	}
	_, unlock, err := store.Lock(ctx, "production", "IDX")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = store.Lock(ctx, "production", "IDX"); !errors.Is(err, ErrBusy) {
		t.Fatal("overlapping market lock", err)
	}
	unlock()
	if _, err = api.Exec(ctx, `delete from signalgen.market_candles`); err == nil {
		t.Fatal("API wrote shared candles")
	}
	var privateCount int
	if err = writer.QueryRow(ctx, `select count(*) from signalgen.account_profiles`).Scan(&privateCount); err == nil {
		t.Fatal("writer read personal profiles")
	}
	smoke, err := store.Begin(ctx, "smoke", "IDX", "smoke-fixture", "fixture", from, to, items)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Stage(ctx, smoke, items[0], history, 1, nil); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Publish(ctx, smoke); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = api.QueryRow(ctx, `select count(*) from signalgen.market_candles where scope='smoke'`).Scan(&count); err != nil || count != 0 {
		t.Fatal("API sees smoke rows", count, err)
	}
	if err = store.Prune(ctx, "production"); err != nil {
		t.Fatal(err)
	}
	if err = writer.QueryRow(ctx, `select count(*) from signalgen.market_candles where scope='production'`).Scan(&count); err != nil || count != 26 {
		t.Fatal("72h retention failed", count, err)
	}
	if _, err = admin.Exec(ctx, `update signalgen.market_sync_runs set finished_at=clock_timestamp()-interval '73 hours' where id=$1`, third.ID); err != nil {
		t.Fatal(err)
	}
	if err = store.Prune(ctx, "production"); err != nil {
		t.Fatal(err)
	}
	if err = writer.QueryRow(ctx, `select count(*) from signalgen.market_candles where scope='production'`).Scan(&count); err != nil || count != 25 {
		t.Fatal("retired version not pruned", count, err)
	}
	armed, err := store.ArmSmoke(ctx, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	if err != nil {
		t.Fatal(err)
	}
	_, execute, err := store.BeginSmokeEvent(ctx, armed.ID, armed.DeploymentRef, "manual-1", "manual")
	if err != nil || !execute {
		t.Fatal(err)
	}
	state, err := store.FinishSmokeEvent(ctx, armed.ID, "manual-1", nil, false)
	if err != nil || state.Attempts != 0 || state.Successes != 0 {
		t.Fatal("manual counted", state, err)
	}
	_, execute, err = store.BeginSmokeEvent(ctx, armed.ID, armed.DeploymentRef, "automatic-1", "schedule")
	if err != nil || !execute {
		t.Fatal(err)
	}
	_, execute, err = store.BeginSmokeEvent(ctx, armed.ID, armed.DeploymentRef, "automatic-1", "schedule")
	if err != nil || execute {
		t.Fatal("event duplicated", err)
	}
	state, err = store.FinishSmokeEvent(ctx, armed.ID, "automatic-1", nil, false)
	if err != nil || state.Attempts != 1 || state.Successes != 0 {
		t.Fatal("schedule evidence", state, err)
	}
}
