package apitests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/rules"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/subscription"
)

type fakeSubscriptions struct {
	plans     []subscription.Plan
	current   subscription.Subscription
	err       error
	activated subscription.ActivateRequest
	canceled  subscription.CancelRequest
}

type quotaRules struct {
	rules.Repository
	owner string
}

func (store *quotaRules) List(_ context.Context, owner string) ([]rules.Rule, error) {
	store.owner = owner
	return []rules.Rule{{ID: "owned-rule", OwnerType: "user"}}, nil
}

func TestResourceUsageUsesPrincipalAndEffectivePlan(t *testing.T) {
	store := &quotaRules{}
	service := &fakeSubscriptions{current: subscription.Subscription{PlanCode: "pro", Status: subscription.StatusActive, CurrentPeriodStart: time.Now().Add(-time.Hour), CurrentPeriodEnd: time.Now().Add(time.Hour)}}
	server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{}, &fakeAccess{account: access.Account{UserID: "user-a", Status: access.StatusActive}}, &fakeDatasets{}, &fakeCompute{}, api.WithSubscriptionService(service), api.WithRuleStore(store), api.WithUniverseStore(&fakeUniverseStore{}))
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	server.ServeHTTP(response, subscriptionRequest(http.MethodGet, "/api/v1/subscription/usage?user_id=user-b", ""))
	var usage struct {
		Limits subscription.ResourceLimits `json:"limits"`
		Used   subscription.ResourceLimits `json:"used"`
	}
	if response.Code != http.StatusOK {
		t.Fatalf("usage failed: %d %s", response.Code, response.Body.String())
	}
	if err := json.Unmarshal(response.Body.Bytes(), &usage); err != nil {
		t.Fatal(err)
	}
	if store.owner != "user-a" || usage.Used.CustomRules != 1 || usage.Used.StockUniverses != 1 || usage.Limits.CustomRules != 50 || usage.Limits.StockUniverses != 20 {
		t.Fatalf("owner=%s usage=%+v", store.owner, usage)
	}
	if response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal("usage must remain private")
	}
}

func (fake *fakeSubscriptions) Plans(context.Context) ([]subscription.Plan, error) {
	return fake.plans, fake.err
}

func (fake *fakeSubscriptions) Current(_ context.Context, userID string) (subscription.Subscription, error) {
	current := fake.current
	current.UserID = userID
	return current, fake.err
}

func (fake *fakeSubscriptions) ActivateManual(_ context.Context, request subscription.ActivateRequest) (subscription.Subscription, error) {
	fake.activated = request
	return fake.current, fake.err
}

func (fake *fakeSubscriptions) Cancel(_ context.Context, request subscription.CancelRequest) (subscription.Subscription, error) {
	fake.canceled = request
	return fake.current, fake.err
}

func subscriptionTestServer(t *testing.T, role string, service subscription.Service) *api.Server {
	t.Helper()
	server, err := api.NewServer(
		fakeIdentity{principal: auth.Principal{ID: "user-a", Email: "a@test.invalid"}},
		&fakeSessions{},
		&fakeAccess{account: access.Account{UserID: "user-a", Role: role, Status: access.StatusActive}},
		&fakeDatasets{}, &fakeCompute{}, api.WithSubscriptionService(service),
	)
	if err != nil {
		t.Fatal(err)
	}
	return server
}

func subscriptionRequest(method, path, body string) *http.Request {
	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	request.Header.Set("Authorization", "Bearer identity")
	request.Header.Set("X-App-Session", "session")
	return request
}

func TestSubscriptionPlansArePublicAndExcludePricing(t *testing.T) {
	service := &fakeSubscriptions{plans: []subscription.Plan{{
		Code: "analyst", Name: "Analyst", Description: "Analysis", Features: []string{"screener"},
	}}}
	server := subscriptionTestServer(t, access.RoleUser, service)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/subscription/plans", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if bytes.Contains(response.Body.Bytes(), []byte("price")) {
		t.Fatal("unapproved pricing leaked from subscription catalog")
	}
	var catalog struct {
		Items []subscription.Plan `json:"items"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &catalog); err != nil {
		t.Fatal(err)
	}
	if len(catalog.Items) != 1 || catalog.Items[0].Limits.CustomRules != 10 || catalog.Items[0].Limits.StockUniverses != 5 {
		t.Fatalf("missing Analyst limits: %+v", catalog.Items)
	}
}

func TestUsageRejectsAnonymousCallers(t *testing.T) {
	server := subscriptionTestServer(t, access.RoleUser, &fakeSubscriptions{})
	response := httptest.NewRecorder()
	server.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/subscription/usage?user_id=other", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("usage without identity returned %d", response.Code)
	}
}

func TestCurrentSubscriptionUsesAuthenticatedOwner(t *testing.T) {
	service := &fakeSubscriptions{current: subscription.Subscription{ID: "sub_1", PlanCode: "analyst", Status: subscription.StatusActive}}
	server := subscriptionTestServer(t, access.RoleUser, service)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, subscriptionRequest(http.MethodGet, "/api/v1/subscription", ""))
	if response.Code != http.StatusOK || bytes.Contains(response.Body.Bytes(), []byte(`"user_id"`)) {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("cache control = %q", response.Header().Get("Cache-Control"))
	}
}

func TestSubscriptionCancelIsOwnerScoped(t *testing.T) {
	service := &fakeSubscriptions{current: subscription.Subscription{ID: "sub_1", Status: subscription.StatusActive}}
	server := subscriptionTestServer(t, access.RoleUser, service)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, subscriptionRequest(http.MethodPost, "/api/v1/subscription/cancel", `{"at_period_end":true}`))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if service.canceled.UserID != "user-a" || !service.canceled.AtPeriodEnd {
		t.Fatalf("cancel request = %+v", service.canceled)
	}
}

func TestOperatorSubscriptionActivationUsesServerActor(t *testing.T) {
	service := &fakeSubscriptions{current: subscription.Subscription{ID: "sub_1", Status: subscription.StatusActive}}
	server := subscriptionTestServer(t, access.RoleOperator, service)
	periodEnd := time.Now().UTC().Add(30 * 24 * time.Hour).Format(time.RFC3339)
	body := `{"user_id":"user-b","plan_code":"analyst","current_period_end":"` + periodEnd + `","reason":"supervised trial"}`
	response := httptest.NewRecorder()
	server.ServeHTTP(response, subscriptionRequest(http.MethodPost, "/api/v1/operator/subscriptions", body))
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if service.activated.Actor != "user-a" || service.activated.UserID != "user-b" || service.activated.PlanCode != "analyst" {
		t.Fatalf("activation = %+v", service.activated)
	}
}

func TestOrdinaryUserCannotActivateSubscription(t *testing.T) {
	service := &fakeSubscriptions{}
	server := subscriptionTestServer(t, access.RoleUser, service)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, subscriptionRequest(http.MethodPost, "/api/v1/operator/subscriptions", `{}`))
	assertErrorCode(t, response, http.StatusForbidden, "ROLE_REQUIRED")
}
