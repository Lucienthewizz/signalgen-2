package subscription

import (
	"testing"
	"time"
)

func TestApprovedPlanLimits(t *testing.T) {
	if got := LimitsForPlan("analyst"); got.CustomRules != 10 || got.StockUniverses != 5 {
		t.Fatalf("analyst: %+v", got)
	}
	if got := LimitsForPlan("pro"); got.CustomRules != 50 || got.StockUniverses != 20 {
		t.Fatalf("pro: %+v", got)
	}
	if got := LimitsForPlan("untrusted"); got.CustomRules != 0 {
		t.Fatal("unknown plan must not gain custom rules")
	}
}
func TestOnlyCurrentPaidSubscriptionGetsProCapacity(t *testing.T) {
	now := time.Date(2026, 10, 13, 0, 0, 0, 0, time.UTC)
	sub := Subscription{PlanCode: "pro", Status: StatusActive, CurrentPeriodStart: now.Add(-time.Hour), CurrentPeriodEnd: now.Add(time.Hour)}
	if EffectiveLimits(sub, now).CustomRules != 50 {
		t.Fatal("active Pro missing capacity")
	}
	sub.CancelAtPeriodEnd = true
	if EffectiveLimits(sub, now).CustomRules != 50 {
		t.Fatal("scheduled cancellation must retain capacity")
	}
	for _, status := range []string{StatusCanceled, StatusExpired, StatusPastDue} {
		sub.Status = status
		if EffectiveLimits(sub, now).CustomRules != 10 {
			t.Fatalf("inactive %s must not keep Pro capacity", status)
		}
	}
	sub.Status = StatusActive
	if EffectiveLimits(sub, sub.CurrentPeriodEnd).CustomRules != 10 {
		t.Fatal("expiry boundary")
	}
	if EffectiveLimits(sub, sub.CurrentPeriodStart.Add(-time.Second)).CustomRules != 10 {
		t.Fatal("future subscription")
	}
}
