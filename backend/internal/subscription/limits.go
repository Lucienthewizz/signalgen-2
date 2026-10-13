package subscription

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// ResourceLimits are capacities, not permission grants. Feature checks remain
// authoritative and system rules never consume the custom-rule allowance.
type ResourceLimits struct {
	CustomRules    int `json:"custom_rules"`
	StockUniverses int `json:"stock_universes"`
}

func LimitsForPlan(code string) ResourceLimits {
	switch code {
	case "pro":
		return ResourceLimits{CustomRules: 50, StockUniverses: 20}
	case "analyst":
		return ResourceLimits{CustomRules: 10, StockUniverses: 5}
	default:
		return ResourceLimits{CustomRules: 0, StockUniverses: 5}
	}
}

func EffectiveLimits(current Subscription, now time.Time) ResourceLimits {
	if (current.Status == StatusActive || current.Status == StatusTrialing) &&
		!now.Before(current.CurrentPeriodStart) && now.Before(current.CurrentPeriodEnd) &&
		(current.PlanCode == "analyst" || current.PlanCode == "pro") {
		return LimitsForPlan(current.PlanCode)
	}
	// Preserve capacity for existing operator grants. This does not unlock the
	// screener: RequireFeature still denies callers without effective access.
	return LimitsForPlan("analyst")
}

// LockedLimits is called inside an owner-serialized creation transaction.
// Sharing the subscription row lock prevents a concurrent downgrade/cancel
// from changing the plan while a resource is inserted. No schema change needed.
func LockedLimits(ctx context.Context, tx pgx.Tx, owner string) (ResourceLimits, error) {
	var code string
	err := tx.QueryRow(ctx, `select subscription.plan_code
from signalgen.subscriptions subscription
join signalgen.subscription_plans plan on plan.code=subscription.plan_code and plan.active
where subscription.user_id=$1::uuid and subscription.status in ('active','trialing')
and subscription.current_period_start<=now() and subscription.current_period_end>now()
for share of subscription`, owner).Scan(&code)
	if errors.Is(err, pgx.ErrNoRows) {
		return LimitsForPlan("analyst"), nil
	}
	if err != nil {
		return ResourceLimits{}, err
	}
	if code != "pro" && code != "analyst" {
		code = "analyst"
	}
	return LimitsForPlan(code), nil
}
