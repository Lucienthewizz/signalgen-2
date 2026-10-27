package records

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
)

const tradeJSON = `{"symbol":"BBCA","market":"IDX","currency":"IDR","side":"BUY","quantity":100,"entry_price":100.1,"exit_price":101.2,"entry_fee":1.25,"exit_fee":1.25,"entry_date":"2026-09-01","exit_date":"2026-09-02","book":"Trading journal","note":"Recorded manually"}`

func TestTradeValidationAndServerProfit(t *testing.T) {
	raw, err := NormalizeTrade([]byte(tradeJSON))
	if err != nil {
		t.Fatal(err)
	}
	var out Trade
	_ = json.Unmarshal(raw, &out)
	if *out.NetPL != 107.5 {
		t.Fatal(string(raw))
	}
	raw, err = NormalizeTrade([]byte(strings.Replace(tradeJSON, `"BUY"`, `"SELL"`, 1)))
	if err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal(raw, &out)
	if *out.NetPL != -112.5 {
		t.Fatal(string(raw))
	}
	for _, bad := range []string{
		strings.Replace(tradeJSON, `"quantity":100`, `"quantity":1`, 1),
		strings.Replace(tradeJSON, `"entry_price":100.1`, `"entry_price":-1`, 1),
		strings.Replace(tradeJSON, `"exit_date":"2026-09-02"`, `"exit_date":"2026-08-02"`, 1),
		strings.Replace(tradeJSON, `"exit_price":101.2`, `"exit_price":null`, 1),
		strings.Replace(tradeJSON, `"currency":"IDR"`, `"currency":"USD"`, 1),
		strings.Replace(tradeJSON, `"note":`, `"net_pl":100000,"note":`, 1),
		strings.Replace(tradeJSON, `"note":`, `"user_id":"another-account","note":`, 1),
		tradeJSON + `{}`, "null", `{}`,
	} {
		if _, e := NormalizeTrade([]byte(bad)); e == nil {
			t.Fatalf("accepted %s", bad)
		}
	}
}
func TestArchiveWhitelistedUnverifiedSnapshot(t *testing.T) {
	var a Archive
	a.ID = "11111111-1111-4111-8111-111111111111"
	a.FormatVersion = 1
	a.Title = "Analysis"
	a.SavedAt = "2026-09-01T00:00:00Z"
	a.Currency = "IDR"
	a.Source.Universe.Symbols = []string{"BBCA.JK"}
	a.Result.SchemaVersion = core.BacktestSchemaVersion
	a.Result.PolicyVersion = core.BacktestPolicyVersion
	a.Result.Execution = "portable_go_backtest"
	a.Result.Config = core.DefaultBacktestConfig()
	a.Result.Config.From = "2026-08-01"
	a.Result.Config.To = "2026-09-01"
	a.Result.Horizons = []core.BacktestHorizon{{Step: 1}}
	raw, _ := json.Marshal(a)
	if _, e := NormalizeArchive(raw, a.ID); e != nil {
		t.Fatal(e, string(raw))
	}
	for _, bad := range []string{strings.Replace(string(raw), `"title":`, `"access_token":"secret","title":`, 1), strings.Replace(string(raw), core.BacktestPolicyVersion, "unknown", 1), string(raw) + `{}`} {
		if _, e := NormalizeArchive([]byte(bad), a.ID); e == nil {
			t.Fatal("accepted unsafe archive")
		}
	}
}
