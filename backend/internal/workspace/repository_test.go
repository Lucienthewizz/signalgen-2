package workspace

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestValidState(t *testing.T) {
	for _, test := range []struct {
		kind, data string
		valid      bool
	}{
		{"watchlist", `["BBCA","TLKM"]`, true}, {"watchlist", `[]`, true},
		{"watchlist", `["<script>"]`, false}, {"watchlist", `["bbca"]`, false},
		{"monitor-history", `[{"run":{"features":{"rsi14":54}}}]`, true},
		{"rule-draft", `{"definition":{"name":"Contoh","conditions":[]}}`, true},
		{"rule-draft", `{"password":"never store"}`, false},
		{"screener-preferences", `{"access_token":"secret"}`, false},
		{"unknown", `{}`, false}, {"watchlist", `null`, true},
		{"monitor-history", `{}`, false}, {"rule-draft", `[]`, false},
	} {
		if got := Valid(test.kind, json.RawMessage(test.data)); got != test.valid {
			t.Errorf("%s %s: %v", test.kind, test.data, got)
		}
	}
	if Valid("rule-draft", json.RawMessage(`{"value":"`+strings.Repeat("a", MaxData)+`"}`)) {
		t.Fatal("oversized state accepted")
	}
	if Valid("monitor-history", json.RawMessage(strings.Repeat("[", 20)+"0"+strings.Repeat("]", 20))) {
		t.Fatal("unbounded nesting")
	}
}
