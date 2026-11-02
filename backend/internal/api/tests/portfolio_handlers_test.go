package apitests

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/portfolio"
)

type fakePortfolio struct {
	owner string
	err   error
}

func (f *fakePortfolio) List(_ context.Context, owner string) ([]portfolio.Transaction, error) {
	f.owner = owner
	return []portfolio.Transaction{}, f.err
}
func (f *fakePortfolio) Get(_ context.Context, owner, id string) (portfolio.Transaction, error) {
	f.owner = owner
	return portfolio.Transaction{}, portfolio.ErrNotFound
}
func (f *fakePortfolio) Put(_ context.Context, owner, id string, v int64, d portfolio.Data) (portfolio.Transaction, error) {
	f.owner = owner
	return portfolio.Transaction{ID: id, Version: v + 1, Data: d}, f.err
}
func (f *fakePortfolio) Delete(_ context.Context, owner, id string, v int64) error {
	f.owner = owner
	return f.err
}

func TestPortfolioUsesPrincipalAndRejectsForgedFields(t *testing.T) {
	store := &fakePortfolio{}
	server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{}, api.WithPortfolioStore(store))
	if err != nil {
		t.Fatal(err)
	}
	id := "11111111-1111-4111-8111-111111111111"
	data := `{"symbol":"BBCA.JK","market":"IDX","currency":"IDR","side":"BUY","quantity":"100","price":"4000","fee":"0","executed_at":"2026-09-01T02:00:00Z","book":"Main","note":""}`
	for _, c := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/api/v1/portfolio", "", 200},
		{"GET", "/api/v1/portfolio/transactions?market=IDX&book=Main", "", 200},
		{"GET", "/api/v1/portfolio?user_id=user-b", "", 422},
		{"GET", "/api/v1/portfolio?market=INVALID", "", 422},
		{"GET", "/api/v1/portfolio/transactions/not-uuid", "", 422},
		{"PUT", "/api/v1/portfolio/transactions/" + id, `{"version":0,"data":` + data + `}`, 200},
		{"PUT", "/api/v1/portfolio/transactions/" + id, `{"version":0,"user_id":"user-b","data":` + data + `}`, 400},
		{"PUT", "/api/v1/portfolio/transactions/" + id, `{"version":0,"data":` + strings.Replace(data, `"quantity":"100"`, `"quantity":100`, 1) + `}`, 400},
		{"PUT", "/api/v1/portfolio/transactions/" + id, `{"version":0,"data":` + strings.Replace(data, `"note":`, `"realized_pnl":"99999","note":`, 1) + `}`, 400},
		{"PUT", "/api/v1/portfolio/transactions/" + id, `{"version":0,"data":` + strings.Replace(data, `"quantity":"100"`, `"quantity":"1"`, 1) + `}`, 422},
		{"DELETE", "/api/v1/portfolio/transactions/" + id, `{"version":1}`, 204},
		{"DELETE", "/api/v1/portfolio/transactions/" + id, `{}`, 422},
	} {
		r := httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
		r.Header.Set("Authorization", "Bearer fixture")
		r.Header.Set("X-App-Session", "fixture")
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		if w.Code != c.status {
			t.Fatalf("%s %s got %d: %s", c.method, c.path, w.Code, w.Body.String())
		}
	}
	if store.owner != "user-a" {
		t.Fatal("owner came from client input")
	}
	for _, test := range []struct {
		err    error
		status int
		code   string
	}{
		{portfolio.ErrInsufficient, 409, "INSUFFICIENT_HOLDINGS"}, {portfolio.ErrConflict, 409, "VERSION_CONFLICT"},
		{portfolio.ErrLimit, 409, "PORTFOLIO_LIMIT"}, {errors.New("private-database-secret"), 503, "PORTFOLIO_UNAVAILABLE"},
		{context.DeadlineExceeded, 504, "REQUEST_TIMEOUT"},
	} {
		store.err = test.err
		r := httptest.NewRequest("PUT", "/api/v1/portfolio/transactions/"+id, strings.NewReader(`{"version":0,"data":`+data+`}`))
		r.Header.Set("Authorization", "Bearer fixture")
		r.Header.Set("X-App-Session", "fixture")
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		assertErrorCode(t, w, test.status, test.code)
		if strings.Contains(w.Body.String(), "private-database-secret") {
			t.Fatal("raw storage error leaked")
		}
	}
}

func TestPortfolioRequiresActiveSessionAndAccount(t *testing.T) {
	for _, route := range []string{"/api/v1/portfolio", "/api/v1/portfolio/transactions"} {
		server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{}, &fakeAccess{err: access.ErrAccountSuspended}, &fakeDatasets{}, &fakeCompute{}, api.WithPortfolioStore(&fakePortfolio{}))
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest("GET", route, nil)
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		assertErrorCode(t, w, 401, "AUTH_REQUIRED")
		r.Header.Set("Authorization", "Bearer fixture")
		r.Header.Set("X-App-Session", "fixture")
		w = httptest.NewRecorder()
		server.ServeHTTP(w, r)
		assertErrorCode(t, w, 403, "ACCOUNT_SUSPENDED")
	}
}
