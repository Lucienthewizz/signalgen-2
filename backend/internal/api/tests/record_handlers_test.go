package apitests

import (
	"context"
	"encoding/json"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/records"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakeRecords struct {
	owner    string
	conflict bool
	data     json.RawMessage
}

func (s *fakeRecords) List(_ context.Context, o, k string) ([]records.Item, error) {
	s.owner = o
	return []records.Item{}, nil
}
func (s *fakeRecords) Get(_ context.Context, o, k, id string) (records.Item, error) {
	s.owner = o
	return records.Item{}, records.ErrNotFound
}
func (s *fakeRecords) Put(_ context.Context, o, k, id string, v int64, data json.RawMessage) (records.Item, error) {
	s.owner = o
	s.data = data
	if s.conflict {
		return records.Item{}, records.ErrConflict
	}
	return records.Item{ID: id, Data: data, Version: v + 1}, nil
}
func (s *fakeRecords) Delete(_ context.Context, o, k, id string, v int64) error {
	s.owner = o
	if s.conflict {
		return records.ErrConflict
	}
	return nil
}
func TestRecordsOwnerStrictValidationAndPermissions(t *testing.T) {
	store := &fakeRecords{}
	server, e := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{}, &fakeAccess{}, &fakeDatasets{}, &fakeCompute{}, api.WithRecordStore(store))
	if e != nil {
		t.Fatal(e)
	}
	base := "/api/v1/journal/trades"
	id := "11111111-1111-4111-8111-111111111111"
	trade := `{"symbol":"BBCA","market":"IDX","currency":"IDR","side":"BUY","quantity":100,"entry_price":100,"exit_price":102,"entry_fee":1,"exit_fee":1,"entry_date":"2026-09-01","exit_date":"2026-09-02","book":"Trading","note":""}`
	for _, c := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", base, "", 200}, {"GET", base + "?user_id=user-b", "", 422},
		{"PUT", base + "/" + id, `{"version":0,"data":` + trade + `}`, 200},
		{"PUT", base + "/" + id, `{"version":0,"user_id":"user-b","data":` + trade + `}`, 422},
		{"PUT", base + "/" + id, `{"version":0,"data":` + strings.Replace(trade, `"note":`, `"net_pl":999,"note":`, 1) + `}`, 422},
		{"DELETE", base + "/" + id, `{"version":1}`, 204},
		{"DELETE", base + "/" + id, `{}`, 422}, {"GET", base + "/not-uuid", "", 422},
		{"GET", "/api/v1/backtests/history", "", 403},
	} {
		r := httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
		r.Header.Set("Authorization", "Bearer fixture")
		r.Header.Set("X-App-Session", "fixture")
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		if w.Code != c.status {
			t.Fatalf("%s %s status=%d want=%d %s", c.method, c.path, w.Code, c.status, w.Body)
		}
	}
	if store.owner != "user-a" {
		t.Fatal("client controlled owner")
	}
	var saved records.Trade
	_ = json.Unmarshal(store.data, &saved)
	if saved.NetPL == nil || *saved.NetPL != 198 {
		t.Fatal(string(store.data))
	}
	r := httptest.NewRequest("GET", base, nil)
	w := httptest.NewRecorder()
	server.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatal(w.Code)
	}
	store.conflict = true
	r = httptest.NewRequest("DELETE", base+"/"+id, strings.NewReader(`{"version":1}`))
	r.Header.Set("Authorization", "Bearer fixture")
	r.Header.Set("X-App-Session", "fixture")
	w = httptest.NewRecorder()
	server.ServeHTTP(w, r)
	assertErrorCode(t, w, 409, "VERSION_CONFLICT")
}
