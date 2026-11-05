package journal

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
)

func TestReceiptBindingIntegrityExpiryAndRestart(t *testing.T) {
	issuer, err := NewIssuer()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 5, 0, 0, 0, 0, time.UTC)
	issuer.now = func() time.Time { return now }
	entry := Entry{Symbol: "BBCA.JK", Market: "IDX", Currency: "IDR", RuleID: "rule-a", RuleName: "RSI rule", DefinitionHash: "hash-a", Timeframe: "5m", CandleAt: now.Format(time.RFC3339), Matched: true, SignalType: "BUY", Price: 4000, Features: core.FeatureVector{Price: 4000, EMA9: 3900, EMA20: 3800, RSI14: 25}, ReasonCodes: []string{"RULE_MATCHED"}}
	token, err := issuer.Issue("owner-a", "session-a", entry)
	if err != nil {
		t.Fatal(err)
	}
	first, err := issuer.Verify(token, "owner-a", "session-a")
	if err != nil {
		t.Fatal(err)
	}
	again, err := issuer.Verify(token, "owner-a", "session-a")
	if err != nil || first.ID != again.ID || first.Data.Price != 4000 {
		t.Fatal("receipt changed on retry")
	}
	if _, err = issuer.Verify(token, "owner-b", "session-a"); err == nil {
		t.Fatal("foreign owner accepted")
	}
	if _, err = issuer.Verify(token, "owner-a", "session-b"); err == nil {
		t.Fatal("foreign session accepted")
	}
	payload, signature, _ := strings.Cut(token, ".")
	raw, _ := base64.RawURLEncoding.DecodeString(payload)
	forged := base64.RawURLEncoding.EncodeToString([]byte(strings.Replace(string(raw), `"price":4000`, `"price":9999`, 1))) + "." + signature
	if _, err = issuer.Verify(forged, "owner-a", "session-a"); err == nil {
		t.Fatal("tampered price accepted")
	}
	other, _ := NewIssuer()
	if _, err = other.Verify(token, "owner-a", "session-a"); err == nil {
		t.Fatal("old process receipt accepted")
	}
	now = now.Add(ReceiptLifetime)
	if _, err = issuer.Verify(token, "owner-a", "session-a"); err == nil {
		t.Fatal("expired receipt accepted")
	}
	entry.Matched = false
	if _, err = issuer.Issue("owner-a", "session-a", entry); err == nil {
		t.Fatal("no-match receipt issued")
	}
	for _, invalid := range []string{"", "a.b.c", "a.%", strings.Repeat("x", MaxReceiptBytes+1)} {
		if _, err = issuer.Verify(invalid, "owner-a", "session-a"); err == nil {
			t.Fatal("malformed receipt accepted")
		}
	}
}
