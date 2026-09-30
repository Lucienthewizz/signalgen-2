package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/account"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/compute"
	platformdb "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/database"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/subscription"
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
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
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
	newServer := func(id string) *Server {
		server, err := NewServer(fakeIdentity{principal: auth.Principal{ID: id, Email: id + "@test.invalid"}},
			sessions, accounts, &fakeDatasets{}, compute.NewPostgresRepository(db),
			WithRuleStore(rules.NewPostgresRepository(db)),
			WithSubscriptionService(subscriptions))
		if err != nil {
			t.Fatal(err)
		}
		return server
	}
	serverA, serverB := newServer(userA), newServer(userB)
	call := func(server *Server, method, path, body, appToken string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		request.Header.Set("Authorization", "Bearer test-identity")
		if appToken != "" {
			request.Header.Set("X-App-Session", appToken)
		}
		response := httptest.NewRecorder()
		server.ServeHTTP(response, request)
		return response
	}
	createSession := func(server *Server, installation string) string {
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
	if _, err := sessions.Verify(ctx, userB, tokenA); err != session.ErrInvalid {
		t.Fatalf("cross-owner app session verified: %v", err)
	}
	if _, err := accounts.RequireOperator(ctx, userB); err != access.ErrRoleRequired {
		t.Fatalf("ordinary user gained operator role: %v", err)
	}
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
}
