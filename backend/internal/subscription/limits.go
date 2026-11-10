package subscription

import (
	"context"
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
		return ResourceLimits{CustomRules: 0, StockUniverses: 1}
	}
}

func EffectiveLimits(current Subscription, now time.Time) ResourceLimits {
	if (current.Status == StatusActive || current.Status == StatusTrialing) &&
		!now.Before(current.CurrentPeriodStart) && now.Before(current.CurrentPeriodEnd) &&
		(current.PlanCode == "analyst" || current.PlanCode == "pro") {
		return LimitsForPlan(current.PlanCode)
	}
	return LimitsForPlan("free")
}

// LockedLimits is called inside an owner-serialized creation transaction.
// Sharing the subscription row lock prevents a concurrent downgrade/cancel
// from changing the plan while a resource is inserted. No schema change needed.
func LockedLimits(ctx context.Context, tx pgx.Tx, owner string) (ResourceLimits, error) {
	policy, err := LockedAccess(ctx, tx, owner)
	return policy.Limits, err
}

func LockedAccess(ctx context.Context, tx pgx.Tx, owner string) (EffectiveAccess, error) {
	// A downgrade must not race resource creation/update across API instances.
	rows, err := tx.Query(ctx, `select user_id from signalgen.subscriptions where user_id=$1::uuid for share`, owner)
	if err != nil {
		return EffectiveAccess{}, err
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return EffectiveAccess{}, err
	}
	rows, err = tx.Query(ctx, `select user_id from signalgen.feature_grants where user_id=$1::uuid for share`, owner)
	if err != nil {
		return EffectiveAccess{}, err
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return EffectiveAccess{}, err
	}
	return ReadAccess(ctx, tx, owner)
}
