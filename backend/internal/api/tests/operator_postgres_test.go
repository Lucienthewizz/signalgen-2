package apitests

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/account"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	platformdb "github.com/Lucienthewizz/signalgen-2/backend/internal/platform/database"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresOperatorManagement(t *testing.T) {
	raw := os.Getenv("SIGNALGEN_TEST_PG_URL")
	if raw == "" {
		t.Skip("set SIGNALGEN_TEST_PG_URL for isolated admin test")
	}
	parsed, err := url.Parse(raw)
	config, configErr := pgxpool.ParseConfig(raw)
	// This test replaces fixtures. Validate both visible and effective settings;
	// never accept a Supabase hostname, host override, fallback or non-test DB.
	if err != nil || configErr != nil || (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") || parsed.Path != "/signalgen_test" ||
		(config.ConnConfig.Host != "127.0.0.1" && config.ConnConfig.Host != "localhost") || config.ConnConfig.Database != "signalgen_test" || len(config.ConnConfig.Fallbacks) != 0 {
		t.Fatal("admin tests require isolated signalgen_test on loopback")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := platformdb.OpenPostgres(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(ctx, `truncate auth.users cascade`); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		_, _ = db.Exec(cleanup, `alter table signalgen.audit_events drop constraint if exists test_status_audit_failure`)
		if _, err := db.Exec(cleanup, `truncate auth.users cascade`); err != nil {
			t.Error(err)
		}
	}()
	store := account.NewPostgresRepository(db)
	ids := make([]string, 3)
	for index, email := range []string{"operator@test.invalid", "member@test.invalid", "backup@test.invalid"} {
		if err := db.QueryRow(ctx, `insert into auth.users(email) values($1) returning id::text`, email).Scan(&ids[index]); err != nil {
			t.Fatal(err)
		}
		if _, err := store.EnsureProfile(ctx, ids[index], email); err != nil {
			t.Fatal(err)
		}
	}
	actor, member, backup := ids[0], ids[1], ids[2]
	if err := store.BootstrapOperator(ctx, "local:test", "bootstrap", actor, "test operator"); err != nil {
		t.Fatal(err)
	}
	sessions, err := session.NewPostgresRepository(db, 1, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	adminSession, err := sessions.Create(ctx, actor, "admin-install", "Admin")
	if err != nil {
		t.Fatal(err)
	}
	oldSession, err := sessions.Create(ctx, member, "member-install", "Member")
	if err != nil {
		t.Fatal(err)
	}
	newServer := func(id string) *api.Server {
		server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: id, Email: id + "@test.invalid"}}, sessions, store, &fakeDatasets{}, &fakeCompute{}, api.WithAccountManagement(store))
		if err != nil {
			t.Fatal(err)
		}
		return server
	}
	server := newServer(actor)
	call := func(server *api.Server, method, path, body, token string) *httptest.ResponseRecorder {
		req := managementRequest(method, path, body)
		req.Header.Set("X-App-Session", token)
		res := httptest.NewRecorder()
		server.ServeHTTP(res, req)
		return res
	}
	// Cursor traversal must return every profile once, with no private fields.
	seen := map[string]bool{}
	cursor := ""
	for {
		path := "/api/v1/operator/accounts?limit=1"
		if cursor != "" {
			path += "&after=" + cursor
		}
		res := call(server, "GET", path, "", adminSession.Token)
		if res.Code != 200 {
			t.Fatalf("accounts %d %s", res.Code, res.Body.String())
		}
		var page account.AccountPage
		if json.Unmarshal(res.Body.Bytes(), &page) != nil || len(page.Items) != 1 {
			t.Fatal("invalid account page")
		}
		if seen[page.Items[0].UserID] {
			t.Fatal("duplicate cursor item")
		}
		seen[page.Items[0].UserID] = true
		for _, key := range []string{"token_hash", "bio", "definition_json"} {
			if strings.Contains(res.Body.String(), key) {
				t.Fatal("private account data exposed")
			}
		}
		cursor = page.NextCursor
		if cursor == "" {
			break
		}
	}
	if len(seen) != 3 {
		t.Fatal("pagination omitted profiles")
	}
	res := call(newServer(member), "GET", "/api/v1/operator/accounts", "", oldSession.Token)
	assertErrorCode(t, res, 403, "ROLE_REQUIRED")
	if _, err := store.ListAccounts(ctx, member, account.AccountQuery{}); !errors.Is(err, access.ErrRoleRequired) {
		t.Fatal("repository read bypassed role")
	}
	if _, err := store.ListAccountAudit(ctx, member, account.AuditQuery{UserID: actor}); !errors.Is(err, access.ErrRoleRequired) {
		t.Fatal("repository audit bypassed role")
	}
	if _, err := store.SetStatusAudited(ctx, member, "forged", actor, account.StatusUpdate{Status: "suspended", ExpectedStatus: "active", Reason: "forged"}); !errors.Is(err, access.ErrRoleRequired) {
		t.Fatal("repository status bypassed role")
	}
	res = call(server, "PATCH", "/api/v1/operator/accounts/"+member+"/status", `{"status":"suspended","expected_status":"active","reason":"moderation test"}`, adminSession.Token)
	if res.Code != 200 {
		t.Fatalf("suspend %d %s", res.Code, res.Body.String())
	}
	if _, err := sessions.Verify(ctx, member, oldSession.Token); !errors.Is(err, session.ErrRevoked) {
		t.Fatal("suspension did not revoke session")
	}
	if _, err := sessions.Create(ctx, member, "member-install", "Member"); !errors.Is(err, session.ErrAccountInactive) {
		t.Fatalf("inactive account recreated session: %v", err)
	}
	res = call(newServer(member), "POST", "/api/v1/sessions", `{"installation_id":"member-install","label":"Member"}`, "")
	assertErrorCode(t, res, 403, "ACCOUNT_SUSPENDED")
	res = call(server, "PATCH", "/api/v1/operator/accounts/"+member+"/status", `{"status":"active","expected_status":"active","reason":"stale tab"}`, adminSession.Token)
	assertErrorCode(t, res, 409, "STATUS_CONFLICT")
	res = call(server, "PATCH", "/api/v1/operator/accounts/"+member+"/status", `{"status":"active","expected_status":"suspended","reason":"review complete"}`, adminSession.Token)
	if res.Code != 200 {
		t.Fatal("reactivation failed")
	}
	if _, err := sessions.Verify(ctx, member, oldSession.Token); !errors.Is(err, session.ErrRevoked) {
		t.Fatal("reactivation resurrected old session")
	}
	fresh, err := sessions.Create(ctx, member, "member-install", "Member")
	if err != nil {
		t.Fatal(err)
	}
	var before int
	if err := db.QueryRow(ctx, `select count(*) from signalgen.audit_events where target_user_id=$1::uuid`, member).Scan(&before); err != nil {
		t.Fatal(err)
	}
	// Same-state request is idempotent; it cannot create a misleading audit.
	if _, err := store.SetStatusAudited(ctx, actor, "noop", member, account.StatusUpdate{Status: "active", ExpectedStatus: "active", Reason: "repeat"}); err != nil {
		t.Fatal(err)
	}
	var after int
	_ = db.QueryRow(ctx, `select count(*) from signalgen.audit_events where target_user_id=$1::uuid`, member).Scan(&after)
	if before != after || before != 2 {
		t.Fatalf("status audit count %d -> %d", before, after)
	}
	res = call(server, "GET", "/api/v1/operator/audit-events?user_id="+member+"&limit=1", "", adminSession.Token)
	var audits account.AuditPage
	if res.Code != 200 || json.Unmarshal(res.Body.Bytes(), &audits) != nil || len(audits.Items) != 1 || audits.NextCursor == "" || audits.Items[0].Action != "account.status_changed" || audits.Items[0].Actor != actor || !strings.HasPrefix(audits.Items[0].RequestID, "req_") {
		t.Fatalf("audit %d %s", res.Code, res.Body.String())
	}
	if strings.Contains(res.Body.String(), `"before"`) || strings.Contains(res.Body.String(), `"after"`) || strings.Contains(res.Body.String(), "before_json") || strings.Contains(res.Body.String(), "after_json") {
		t.Fatal("raw audit JSON exposed")
	}
	firstID := audits.Items[0].ID
	res = call(server, "GET", "/api/v1/operator/audit-events?user_id="+member+"&limit=1&before="+audits.NextCursor, "", adminSession.Token)
	// Decode into a fresh page: omitted optional cursor fields must not retain
	// a previous response's value in the Go test fixture.
	audits = account.AuditPage{}
	if res.Code != 200 || json.Unmarshal(res.Body.Bytes(), &audits) != nil || len(audits.Items) != 1 || audits.Items[0].ID == firstID || audits.NextCursor != "" {
		t.Fatalf("audit cursor repeated or lost history: %d %s", res.Code, res.Body.String())
	}
	page, err := store.ListAccountAudit(ctx, actor, account.AuditQuery{UserID: member, Limit: 100})
	if err != nil || len(page.Items) != 2 {
		t.Fatal("target audit read")
	}
	// Force ONLY the local audit insert to fail. Status and revocation must roll
	// back together instead of leaving an unaudited suspension behind.
	if _, err := db.Exec(ctx, `alter table signalgen.audit_events add constraint test_status_audit_failure check(action <> 'account.status_changed') not valid`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetStatusAudited(ctx, actor, "rollback", member, account.StatusUpdate{Status: "suspended", ExpectedStatus: "active", Reason: "test rollback"}); err == nil {
		t.Fatal("audit failure ignored")
	}
	state, err := store.Account(ctx, member)
	if err != nil || state.Status != "active" {
		t.Fatal("status failed to roll back")
	}
	if _, err := sessions.Verify(ctx, member, fresh.Token); err != nil {
		t.Fatal("revocation failed to roll back")
	}
	if _, err := db.Exec(ctx, `alter table signalgen.audit_events drop constraint test_status_audit_failure`); err != nil {
		t.Fatal(err)
	}
	// Race session creation against suspension. Every winning creation must be
	// revoked before suspension commits; no creation can survive afterwards.
	start := make(chan struct{})
	failures := make(chan error, 13)
	var workers sync.WaitGroup
	for i := 0; i < 12; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			_, err := sessions.Create(ctx, member, "member-install", "Member")
			if err != nil && !errors.Is(err, session.ErrAccountInactive) {
				failures <- err
			}
		}()
	}
	workers.Add(1)
	go func() {
		defer workers.Done()
		<-start
		_, err := store.SetStatusAudited(ctx, actor, "race-suspend", member, account.StatusUpdate{Status: "suspended", ExpectedStatus: "active", Reason: "race test"})
		if err != nil {
			failures <- err
		}
	}()
	close(start)
	workers.Wait()
	close(failures)
	for err := range failures {
		t.Error(err)
	}
	var active int
	if err := db.QueryRow(ctx, `select count(*) from signalgen.app_sessions where user_id=$1::uuid and revoked_at is null`, member).Scan(&active); err != nil || active != 0 {
		t.Fatalf("surviving sessions=%d error=%v", active, err)
	}
	res = call(server, "PATCH", "/api/v1/operator/accounts/"+actor+"/status", `{"status":"suspended","expected_status":"active","reason":"unsafe"}`, adminSession.Token)
	assertErrorCode(t, res, 409, "LAST_OPERATOR_REQUIRED")
	if _, err := store.SetRoleAudited(ctx, actor, "promote", backup, "operator", "backup"); err != nil {
		t.Fatal(err)
	}
	// Status and role removal MUST share one global lock. Two concurrent self
	// changes cannot remove the last operator through different mutation paths.
	start = make(chan struct{})
	results := make(chan error, 2)
	go func() {
		<-start
		_, err := store.SetStatusAudited(ctx, actor, "race-status", actor, account.StatusUpdate{Status: "suspended", ExpectedStatus: "active", Reason: "race"})
		results <- err
	}()
	go func() {
		<-start
		_, err := store.SetRoleAudited(ctx, backup, "race-role", backup, "user", "race")
		results <- err
	}()
	close(start)
	successes := 0
	for i := 0; i < 2; i++ {
		err := <-results
		if err == nil {
			successes++
		} else if !errors.Is(err, access.ErrLastOperator) {
			t.Fatal(err)
		}
	}
	if successes != 1 {
		t.Fatalf("operator race successes=%d", successes)
	}
	if err := db.QueryRow(ctx, `select count(*) from signalgen.account_profiles where role='operator' and status='active'`).Scan(&active); err != nil || active != 1 {
		t.Fatal("last operator lost")
	}
	t.Log("Admin Postgres verified: cursor pages, status/session/audit atomicity, rollback, 12 session contenders, mixed role/status race")
}
