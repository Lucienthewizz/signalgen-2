package account

import (
	"strings"
	"testing"
)

func TestManagementValidation(t *testing.T) {
	id := "00000000-0000-0000-0000-000000000001"
	if !ValidUserID(id) || ValidUserID("malformed") || ValidUserID("00000000_0000-0000-0000-000000000001") || ValidUserID("--000000-0000-0000-0000-000000000001") {
		t.Fatal("UUID validation")
	}
	for _, query := range []AccountQuery{{Limit: -1}, {Limit: 101}, {After: "sql'"}, {Role: "admin"}, {Status: "paid"}, {Search: strings.Repeat("x", 201)}, {Search: "mail\x00@example.test"}, {Search: "\xff"}} {
		if _, err := NormalizeAccountQuery(query); err == nil {
			t.Fatalf("accepted query %+v", query)
		}
	}
	if query, err := NormalizeAccountQuery(AccountQuery{}); err != nil || query.Limit != 25 {
		t.Fatal("default page size")
	}
	if query, err := NormalizeAccountQuery(AccountQuery{Search: " Member@Example.test "}); err != nil || query.Search != "Member@Example.test" {
		t.Fatal("normalized account search")
	}
	for _, input := range []StatusUpdate{
		{Status: "paid", ExpectedStatus: "active", Reason: "test"},
		{Status: "suspended", Reason: "test"},
		{Status: "suspended", ExpectedStatus: "active", Reason: " "},
		{Status: "suspended", ExpectedStatus: "active", Reason: strings.Repeat("x", 501)},
		{Status: "suspended", ExpectedStatus: "active", Reason: "password\nvalue"},
	} {
		if _, err := NormalizeStatusUpdate(input); err == nil {
			t.Fatalf("accepted update %+v", input)
		}
	}
	if input, err := NormalizeStatusUpdate(StatusUpdate{Status: "active", ExpectedStatus: "suspended", Reason: " reviewed "}); err != nil || input.Reason != "reviewed" {
		t.Fatal("normalized reason")
	}
	for _, query := range []AuditQuery{{UserID: "bad"}, {UserID: id, Before: -1}, {UserID: id, Limit: 101}} {
		if _, err := NormalizeAuditQuery(query); err == nil {
			t.Fatal("accepted audit query")
		}
	}
}
