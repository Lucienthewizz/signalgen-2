package apitests

import (
	"context"
	"encoding/json"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/workspace"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakeWorkspace struct {
	owner    string
	conflict bool
}

func (s *fakeWorkspace) List(_ context.Context, owner string) ([]workspace.Item, error) {
	s.owner = owner
	return []workspace.Item{}, nil
}
func (s *fakeWorkspace) Put(_ context.Context, owner, kind string, version int64, data json.RawMessage) (workspace.Item, error) {
	s.owner = owner
	if s.conflict {
		return workspace.Item{}, workspace.ErrConflict
	}
	return workspace.Item{Kind: kind, Data: data, Version: version + 1}, nil
}
func TestWorkspaceOwnerAndStrictPayload(t *testing.T) {
	store := &fakeWorkspace{}
	server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{}, api.WithWorkspaceStore(store))
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		body   string
		status int
	}{
		{`{"version":0,"data":["BBCA"]}`, 200},
		{`{"version":0,"data":["BBCA"],"user_id":"user-b"}`, 422},
		{`{"data":["BBCA"]}`, 422},
		{`{"version":0,"data":{"access_token":"secret"}}`, 422},
		{`{"version":0,"data":[]} {}`, 422},
	} {
		r := httptest.NewRequest(http.MethodPut, "/api/v1/workspace/watchlist", strings.NewReader(test.body))
		r.Header.Set("Authorization", "Bearer token")
		r.Header.Set("X-App-Session", "session")
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		if w.Code != test.status {
			t.Fatalf("status %d want %d: %s", w.Code, test.status, w.Body.String())
		}
	}
	if store.owner != "user-a" {
		t.Fatalf("wrong owner %s", store.owner)
	}
	store.conflict = true
	r := httptest.NewRequest(http.MethodPut, "/api/v1/workspace/watchlist", strings.NewReader(`{"version":1,"data":[]}`))
	r.Header.Set("Authorization", "Bearer token")
	r.Header.Set("X-App-Session", "session")
	w := httptest.NewRecorder()
	server.ServeHTTP(w, r)
	assertErrorCode(t, w, 409, "VERSION_CONFLICT")
	r = httptest.NewRequest(http.MethodGet, "/api/v1/workspace", nil)
	w = httptest.NewRecorder()
	server.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatalf("unauthed status %d", w.Code)
	}
}
