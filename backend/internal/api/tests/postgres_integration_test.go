package apitests

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/account"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	screenerapi "github.com/Lucienthewizz/signalgen-2/backend/internal/api/screener"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/dataset"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/marketdata"
	platformdb "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/database"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/subscription"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/jackc/pgx/v5/pgxpool"
)

// An opt-in API contract check backed by an isolated loopback Postgres.
// It does not use Supabase credentials or mutate the connected cloud project.
func TestPostgresAPIContractsAndOwnership(t *testing.T) {
	databaseURL := os.Getenv("SIGNALGEN_TEST_PG_URL")
	if databaseURL == "" {
		t.Skip("set SIGNALGEN_TEST_PG_URL for isolated local Postgres test")
	}
	parsed, err := url.Parse(databaseURL)
	if err != nil || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") || parsed.Path != "/signalgen_test" {
		t.Fatal("integration database must be signalgen_test on loopback")
	}
	// Check the effective configuration too: query parameters can override
	// the visible URL host/database, and this test truncates its fixtures.
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil || (config.ConnConfig.Host != "127.0.0.1" && config.ConnConfig.Host != "localhost") || config.ConnConfig.Database != "signalgen_test" || len(config.ConnConfig.Fallbacks) != 0 {
		t.Fatal("integration database configuration must resolve only to signalgen_test on loopback")
	}
	timeout := 20 * time.Second
	if os.Getenv("SIGNALGEN_RUN_WASM_INTEGRATION") == "1" {
		timeout = 120 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	db, err := platformdb.OpenPostgres(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(ctx, `truncate auth.users cascade`); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		if _, err := db.Exec(cleanupCtx, `truncate auth.users cascade`); err != nil {
			t.Errorf("cleanup local integration fixtures: %v", err)
		}
	}()
	var userA, userB string
	if err := db.QueryRow(ctx, `insert into auth.users (email) values ('api-a@test.invalid') returning id::text`).Scan(&userA); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `insert into auth.users (email) values ('api-b@test.invalid') returning id::text`).Scan(&userB); err != nil {
		t.Fatal(err)
	}
	accounts := account.NewPostgresRepository(db)
	for _, id := range []string{userA, userB} {
		if _, err := accounts.EnsureProfile(ctx, id, id+"@test.invalid"); err != nil {
			t.Fatal(err)
		}
	}
	if err := accounts.BootstrapOperator(ctx, "local:test", "api-bootstrap", userA, "test"); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{userA, userB} {
		if _, err := accounts.GrantFeatureAudited(ctx, userA, "api-grant", id,
			access.FeatureScreener, time.Now().Add(time.Hour), "test"); err != nil {
			t.Fatal(err)
		}
	}
	sessions, err := session.NewPostgresRepository(db, 1, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	subscriptions := subscription.NewPostgresRepository(db)
	universes := universe.NewPostgresRepository(db)
	fixtureBytes, err := os.ReadFile("../../../core/testdata/default_scalping_v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Request struct {
			Candles []core.Candle `json:"candles"`
		} `json:"request"`
	}
	if err := json.Unmarshal(fixtureBytes, &fixture); err != nil {
		t.Fatal(err)
	}
	upstream := &integrationMarketProvider{candles: fixture.Request.Candles}
	cachedProvider, err := marketdata.NewCachedProvider(upstream, marketdata.DefaultCacheOptions())
	if err != nil {
		t.Fatal(err)
	}
	datasets, err := dataset.NewDynamicStore(cachedProvider, universes)
	if err != nil {
		t.Fatal(err)
	}
	newServer := func(id string) *api.Server {
		server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: id, Email: id + "@test.invalid"}},
			sessions, accounts, datasets, compute.NewPostgresRepository(db),
			api.WithRuleStore(rules.NewPostgresRepository(db)),
			api.WithProfileStore(accounts),
			api.WithSubscriptionService(subscriptions),
			api.WithUniverseStore(universes))
		if err != nil {
			t.Fatal(err)
		}
		return server
	}
	serverA, serverB := newServer(userA), newServer(userB)
	call := func(server *api.Server, method, path, body, appToken string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		request.Header.Set("Authorization", "Bearer test-identity")
		if appToken != "" {
			request.Header.Set("X-App-Session", appToken)
		}
		response := httptest.NewRecorder()
		server.ServeHTTP(response, request)
		return response
	}
	createSession := func(server *api.Server, installation string) string {
		body, _ := json.Marshal(map[string]string{"installation_id": installation, "label": installation})
		response := call(server, http.MethodPost, "/api/v1/sessions", string(body), "")
		if response.Code != http.StatusCreated {
			t.Fatalf("create session = %d: %s", response.Code, response.Body.String())
		}
		var created session.Created
		if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
			t.Fatal(err)
		}
		return created.Token
	}
	tokenA := createSession(serverA, "browser-a")
	tokenB := createSession(serverB, "browser-b")
	// Editable profile must persist, remain private and reject stale writers.
	profileUpdate := call(serverA, "PATCH", "/api/v1/account/profile", `{"display_name":"Lucien","bio":"Belajar saham","version":1}`, tokenA)
	if profileUpdate.Code != http.StatusOK {
		t.Fatalf("update profile: %d %s", profileUpdate.Code, profileUpdate.Body.String())
	}
	for _, entry := range []struct {
		server             *api.Server
		token, owner, name string
		version            int64
	}{
		{newServer(userA), tokenA, userA, "Lucien", 2}, {serverB, tokenB, userB, "", 1},
	} {
		response := call(entry.server, "GET", "/api/v1/account/profile", "", entry.token)
		var profile account.Profile
		if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &profile) != nil || profile.UserID != entry.owner || profile.DisplayName != entry.name || profile.Version != entry.version {
			t.Fatalf("private profile: %d %s", response.Code, response.Body.String())
		}
	}
	if response := call(serverA, "PATCH", "/api/v1/account/profile", `{"bio":"stale","version":1}`, tokenA); response.Code != http.StatusConflict {
		t.Fatalf("stale profile: %d", response.Code)
	}
	if response := call(serverB, "PATCH", "/api/v1/account/profile", `{"role":"operator","bio":"hack","version":1}`, tokenB); response.Code != http.StatusBadRequest {
		t.Fatalf("profile privilege injection: %d", response.Code)
	}
	if _, err := accounts.EnsureProfile(ctx, userA, "refreshed@test.invalid"); err != nil {
		t.Fatal(err)
	}
	if profile, err := accounts.Profile(ctx, userA); err != nil || profile.DisplayName != "Lucien" || profile.Version != 2 {
		t.Fatalf("auth sync reset editable profile: %+v %v", profile, err)
	}
	clear := ""
	if profile, err := accounts.UpdateProfile(ctx, userA, account.UpdateProfileInput{Bio: &clear, Version: 2}); err != nil || profile.Bio != "" || profile.DisplayName != "Lucien" || profile.Version != 3 {
		t.Fatalf("partial profile update: %+v %v", profile, err)
	}
	var profileWriters sync.WaitGroup
	var profileWins atomic.Int32
	for index := 0; index < 8; index++ {
		profileWriters.Add(1)
		go func() {
			defer profileWriters.Done()
			bio := "Concurrent update"
			_, err := accounts.UpdateProfile(ctx, userA, account.UpdateProfileInput{Bio: &bio, Version: 3})
			if err == nil {
				profileWins.Add(1)
			} else if err != account.ErrProfileConflict {
				t.Errorf("profile CAS: %v", err)
			}
		}()
	}
	profileWriters.Wait()
	if profileWins.Load() != 1 {
		t.Fatalf("profile CAS winners=%d", profileWins.Load())
	}
	if _, err := sessions.Verify(ctx, userB, tokenA); err != session.ErrInvalid {
		t.Fatalf("cross-owner app session verified: %v", err)
	}
	if _, err := accounts.RequireOperator(ctx, userB); err != access.ErrRoleRequired {
		t.Fatalf("ordinary user gained operator role: %v", err)
	}
	// The real repository CAS consumes an old app token once, even when requests
	// come from multiple goroutines/replicas. Rotation never extends expiry.
	before, err := sessions.Verify(ctx, userA, tokenA)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := sessions.Rotate(ctx, userB, before.ID, tokenA); err != session.ErrInvalid {
		t.Fatal("cross-owner rotation allowed")
	}
	wrongOwner := call(serverB, "POST", "/api/v1/sessions/"+before.ID+"/refresh", "{}", tokenB)
	assertErrorCode(t, wrongOwner, 404, "RESOURCE_NOT_FOUND")
	var wait sync.WaitGroup
	winners := make(chan session.Created, 16)
	failures := make(chan error, 16)
	for i := 0; i < 16; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			created, err := sessions.Rotate(ctx, userA, before.ID, tokenA)
			if err == nil {
				winners <- created
			} else {
				failures <- err
			}
		}()
	}
	wait.Wait()
	close(winners)
	close(failures)
	if len(winners) != 1 {
		t.Fatalf("rotation winners=%d, wanted exactly one", len(winners))
	}
	winner := <-winners
	for failure := range failures {
		if failure != session.ErrInvalid {
			t.Fatal(failure)
		}
	}
	if winner.Session.ID != before.ID || !winner.Session.ExpiresAt.Equal(before.ExpiresAt) || winner.Token == tokenA {
		t.Fatal("rotation changed session identity/expiry")
	}
	if _, err := sessions.Verify(ctx, userA, tokenA); err != session.ErrInvalid {
		t.Fatal("old token remained valid")
	}
	tokenA = winner.Token
	rotatedResponse := call(serverA, "POST", "/api/v1/sessions/"+before.ID+"/refresh", "{}", tokenA)
	if rotatedResponse.Code != 200 {
		t.Fatalf("rotation API status=%d", rotatedResponse.Code)
	}
	var rotated session.Created
	if json.Unmarshal(rotatedResponse.Body.Bytes(), &rotated) != nil || !rotated.Session.ExpiresAt.Equal(before.ExpiresAt) {
		t.Fatal("invalid rotation contract")
	}
	tokenA = rotated.Token
	var storedHash []byte
	if err := db.QueryRow(ctx, `select token_hash from signalgen.app_sessions where user_id=$1::uuid and id=$2`, userA, before.ID).Scan(&storedHash); err != nil {
		t.Fatal(err)
	}
	expectedHash := sha256.Sum256([]byte(tokenA))
	if !bytes.Equal(storedHash, expectedHash[:]) {
		t.Fatal("rotation did not persist only the replacement hash")
	}
	t.Log("Postgres session rotation verified: 16 contenders, 1 winner, unchanged expiry")
	response := call(serverA, http.MethodPost, "/api/v1/rules",
		`{"definition":{"name":"My EMA rule","logic":"AND","signal_type":"BUY","cooldown_sec":60,"conditions":[{"left":"EMA9","op":">","right":"EMA20"}]}}`, tokenA)
	if response.Code != http.StatusCreated {
		t.Fatalf("create rule = %d: %s", response.Code, response.Body.String())
	}
	var createdRule rules.Rule
	if err := json.Unmarshal(response.Body.Bytes(), &createdRule); err != nil {
		t.Fatal(err)
	}
	response = call(serverB, http.MethodGet, "/api/v1/rules/"+createdRule.ID, "", tokenB)
	assertErrorCode(t, response, http.StatusNotFound, "RESOURCE_NOT_FOUND")
	response = call(serverB, http.MethodDelete, "/api/v1/rules/"+createdRule.ID,
		`{"version":1}`, tokenB)
	assertErrorCode(t, response, http.StatusNotFound, "RESOURCE_NOT_FOUND")
	response = call(serverA, http.MethodGet, "/api/v1/rules/"+createdRule.ID, "", tokenA)
	if response.Code != http.StatusOK {
		t.Fatalf("owner read rule = %d: %s", response.Code, response.Body.String())
	}
	response = call(serverA, http.MethodPost, "/api/v1/stock-universes",
		`{"name":"Three IDX","symbols":["BBCA.JK","BBRI.JK","TLKM.JK"]}`, tokenA)
	if response.Code != http.StatusCreated {
		t.Fatalf("create universe = %d: %s", response.Code, response.Body.String())
	}
	var createdUniverse universe.Universe
	if err := json.Unmarshal(response.Body.Bytes(), &createdUniverse); err != nil {
		t.Fatal(err)
	}
	response = call(serverB, http.MethodGet, "/api/v1/stock-universes/"+createdUniverse.ID, "", tokenB)
	assertErrorCode(t, response, http.StatusNotFound, "RESOURCE_NOT_FOUND")
	response = call(serverA, http.MethodGet, "/api/v1/stock-universes/"+createdUniverse.ID, "", tokenA)
	if response.Code != http.StatusOK {
		t.Fatalf("owner read universe = %d: %s", response.Code, response.Body.String())
	}
	prepareBody := fmt.Sprintf(`{"purpose":"screen","rule_id":%q,"universe_id":%q}`, createdRule.ID, createdUniverse.ID)
	response = call(serverB, http.MethodPost, "/api/v1/datasets/prepare", prepareBody, tokenB)
	assertErrorCode(t, response, http.StatusNotFound, "RESOURCE_NOT_FOUND")
	response = call(serverA, http.MethodPost, "/api/v1/datasets/prepare", prepareBody, tokenA)
	if response.Code != http.StatusOK {
		t.Fatalf("dataset preparation=%d %s", response.Code, response.Body.String())
	}
	var manifest dataset.Manifest
	if err := json.Unmarshal(response.Body.Bytes(), &manifest); err != nil {
		t.Fatal(err)
	}
	if len(manifest.Symbols) != 3 || manifest.ExpiresAt == "" {
		t.Fatalf("invalid multi-symbol manifest")
	}
	response = call(serverB, http.MethodGet, "/api/v1/datasets/"+manifest.DatasetID+"/content", "", tokenB)
	assertErrorCode(t, response, http.StatusNotFound, "RESOURCE_NOT_FOUND")
	response = call(serverA, http.MethodGet, "/api/v1/datasets/"+manifest.DatasetID+"/content", "", tokenA)
	if response.Code != http.StatusOK {
		t.Fatalf("dataset content status=%d", response.Code)
	}
	var content struct {
		Series []marketdata.Series `json:"series"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &content); err != nil {
		t.Fatal(err)
	}
	response = call(serverA, http.MethodPost, "/api/v1/datasets/prepare", prepareBody, tokenA)
	if response.Code != http.StatusOK || upstream.calls.Load() != 3 {
		t.Fatalf("cache reuse status=%d upstream_calls=%d", response.Code, upstream.calls.Load())
	}
	grantBody, _ := json.Marshal(map[string]string{"purpose": "screen", "dataset_id": manifest.DatasetID, "dataset_version": manifest.Version,
		"dataset_checksum": manifest.Checksum, "rule_id": createdRule.ID, "definition_hash": createdRule.DefinitionHash,
		"engine_version": createdRule.EngineVersion, "schema_version": createdRule.SchemaVersion})
	response = call(serverA, http.MethodPost, "/api/v1/compute-grants", string(grantBody), tokenA)
	if response.Code != http.StatusCreated {
		t.Fatalf("compute grant status=%d %s", response.Code, response.Body.String())
	}
	var screeningGrant compute.Grant
	if err := json.Unmarshal(response.Body.Bytes(), &screeningGrant); err != nil {
		t.Fatal(err)
	}
	ticketBody := fmt.Sprintf(`{"compute_grant_id":%q,"protocol":"screener-private-1"}`, screeningGrant.ID)
	response = call(serverB, http.MethodPost, "/api/v1/screener/socket-tickets", ticketBody, tokenB)
	assertErrorCode(t, response, http.StatusForbidden, "GRANT_INVALID")
	response = call(serverA, http.MethodPost, "/api/v1/screener/socket-tickets", ticketBody, tokenA)
	if response.Code != http.StatusCreated {
		t.Fatalf("socket ticket=%d %s", response.Code, response.Body.String())
	}
	var ticket struct {
		Token string `json:"ticket"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &ticket); err != nil {
		t.Fatal(err)
	}
	verifyPostgresScreeningSocket(t, serverA, ticket.Token, content.Series, createdRule.Definition)
	response = call(serverA, http.MethodGet, "/api/v1/account/me", "", tokenA)
	if response.Code != http.StatusOK {
		t.Fatalf("owner account = %d: %s", response.Code, response.Body.String())
	}
	listed, err := sessions.List(ctx, userA)
	if err != nil || len(listed) != 1 {
		t.Fatalf("owner session list = %d, err = %v", len(listed), err)
	}
	grantStore := compute.NewPostgresRepository(db)
	grant, err := grantStore.Create(ctx, compute.CreateRequest{
		UserID: userA, SessionID: listed[0].ID, Purpose: "screen",
		DatasetID: "fixture", DatasetVersion: "v1", DatasetChecksum: "sha256:data",
		RuleID: createdRule.ID, DefinitionHash: createdRule.DefinitionHash,
		EngineVersion: "test", SchemaVersion: "test",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := grantStore.Verify(ctx, userB, listed[0].ID, grant.ID); err != compute.ErrInvalid {
		t.Fatalf("cross-owner compute grant verified: %v", err)
	}
	if err := accounts.RevokeFeatureAudited(ctx, userA, "api-revoke", userB,
		access.FeatureScreener, "test complete"); err != nil {
		t.Fatal(err)
	}
	if err := accounts.RequireFeature(ctx, userB, access.FeatureScreener); err != access.ErrEntitlementMissing {
		t.Fatalf("revoked grant remained usable: %v", err)
	}

	// A trusted operator can activate a plan for another account. That plan's
	// feature mapping becomes an effective entitlement without recreating a
	// manual feature-grant row.
	response = call(serverA, http.MethodPost, "/api/v1/operator/subscriptions",
		fmt.Sprintf(`{"user_id":%q,"plan_code":"analyst","current_period_end":%q,"reason":"integration test"}`,
			userB, time.Now().Add(time.Hour).UTC().Format(time.RFC3339)), tokenA)
	if response.Code != http.StatusCreated {
		t.Fatalf("operator subscription activation = %d: %s", response.Code, response.Body.String())
	}
	if err := accounts.RequireFeature(ctx, userB, access.FeatureScreener); err != nil {
		t.Fatalf("active subscription did not enable screener: %v", err)
	}
	response = call(serverB, http.MethodGet, "/api/v1/subscription", "", tokenB)
	if response.Code != http.StatusOK || !bytes.Contains(response.Body.Bytes(), []byte(`"plan_code":"analyst"`)) {
		t.Fatalf("owner subscription = %d: %s", response.Code, response.Body.String())
	}
	response = call(serverB, http.MethodPost, "/api/v1/subscription/cancel",
		`{"at_period_end":false,"reason":"integration test"}`, tokenB)
	if response.Code != http.StatusOK {
		t.Fatalf("owner cancellation = %d: %s", response.Code, response.Body.String())
	}
	if err := accounts.RequireFeature(ctx, userB, access.FeatureScreener); err != access.ErrEntitlementMissing {
		t.Fatalf("canceled subscription remained usable: %v", err)
	}
	// Revoked and expired sessions cannot rotate back into an active state.
	bSession, err := sessions.Verify(ctx, userB, tokenB)
	if err != nil {
		t.Fatal(err)
	}
	if err := sessions.RevokeByID(ctx, userB, bSession.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := sessions.Rotate(ctx, userB, bSession.ID, tokenB); err != session.ErrInvalid {
		t.Fatal("rotation revived revoked session")
	}
	if _, err := db.Exec(ctx, `update signalgen.app_sessions set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where user_id=$1::uuid and id=$2`, userA, before.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := sessions.Rotate(ctx, userA, before.ID, tokenA); err != session.ErrInvalid {
		t.Fatal("rotation revived expired session")
	}
}

// Market data is deterministic, while profiles, rules, universes, app sessions,
// and grants are real Postgres repositories in this test. No cloud Auth users
// are created and no email or real trading action is performed.
type integrationMarketProvider struct {
	candles []core.Candle
	calls   atomic.Int32
}

func (provider *integrationMarketProvider) Daily(_ context.Context, instruments []universe.Instrument, _ int) ([]marketdata.Series, error) {
	provider.calls.Add(1)
	return []marketdata.Series{{Symbol: instruments[0].Symbol, Timezone: "UTC", Candles: append([]core.Candle(nil), provider.candles...)}}, nil
}

func verifyPostgresScreeningSocket(t *testing.T, server *api.Server, ticket string, series []marketdata.Series, rule core.RuleSnapshot) {
	t.Helper()
	// With the integration flag, features originate in the compiled Go/WASM
	// bridge exactly as in Model A. Otherwise retain the fast native check.
	var candidates []core.FeatureCandidate
	if os.Getenv("SIGNALGEN_RUN_WASM_INTEGRATION") == "1" {
		results := actualWASMFeatures(t, series)
		assertWASMParity(t, series, results)
		for _, features := range results {
			candidates = append(candidates, features.Candidates...)
		}
	} else {
		for _, item := range series {
			features, err := core.ComputeFeatures(core.FeatureRequest{Purpose: "screen", Symbol: item.Symbol, Candles: item.Candles})
			if err != nil {
				t.Fatal(err)
			}
			candidates = append(candidates, features.Candidates...)
		}
	}
	httpServer := httptest.NewServer(server)
	defer httpServer.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	connection, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(httpServer.URL, "http")+"/api/v1/screener/ws?ticket="+ticket, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close(websocket.StatusNormalClosure, "integration complete")
	if err := wsjson.Write(ctx, connection, screenerapi.EvaluateMessage{Type: "screener.evaluate", Protocol: core.PrivateProtocol,
		RequestID: "postgres-screening", EngineVersion: core.EngineVersion, FeatureSchemaVersion: core.FeatureSchemaVersion, Candidates: candidates}); err != nil {
		t.Fatal(err)
	}
	var result screenerapi.ResultMessage
	if err := wsjson.Read(ctx, connection, &result); err != nil {
		t.Fatal(err)
	}
	if result.Type != "screener.result" || result.RequestID != "postgres-screening" || len(result.Results) != len(candidates) || len(candidates) == 0 {
		t.Fatalf("invalid screening result type=%s count=%d", result.Type, len(result.Results))
	}
	// Compare server matches with native decision evaluation per symbol. Counts
	// alone would miss an implementation that returns every candidate as false.
	expectedMatches := make(map[string]bool)
	for _, item := range series {
		var symbolCandidates []core.FeatureCandidate
		for _, candidate := range candidates {
			if candidate.Symbol == item.Symbol {
				symbolCandidates = append(symbolCandidates, candidate)
			}
		}
		decision, err := core.EvaluateDecision(core.DecisionRequest{Rule: rule, Candidates: symbolCandidates})
		if err != nil {
			t.Fatal(err)
		}
		for _, signal := range decision.Signals {
			expectedMatches[signal.Symbol+"/"+signal.Timestamp] = true
		}
	}
	for index, decision := range result.Results {
		if decision.Symbol != candidates[index].Symbol || decision.Timestamp != candidates[index].Timestamp {
			t.Fatal("screening result reordered or lost candidates")
		}
		if decision.Matched != expectedMatches[decision.Symbol+"/"+decision.Timestamp] {
			t.Fatal("private server decision does not match the native per-symbol rule")
		}
	}
	t.Logf("Postgres screening verified: %d symbols, %d candidates, %d decisions", len(series), len(candidates), len(result.Results))
}
