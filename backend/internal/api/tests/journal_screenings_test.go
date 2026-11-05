package apitests

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/journal"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/records"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

type screeningRecords struct {
	items  []records.Item
	owner  string
	writes int
}

func (s *screeningRecords) List(_ context.Context, owner, kind string) ([]records.Item, error) {
	s.owner = owner
	return s.items, nil
}
func (s *screeningRecords) Get(context.Context, string, string, string) (records.Item, error) {
	return records.Item{}, records.ErrNotFound
}
func (s *screeningRecords) Put(_ context.Context, owner, kind, id string, version int64, data json.RawMessage) (records.Item, error) {
	s.owner = owner
	s.writes++
	if kind != "journal" || version != 0 {
		panic("screening journal must be append-only")
	}
	for _, item := range s.items {
		if item.ID == id {
			if string(item.Data) != string(data) {
				return records.Item{}, records.ErrConflict
			}
			return item, nil
		}
	}
	item := records.Item{ID: id, Version: 1, Data: data}
	s.items = append(s.items, item)
	return item, nil
}
func (s *screeningRecords) Delete(context.Context, string, string, string, int64) error {
	panic("screening journal cannot delete")
}

func TestJournalRequiresAttestedMatchAndPreservesLegacy(t *testing.T) {
	store := &screeningRecords{items: []records.Item{{ID: "legacy", Version: 1, Data: json.RawMessage(`{"symbol":"BBCA","quantity":100,"net_pl":20}`)}}}
	server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a"}}, &fakeSessions{verified: session.Session{ID: "session-a"}}, &fakeAccess{features: []string{"screener"}}, &fakeDatasets{}, &fakeCompute{}, api.WithRecordStore(store))
	if err != nil {
		t.Fatal(err)
	}
	request := func(method, path, body string, authenticated bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if authenticated {
			r.Header.Set("Authorization", "Bearer fixture")
			r.Header.Set("X-App-Session", "fixture")
		}
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		return w
	}
	path := "/api/v1/journal/screenings"
	assertErrorCode(t, request("GET", path, "", false), 401, "AUTH_REQUIRED")
	entry := journal.Entry{Symbol: "BBCA.JK", Market: "IDX", Currency: "IDR", RuleID: "rule-a", RuleName: "Rule A", DefinitionHash: "hash-a", Timeframe: "5m", CandleAt: "2026-11-05T01:00:00Z", Matched: true, Price: 4000, SignalType: "BUY", Features: core.FeatureVector{Price: 4000, EMA9: 3900, EMA20: 3800, RSI14: 25}, ReasonCodes: []string{"RULE_MATCHED"}}
	token, err := server.JournalReceipts.Issue("user-a", "session-a", entry)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{"receipt": token})
	for i := 0; i < 2; i++ {
		w := request("POST", path, string(body), true)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if len(store.items) != 2 || store.items[0].ID != "legacy" {
		t.Fatal("retry duplicated a record or replaced legacy data")
	}
	read := request("GET", path, "", true)
	var output struct {
		Items []records.Item `json:"items"`
	}
	if json.Unmarshal(read.Body.Bytes(), &output) != nil || len(output.Items) != 1 || strings.Contains(read.Body.String(), "net_pl") {
		t.Fatal("legacy trade was exposed as screening")
	}
	if store.owner != "user-a" || !strings.Contains(read.Header().Get("Cache-Control"), "no-store") {
		t.Fatal("journal privacy boundary missing")
	}
	before := store.writes
	for _, invalid := range []string{`{"receipt":"fake"}`, `{"receipt":""}`, `{"receipt":null}`, `{"symbol":"BBCA","price":1}`, `{"receipt":"fake","user_id":"user-b"}`, `{"receipt":"fake","data":{"price":9999}}`} {
		w := request("POST", path, invalid, true)
		if w.Code != 400 && w.Code != 422 {
			t.Fatal("unattested input accepted", w.Code)
		}
	}
	for _, binding := range [][2]string{{"user-b", "session-a"}, {"user-a", "session-b"}} {
		foreign, _ := server.JournalReceipts.Issue(binding[0], binding[1], entry)
		input, _ := json.Marshal(map[string]string{"receipt": foreign})
		assertErrorCode(t, request("POST", path, string(input), true), 422, "SCREENING_RECEIPT_INVALID")
	}
	if store.writes != before {
		t.Fatal("invalid receipt reached storage")
	}
	for _, method := range []string{"PUT", "DELETE"} {
		assertErrorCode(t, request(method, "/api/v1/journal/trades/11111111-1111-4111-8111-111111111111", `{}`, true), 410, "JOURNAL_SCREENING_ONLY")
	}
}
