package api

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

type fakeUniverseStore struct {
	createOwner string
	createName  string
	createItems []string
}

func (fake *fakeUniverseStore) Catalog(context.Context) ([]universe.Instrument, error) {
	return []universe.Instrument{{Symbol: "BBCA.JK", Name: "Bank Central Asia Tbk", Exchange: "XIDX", Currency: "IDR"}}, nil
}
func (fake *fakeUniverseStore) List(_ context.Context, owner string) ([]universe.Universe, error) {
	return []universe.Universe{{ID: "univ-a", Name: owner, Symbols: []string{"BBCA.JK"}, Version: 1}}, nil
}
func (fake *fakeUniverseStore) Get(_ context.Context, owner, id string) (universe.Universe, error) {
	if owner != "user-a" || id != "univ-a" {
		return universe.Universe{}, universe.ErrNotFound
	}
	return universe.Universe{ID: id, Name: "Watchlist", Symbols: []string{"BBCA.JK"}, Version: 1}, nil
}
func (fake *fakeUniverseStore) Instruments(context.Context, string, string) ([]universe.Instrument, error) {
	return nil, nil
}
func (fake *fakeUniverseStore) Create(_ context.Context, owner, name string, symbols []string) (universe.Universe, error) {
	fake.createOwner, fake.createName, fake.createItems = owner, name, append([]string(nil), symbols...)
	return universe.Universe{ID: "univ-a", Name: name, Symbols: symbols, Version: 1}, nil
}
func (fake *fakeUniverseStore) Update(context.Context, string, string, string, []string, int) (universe.Universe, error) {
	return universe.Universe{}, nil
}
func (fake *fakeUniverseStore) Delete(context.Context, string, string, int) error { return nil }

func TestCreateStockUniverseUsesAuthenticatedOwner(t *testing.T) {
	store := &fakeUniverseStore{}
	server, err := NewServer(
		fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{},
		WithUniverseStore(store),
	)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/stock-universes", bytes.NewBufferString(`{"name":"Bank besar","symbols":["BBCA.JK","BBRI.JK"]}`))
	request.Header.Set("Authorization", "Bearer token")
	request.Header.Set("X-App-Session", "session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if store.createOwner != "user-a" || store.createName != "Bank besar" || len(store.createItems) != 2 {
		t.Fatalf("create = owner %q name %q symbols %v", store.createOwner, store.createName, store.createItems)
	}
}

func TestGetStockUniverseDoesNotAcceptOwnerFromClient(t *testing.T) {
	server, err := NewServer(
		fakeIdentity{principal: auth.Principal{ID: "user-b"}}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{},
		WithUniverseStore(&fakeUniverseStore{}),
	)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/stock-universes/univ-a?owner=user-a", nil)
	request.Header.Set("Authorization", "Bearer token")
	request.Header.Set("X-App-Session", "session")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertErrorCode(t, response, http.StatusNotFound, "RESOURCE_NOT_FOUND")
}
