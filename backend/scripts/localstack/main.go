// Local-only fixture/client for the actual packaged API; never an API replacement.
package main

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/account"
	studies "github.com/Lucienthewizz/signalgen-2/backend/internal/api/backtests"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/backtest"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/collection"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	platformdb "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/database"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/subscription"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const dbURL = "postgres://postgres@127.0.0.1:5432/signalgen_test?sslmode=disable"

var owners = []string{"11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"}
var ctx = context.Background()

func must(err error) {
	if err != nil {
		panic(err)
	}
}
func require(ok bool, message string) {
	if !ok {
		panic(message)
	}
}
func pool() *pgxpool.Pool { p, e := pgxpool.New(ctx, dbURL); must(e); return p }
func code(i int) string   { return fmt.Sprintf("AAA%c", 'A'+i) }
func bootstrap() {
	db := pool()
	defer db.Close()
	_, e := db.Exec(ctx, `alter role signalgen_api login; update signalgen.stock_catalog set active=false`)
	must(e)
	accounts := account.NewPostgresRepository(db)
	for i, id := range owners {
		_, e = db.Exec(ctx, `insert into auth.users(id,email) values($1,$2)`, id, fmt.Sprintf("stack-%d@test.invalid", i))
		must(e)
		_, e = accounts.EnsureProfile(ctx, id, fmt.Sprintf("stack-%d@test.invalid", i))
		must(e)
	}
	must(accounts.BootstrapOperator(ctx, "local:test", "stack-bootstrap", owners[0], "disposable local stack"))
	for _, id := range owners {
		_, e = subscription.NewPostgresRepository(db).ActivateManual(ctx, subscription.ActivateRequest{Actor: owners[0], RequestID: "stack-" + id, UserID: id, PlanCode: "pro", CurrentPeriodEnd: time.Now().Add(time.Hour), Reason: "disposable local stack fixture"})
		must(e)
	}
	for i := 0; i < 23; i++ {
		symbol := code(i) + ".JK"
		_, e = db.Exec(ctx, `insert into signalgen.stock_catalog(symbol,provider,provider_symbol,name) values($1,'yahoo_finance',$1,'Synthetic local fixture')`, symbol)
		must(e)
	}
	fmt.Println("PASS disposable DB seeded: two dummy owners, server-owned Pro subscriptions, 23 synthetic catalog rows")
}

type prices struct{}

func (prices) DailyHistory(_ context.Context, in universe.Instrument, from, to time.Time) (marketdata.History, error) {
	return syntheticHistory(in, from, to), nil
}
func syntheticHistory(in universe.Instrument, from, to time.Time) marketdata.History {
	s := marketdata.Series{Symbol: in.Symbol, Timezone: "UTC", Candles: []core.Candle{}}
	for stamp := from; stamp.Before(to); stamp = stamp.AddDate(0, 0, 1) {
		day := stamp.Sub(time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)).Hours() / 24
		close := 100 + day*0.1
		if (in.Symbol[3]-'A')%2 == 1 {
			close = 300 - day*0.1
		}
		s.Candles = append(s.Candles, core.Candle{Timestamp: stamp.Format(time.RFC3339), Open: close, High: close + 2, Low: close - 2, Close: close, Volume: 1000})
	}
	return marketdata.History{Series: s}
}
func archive() {
	from := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	catalog := collection.Catalog{SourceURL: "https://fixtures.test.invalid/synthetic", RetrievedAt: to.Format(time.RFC3339), SourceSHA256: fmt.Sprintf("%x", sha256.Sum256([]byte("local-stack-23")))}
	for i := 0; i < 23; i++ {
		catalog.Items = append(catalog.Items, collection.Instrument{Code: code(i), Name: "Synthetic", ProviderSymbol: code(i) + ".JK", ListingDate: "2000-01-01"})
	}
	root := "/scratch/store"
	_, e := collection.Sync(ctx, catalog, prices{}, collection.Options{Directory: root, From: from, To: to}, 5, nil)
	must(e)
	tarout := tar.NewWriter(os.Stdout)
	defer tarout.Close()
	must(filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		require(info.Mode().IsRegular() && info.Size() < 4<<20, "invalid fixture output")
		name, e := filepath.Rel(root, path)
		if e != nil {
			return e
		}
		b, e := os.ReadFile(path)
		if e != nil {
			return e
		}
		if e = tarout.WriteHeader(&tar.Header{Name: name, Mode: 0444, Size: int64(len(b))}); e != nil {
			return e
		}
		_, e = tarout.Write(b)
		return e
	}))
}
func token(i int) string {
	t, e := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": owners[i], "exp": time.Now().Add(time.Hour).Unix()}).SignedString([]byte("local-fixture-not-a-real-secret"))
	must(e)
	return t
}
func identity() {
	tokens := []string{token(0), token(1)}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("apikey") != "local-fixture-key" {
			w.WriteHeader(401)
			return
		}
		idx := -1
		if r.URL.Path == "/auth/v1/token" && r.Method == "POST" && r.URL.Query().Get("grant_type") == "password" {
			var b map[string]string
			if json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&b) == nil && b["password"] == "fixture-password-only" {
				for i := range owners {
					if b["email"] == fmt.Sprintf("stack-%d@test.invalid", i) {
						idx = i
					}
				}
			}
		} else if r.URL.Path == "/auth/v1/user" && r.Method == "GET" {
			for i, t := range tokens {
				if r.Header.Get("Authorization") == "Bearer "+t {
					idx = i
				}
			}
		}
		if idx < 0 {
			w.WriteHeader(401)
			return
		}
		user := map[string]any{"id": owners[idx], "email": fmt.Sprintf("stack-%d@test.invalid", idx)}
		if r.URL.Path == "/auth/v1/user" {
			must(json.NewEncoder(w).Encode(user))
			return
		}
		must(json.NewEncoder(w).Encode(map[string]any{"user": user, "access_token": tokens[idx], "refresh_token": "fixture-refresh", "token_type": "bearer", "expires_in": 3600}))
	})
	server := &http.Server{Addr: "127.0.0.1:9999", Handler: handler, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, IdleTimeout: 10 * time.Second}
	must(server.ListenAndServe())
}

type client struct {
	bearer, session string
	checks          *[]map[string]any
}

func (c client) call(method, path string, body any, status int, out any) {
	var raw []byte
	if body != nil {
		var e error
		raw, e = json.Marshal(body)
		must(e)
	}
	req, e := http.NewRequest(method, "http://127.0.0.1:8080"+path, bytes.NewReader(raw))
	must(e)
	req.Header.Set("Content-Type", "application/json")
	if c.bearer != "" {
		req.Header.Set("Authorization", "Bearer "+c.bearer)
	}
	if c.session != "" {
		req.Header.Set("X-App-Session", c.session)
	}
	res, e := (&http.Client{Timeout: 12 * time.Second}).Do(req)
	must(e)
	defer res.Body.Close()
	data, e := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	must(e)
	if res.StatusCode != status {
		var envelope struct{ Error struct{ Code string } }
		_ = json.Unmarshal(data, &envelope)
		panic(fmt.Sprintf("%s %s: got %d expected %d code=%s", method, path, res.StatusCode, status, envelope.Error.Code))
	}
	if out != nil {
		must(json.Unmarshal(data, out))
	}
	if c.checks != nil {
		entry := map[string]any{"method": method, "route": normalized(path), "status": status}
		if status >= 400 {
			var failure struct{ Error struct{ Code string } }
			must(json.Unmarshal(data, &failure))
			require(failure.Error.Code != "", "missing rejection code")
			entry["code"] = failure.Error.Code
		}
		*c.checks = append(*c.checks, entry)
	}
}
func expectCode(checks []map[string]any, expected string) {
	require(checks[len(checks)-1]["code"] == expected, "unexpected policy rejection code")
}
func normalized(path string) string {
	parts := strings.Split(path, "/")
	for i, p := range parts {
		if strings.HasPrefix(p, "rule_") || strings.HasPrefix(p, "univ_") || strings.HasPrefix(p, "dataset_") || len(p) == 32 {
			parts[i] = "{id}"
		}
	}
	return strings.Join(parts, "/")
}
func login(i int, checks *[]map[string]any) client {
	c := client{checks: checks}
	var auth struct {
		AccessToken string `json:"access_token"`
	}
	c.call("POST", "/api/auth/login", map[string]string{"email": fmt.Sprintf("stack-%d@test.invalid", i), "password": "fixture-password-only"}, 200, &auth)
	require(auth.AccessToken != "", "login bearer missing")
	c.bearer = auth.AccessToken
	var created session.Created
	c.call("POST", "/api/v1/sessions", map[string]string{"installation_id": fmt.Sprintf("local-stack-%d", i), "label": "Synthetic stack"}, 201, &created)
	c.session = created.Token
	require(c.session != "", "session missing")
	return c
}
func verify() {
	checks := []map[string]any{}
	anon := client{checks: &checks}
	anon.call("GET", "/health", nil, 200, nil)
	anon.call("GET", "/ready", nil, 200, nil)
	a := login(0, &checks)
	b := login(1, &checks)
	anon.call("GET", "/api/v1/account/me", nil, 401, nil)
	mismatch := client{bearer: b.bearer, session: a.session, checks: &checks}
	mismatch.call("GET", "/api/v1/account/me", nil, 403, nil)
	expectCode(checks, "SESSION_REVOKED")
	var rule rules.Rule
	definition := core.RuleSnapshot{Name: "Synthetic rising EMA", Logic: "AND", SignalType: "BUY", CooldownSec: 0, Conditions: []core.Condition{{Left: "EMA9", Op: ">", Right: "EMA20"}}}
	a.call("POST", "/api/v1/rules", map[string]any{"definition": definition}, 201, &rule)
	require(rule.DefinitionHash != "", "rule hash missing")
	b.call("GET", "/api/v1/rules/"+rule.ID, nil, 404, nil)
	var group universe.Universe
	a.call("POST", "/api/v1/stock-universes", map[string]any{"name": "Synthetic universe", "symbols": []string{"AAAA.JK", "AAAB.JK"}}, 201, &group)
	b.call("GET", "/api/v1/stock-universes/"+group.ID, nil, 404, nil)
	db := pool()
	defer db.Close()
	runtime, e := pgxpool.New(ctx, "postgres://signalgen_api@127.0.0.1:5432/signalgen_test?sslmode=disable")
	must(e)
	defer runtime.Close()
	must((platformdb.RuntimePrivileges{Pool: runtime}).Ready(ctx))
	report := map[string]any{"real": []string{"packaged cmd/api", "HTTP router/auth bridge", "Postgres repositories", "app sessions", "private scoring", "grants", "study contexts", "read-only published idx_store"}, "fixtures": []string{"local identity HTTP provider", "23 synthetic daily market histories", "server-owned test subscriptions"}, "runtime_role": "signalgen_api", "browser": "needs-validation: no cached isolated browser runtime with required controls", "client_computation": "native portable core, not browser/WASM", "checks": &checks}
	found, unmatched, total := 0, 0, 0
	examples := []core.BacktestEntry{}
	var lastGrant compute.Grant
	var lastManifest dataset.Manifest
	for _, kind := range []string{"screen", "backtest"} {
		base := "/api/v1/screener/scans"
		signalPath := "/api/v1/screener/signals"
		steps := 1
		if kind == "backtest" {
			base = "/api/v1/backtests/studies"
			signalPath = "/api/v1/backtests/signals"
			steps = 3
		}
		input := studies.StudyInput{Source: "market", Market: "IDX", RuleID: rule.ID, Config: core.SignalStudyConfig{From: "2026-01-20", To: "2026-01-23", NSteps: steps}}
		var study studies.StudyContext
		a.call("POST", base, input, 201, &study)
		require(study.Total == 23 && study.Batches == 3 && study.DefinitionHash == rule.DefinitionHash && study.Source == "market" && study.Config == input.Config, "frozen context mismatch")
		a.call("POST", base, input, 429, nil)
		b.call("POST", base+"/"+study.ID+"/batches/0/prepare", map[string]any{}, 404, nil)
		for batch := 0; batch < study.Batches; batch++ {
			path := fmt.Sprintf("%s/%s/batches/%d/prepare", base, study.ID, batch)
			var prepared studies.StudyBatch
			a.call("POST", path, map[string]any{}, 200, &prepared)
			require(len(prepared.Failures) == 0 && len(prepared.Manifests) == len(prepared.Stocks), "unexpected partial fixture batch")
			if batch == 0 {
				a.call("POST", base+"/"+study.ID+"/batches/1/prepare", map[string]any{}, 409, nil)
			}
			for _, m := range prepared.Manifests {
				require(m.Provider != "" && m.Backtest != nil && m.Backtest.StudyID == study.ID && m.Backtest.DefinitionHash == rule.DefinitionHash && m.Backtest.From == input.Config.From && m.Backtest.To == input.Config.To && m.Purpose == kind, "manifest binding mismatch")
				var payload struct {
					Series []core.BacktestSeries `json:"series"`
				}
				a.call("GET", "/api/v1/datasets/"+m.DatasetID+"/content", nil, 200, &payload)
				b.call("GET", "/api/v1/datasets/"+m.DatasetID+"/content", nil, 404, nil)
				grantInput := map[string]string{"purpose": kind, "dataset_id": m.DatasetID, "dataset_version": m.Version, "dataset_checksum": m.Checksum, "rule_id": rule.ID, "definition_hash": rule.DefinitionHash, "engine_version": core.EngineVersion, "schema_version": core.SchemaVersion}
				var grant compute.Grant
				a.call("POST", "/api/v1/compute-grants", grantInput, 201, &grant)
				require(grant.DatasetID == m.DatasetID && grant.DatasetChecksum == m.Checksum && grant.DefinitionHash == rule.DefinitionHash && grant.Purpose == kind, "grant binding mismatch")
				features, e := core.ComputeBacktestFeatures(core.FeatureRequest{Purpose: "backtest", Symbol: m.Symbols[0], Candles: payload.Series[0].Candles, Operands: m.RequiredOperands})
				must(e)
				request := backtest.SignalInput{ComputeGrantID: grant.ID, FeatureSchemaVersion: core.FeatureSchemaVersion, PolicyVersion: core.SignalStudyPolicy, Candidates: features.Candidates}
				var result backtest.SignalResult
				a.call("POST", signalPath, request, 200, &result)
				if kind == "screen" {
					total++
					if len(result.Entries) > 0 {
						found++
						examples = append(examples, result.Entries[0])
					} else {
						unmatched++
					}
				}
				if kind == "backtest" && len(result.Entries) > 0 {
					out, e := core.RunSignalStudy(core.SignalStudyRequest{SchemaVersion: core.SignalStudySchema, Config: input.Config, Series: payload.Series, Entries: result.Entries})
					must(e)
					require(len(out.Events) == len(result.Entries), "native outcome handoff failed")
				}
				if batch == 0 && m.DatasetID == prepared.Manifests[0].DatasetID {
					b.call("POST", signalPath, request, 403, nil)
					short := request
					short.Candidates = short.Candidates[:len(short.Candidates)-1]
					a.call("POST", signalPath, short, 422, nil)
				}
				lastGrant = grant
				lastManifest = m
			}
			a.call("DELETE", path, nil, 204, nil)
			a.call("GET", "/api/v1/datasets/"+lastManifest.DatasetID+"/content", nil, 404, nil)
		}
		a.call("DELETE", base+"/"+study.ID, nil, 204, nil)
		a.call("POST", base+"/"+study.ID+"/batches/0/prepare", map[string]any{}, 404, nil)
		var retry studies.StudyContext
		a.call("POST", base, input, 201, &retry)
		a.call("DELETE", base+"/"+retry.ID, nil, 204, nil)
	}
	require(total == 23 && found == 12 && unmatched == 11, "fixture match/unmatched results changed")
	frozenInput := studies.StudyInput{Source: "market", Market: "IDX", RuleID: rule.ID, Config: core.SignalStudyConfig{From: "2026-01-20", To: "2026-01-23", NSteps: 1}}
	var frozen studies.StudyContext
	a.call("POST", "/api/v1/screener/scans", frozenInput, 201, &frozen)
	definition.Conditions[0].Op = "<"
	a.call("PATCH", "/api/v1/rules/"+rule.ID, map[string]any{"version": 1, "definition": definition}, 200, nil)
	a.call("POST", "/api/v1/screener/scans/"+frozen.ID+"/batches/0/prepare", map[string]any{}, 409, nil)
	expectCode(checks, "VERSION_MISMATCH")
	a.call("DELETE", "/api/v1/screener/scans/"+frozen.ID, nil, 204, nil)

	_, e = db.Exec(ctx, `update signalgen.compute_grants set expires_at=now()-interval '1 second' where id=$1`, lastGrant.ID)
	must(e)
	// Expired-grant rejection occurs before the already released dataset lookup.
	a.call("POST", "/api/v1/backtests/signals", backtest.SignalInput{ComputeGrantID: lastGrant.ID, FeatureSchemaVersion: core.FeatureSchemaVersion, PolicyVersion: core.SignalStudyPolicy, Candidates: []core.FeatureCandidate{{Symbol: "AAAA.JK"}}}, 403, nil)
	expectCode(checks, "GRANT_EXPIRED")
	var persisted int
	must(db.QueryRow(ctx, `select count(*) from signalgen.compute_grants where user_id=$1`, owners[0]).Scan(&persisted))
	require(persisted == 46, "real grant rows not persisted")
	_, e = db.Exec(ctx, `update signalgen.app_sessions set expires_at=now()-interval '1 second' where user_id=$1`, owners[0])
	must(e)
	a.call("GET", "/api/v1/account/me", nil, 403, nil)
	expectCode(checks, "SESSION_EXPIRED")
	report["screening"] = map[string]any{"stocks": total, "batches": 3, "matched_symbols": found, "unmatched_symbols": unmatched, "examples": examples, "from": "2026-01-20", "to": "2026-01-23", "rule_hash": rule.DefinitionHash, "provider": lastManifest.Provider}
	report["persisted_grants"] = persisted
	report["backtest_native_outcomes"] = "passed for all matching stocks"
	report["recovery"] = "active-context 429, batch409, release/cancel/recreate and stale-handle404"
	report["result"] = "pass"
	must(json.NewEncoder(os.Stdout).Encode(report))
}
func runAPI() {
	deadline, cancel := context.WithTimeout(ctx, 240*time.Second)
	defer cancel()
	cmd := exec.CommandContext(deadline, "/usr/local/bin/signalgen-api")
	cmd.Env = []string{"PATH=/usr/local/bin", "HOME=/scratch/home", "TMPDIR=/scratch/tmp", "SUPABASE_URL=http://127.0.0.1:9999", "SUPABASE_PUBLISHABLE_KEY=local-fixture-key", "SUPABASE_DB_URL=postgres://signalgen_api@127.0.0.1:5432/signalgen_test?sslmode=disable", "SIGNALGEN_GO_API_ADDR=127.0.0.1:8080", "SIGNALGEN_MARKET_DATA_MODE=idx_store", "SIGNALGEN_IDX_HISTORY_DIR=/store"}
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	must(cmd.Run())
}
func main() {
	time.AfterFunc(240*time.Second, func() { os.Exit(124) })
	require(len(os.Args) == 2, "use bootstrap/archive/identity/verify")
	switch os.Args[1] {
	case "ready":
		client{}.call("GET", "/ready", nil, 200, nil)
	case "api":
		runAPI()
	case "bootstrap":
		bootstrap()
	case "archive":
		archive()
	case "identity":
		identity()
	case "verify":
		verify()
	default:
		panic("unknown fixture mode")
	}
}
