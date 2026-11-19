// Command syncmarket performs one bounded collection, then exits. GitHub
// Actions owns scheduling; the API never receives the writer credential.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/collection"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketarchive"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "syncmarket:", err)
		os.Exit(1)
	}
}

func run() error {
	market := flag.String("market", "both", "IDX, US or both")
	scope := flag.String("scope", "smoke", "smoke or production")
	event := flag.String("event", "manual", "manual or schedule")
	external := flag.String("external-id", "", "stable workflow run identifier")
	arm := flag.Bool("arm-smoke", false, "arm a new one-hour scheduler test")
	smokeID := flag.String("smoke-id", "", "armed smoke-test UUID")
	ref := flag.String("deployment-ref", "", "pinned full deployment SHA")
	statusOnly := flag.Bool("smoke-status", false, "read scheduler-test state without fetching data")
	checkOnly := flag.Bool("check", false, "check restricted writer connection and database capacity")
	bootstrap := flag.String("bootstrap-idx-dir", "", "optional validated, read-only local IDX store")
	reportPath := flag.String("report", "", "write JSON evidence to this file")
	pace := flag.Duration("pace", time.Second, "minimum Yahoo request spacing")
	deadline := flag.Duration("deadline", 270*time.Minute, "maximum run duration")
	flag.Parse()
	if *scope != "production" && *scope != "smoke" || *market != "IDX" && *market != "US" && *market != "both" || *event != "manual" && *event != "schedule" {
		return fmt.Errorf("invalid scope, market or trigger")
	}
	if *scope == "smoke" && *market != "both" {
		return fmt.Errorf("scheduler smoke test requires both markets")
	}
	root, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(root, *deadline)
	defer cancel()
	raw := os.Getenv("SIGNALGEN_MARKET_WRITER_URL")
	if raw == "" {
		return fmt.Errorf("SIGNALGEN_MARKET_WRITER_URL is required")
	}
	config, err := pgxpool.ParseConfig(raw)
	if err != nil {
		return fmt.Errorf("invalid market-writer configuration")
	}
	config.MaxConns = 4
	if config.ConnConfig.Port == 6543 {
		return fmt.Errorf("collector locks require a direct or session-pooler connection, not port 6543")
	}
	config.MinConns = 0
	config.ConnConfig.ConnectTimeout = 10 * time.Second
	db, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return fmt.Errorf("cannot initialize market-writer connection")
	}
	defer db.Close()
	if err = writerReady(ctx, db); err != nil {
		return err
	}
	store := &marketarchive.Store{DB: db}
	if *checkOnly {
		size, err := store.DatabaseBytes(ctx)
		if err != nil {
			return fmt.Errorf("database size check failed")
		}
		return output(*reportPath, map[string]any{"writer_ready": true, "database_bytes": size})
	}
	if *arm {
		state, err := store.ArmSmoke(ctx, *ref)
		if err != nil {
			return fmt.Errorf("cannot arm scheduler test")
		}
		return output(*reportPath, state)
	}
	if *statusOnly {
		state, err := store.SmokeStatus(ctx, *smokeID)
		if err != nil {
			return fmt.Errorf("cannot read scheduler-test state")
		}
		return output(*reportPath, state)
	}
	if *external == "" {
		return fmt.Errorf("external-id is required")
	}
	live, err := historySource(os.Getenv("YAHOO_FINANCE_BASE_URL"))
	if err != nil {
		return err
	}
	var smoke marketarchive.Smoke
	if *scope == "smoke" {
		var unlock func()
		ctx, unlock, err = store.Lock(ctx, "smoke", "all")
		if err != nil {
			return err
		}
		defer unlock()
		var execute bool
		smoke, execute, err = store.BeginSmokeEvent(ctx, *smokeID, *ref, *external, *event)
		if errors.Is(err, marketarchive.ErrSmokeClosed) {
			return output(*reportPath, smoke)
		}
		if err != nil {
			return fmt.Errorf("scheduler test cannot start: context or state invalid")
		}
		if !execute {
			return output(*reportPath, smoke)
		}
		// A late GitHub start cannot extend the one-hour test window.
		var finish context.CancelFunc
		ctx, finish = context.WithDeadline(ctx, smoke.Expires)
		defer finish()
	}
	runner := marketarchive.Runner{Store: store, Source: live}
	options := marketarchive.Options{Scope: *scope, ExternalID: *external, Trigger: *event, Delay: *pace, Now: time.Now().UTC()}
	if *bootstrap != "" {
		local, err := collection.NewStoreProvider(*bootstrap)
		if err != nil {
			return fmt.Errorf("local bootstrap metadata is invalid")
		}
		_, view, err := local.Snapshot(ctx)
		if err != nil {
			return fmt.Errorf("local bootstrap publication is unavailable")
		}
		options.Bootstrap = view.(marketarchive.HistorySource)
	}
	options.Progress = func(run marketarchive.Run, symbol, status string) {
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"run_id": run.ID, "market": run.Market, "symbol": symbol, "status": status})
	}
	markets := []string{*market}
	if *market == "both" {
		markets = []string{"IDX", "US"}
	}
	runs := []marketarchive.Run{}
	success := true
	for _, m := range markets {
		options.Market = m
		run, err := runner.Collect(ctx, options)
		runs = append(runs, run)
		if err != nil || run.Status != "published" {
			success = false
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "market", m, "collection did not complete:", safeError(err))
		}
		if ctx.Err() != nil {
			break
		}
	}
	result := map[string]any{"runs": runs, "success": success, "scope": *scope, "trigger": *event, "external_id": *external, "finished_at": time.Now().UTC()}
	if *scope == "smoke" {
		cleanup, done := context.WithTimeout(context.Background(), 15*time.Second)
		defer done()
		state, err := store.FinishSmokeEvent(cleanup, *smokeID, *external, runs, success)
		if err != nil {
			return fmt.Errorf("cannot finalize scheduler-test evidence")
		}
		result["smoke"] = state
		result["disable_workflow"] = state.Disable
	}
	if err = output(*reportPath, result); err != nil {
		return err
	}
	if !success {
		return fmt.Errorf("collection is partial or failed; inspect coverage report")
	}
	return nil
}

func historySource(baseURL string) (*marketdata.YahooFinance, error) {
	if baseURL == "" {
		baseURL = "https://query1.finance.yahoo.com"
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil, fmt.Errorf("Yahoo base URL must be an HTTP(S) origin without credentials, query or fragment")
	}
	source, err := marketdata.NewYahooFinance(baseURL, nil)
	if err != nil {
		return nil, err
	}
	return source.WithoutRetry(), nil
}

func writerReady(ctx context.Context, db *pgxpool.Pool) error {
	var safe bool
	err := db.QueryRow(ctx, `select current_user='signalgen_market_writer' and not r.rolsuper and not r.rolbypassrls and not r.rolcreaterole and not r.rolcreatedb
and not exists(select 1 from pg_auth_members where member=r.oid)
and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and
(n.nspname in ('auth','signalgen_private') or (n.nspname='signalgen' and c.relname<>'stock_catalog' and c.relname not like 'market\_%'))
and has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE'))
from pg_roles r where r.rolname=current_user`).Scan(&safe)
	if err != nil || !safe {
		return fmt.Errorf("market-writer role or private-data isolation is invalid")
	}
	return nil
}

func safeError(err error) string {
	if errors.Is(err, marketarchive.ErrCapacity) || errors.Is(err, marketarchive.ErrBusy) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err.Error()
	}
	return "database/provider operation failed; inspect non-secret coverage status"
}
func output(path string, value any) error {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if path != "" {
		if err = os.WriteFile(path, append(raw, '\n'), 0600); err != nil {
			return fmt.Errorf("cannot write evidence file")
		}
	}
	fmt.Println(string(raw))
	return nil
}
