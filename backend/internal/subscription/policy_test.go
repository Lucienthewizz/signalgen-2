package subscription

import (
	"errors"
	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"slices"
	"testing"
)

func TestMVPAccessMatrix(t *testing.T) {
	for _, tc := range []struct {
		code                            string
		price, rules, universes, stocks int
		backtest, intraday, personal    bool
	}{
		{"free", 0, 0, 1, 3, false, false, false}, {"analyst", 49000, 10, 5, 10, false, true, true}, {"pro", 99000, 50, 20, 10, true, true, true},
	} {
		t.Run(tc.code, func(t *testing.T) {
			a := ResolveAccess(tc.code, nil)
			if a.PlanCode != tc.code || a.Limits.CustomRules != tc.rules || a.Limits.StockUniverses != tc.universes || a.Screening.MaxSymbols != tc.stocks {
				t.Fatalf("wrong policy: %+v", a)
			}
			if p := PriceForPlan(tc.code); p.Amount != tc.price || p.Currency != "IDR" || p.Period != "month" || p.Activation != "manual" {
				t.Fatalf("price: %+v", p)
			}
			if err := a.CheckScreening(core.BaselineRuleID, "1d", tc.stocks); err != nil {
				t.Fatal(err)
			}
			if !errors.Is(a.CheckScreening(core.BaselineRuleID, "1d", tc.stocks+1), ErrPlanLimit) {
				t.Fatal("extra stock accepted")
			}
			if (a.RequireFeature("backtest") == nil) != tc.backtest {
				t.Fatal("backtest permission")
			}
			if (a.RequireCustomRules() == nil) != tc.personal {
				t.Fatal("rule write permission")
			}
			for _, tf := range []string{"1m", "5m", "15m", "1h"} {
				if (a.CheckScreening(core.BaselineRuleID, tf, 1) == nil) != tc.intraday {
					t.Fatalf("interval %s", tf)
				}
			}
			if (a.CheckScreening("own-private-rule", "1d", 1) == nil) != tc.personal {
				t.Fatal("private rule screening")
			}
			if !errors.Is(a.CheckScreening(core.BaselineRuleID, "unsupported", 1), ErrPlanLimit) {
				t.Fatal("unsupported interval accepted")
			}
		})
	}
}
func TestOperatorGrantDoesNotRenameSubscription(t *testing.T) {
	a := ResolveAccess("free", []string{"screener"})
	if a.PlanCode != "free" || a.Source != "manual_grant" || a.Limits.CustomRules != 10 || a.Screening.MaxSymbols != 10 || a.CheckScreening("private", "1m", 10) != nil {
		t.Fatalf("lost compatible grant: %+v", a)
	}
	if a.RequireFeature("backtest") == nil {
		t.Fatal("screener grant silently added backtest")
	}
	a = ResolveAccess("free", []string{"backtest"})
	if a.RequireFeature("backtest") != nil || a.RequireCustomRules() == nil {
		t.Fatal("backtest-only grant changed screening rule permissions")
	}
	a = ResolveAccess("analyst", []string{"backtest"})
	if a.PlanCode != "analyst" || !slices.Contains(a.Features, "backtest") {
		t.Fatal("Analyst grandfather grant")
	}
	a = ResolveAccess("pro", []string{"screener", "backtest"})
	if a.Limits.CustomRules != 50 || a.Limits.StockUniverses != 20 {
		t.Fatal("grant reduced Pro capacity")
	}
	a = ResolveAccess("untrusted", []string{"admin"})
	if a.PlanCode != "free" || len(a.Features) != 1 || a.Source != "free" {
		t.Fatal("unknown metadata elevated access")
	}
}
