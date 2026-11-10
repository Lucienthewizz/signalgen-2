package subscription

import (
	"context"
	"errors"
	"slices"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/jackc/pgx/v5"
)

var (
	ErrFeatureNotIncluded = errors.New("feature is not included in this plan")
	ErrPlanLimit          = errors.New("plan limit exceeded")
)

type ScreeningLimits struct {
	MaxSymbols      int      `json:"max_symbols"`
	Timeframes      []string `json:"timeframes"`
	SystemRulesOnly bool     `json:"system_rules_only"`
}

type EffectiveAccess struct {
	PlanCode  string          `json:"plan_code"`
	Source    string          `json:"source"`
	Features  []string        `json:"features"`
	Limits    ResourceLimits  `json:"limits"`
	Screening ScreeningLimits `json:"screening"`
}

type Pricing struct {
	Amount     int    `json:"amount"`
	Currency   string `json:"currency"`
	Period     string `json:"period"`
	Activation string `json:"activation"`
}

func PriceForPlan(code string) Pricing {
	amount := 0
	if code == "analyst" {
		amount = 49000
	}
	if code == "pro" {
		amount = 99000
	}
	return Pricing{Amount: amount, Currency: "IDR", Period: "month", Activation: "manual"}
}

// ResolveAccess is the single product-policy definition. Operator grants add
// explicit features/capacity without turning a Free account into a paid plan.
func ResolveAccess(code string, grants []string) EffectiveAccess {
	if code != "analyst" && code != "pro" {
		code = "free"
	}
	result := EffectiveAccess{PlanCode: code, Source: "free", Features: []string{"screener"}, Limits: LimitsForPlan(code), Screening: ScreeningLimits{MaxSymbols: 3, Timeframes: []string{"1d"}, SystemRulesOnly: true}}
	if code != "free" {
		result.Source = "subscription"
		result.Screening = paidScreening()
	}
	if code == "pro" {
		result.Features = append(result.Features, "backtest")
	}
	for _, feature := range grants {
		if feature != "screener" && feature != "backtest" {
			continue
		}
		result.Source = "manual_grant"
		if !slices.Contains(result.Features, feature) {
			result.Features = append(result.Features, feature)
		}
		// Existing grants retain their historical Analyst storage allowance.
		if result.Limits.CustomRules < 10 {
			result.Limits = LimitsForPlan("analyst")
		}
		if feature == "screener" {
			result.Screening = paidScreening()
		}
	}
	slices.Sort(result.Features)
	return result
}

func paidScreening() ScreeningLimits {
	return ScreeningLimits{MaxSymbols: 10, Timeframes: []string{"1m", "5m", "15m", "1h", "1d"}}
}
func (a EffectiveAccess) RequireFeature(feature string) error {
	if !slices.Contains(a.Features, feature) {
		return ErrFeatureNotIncluded
	}
	return nil
}
func (a EffectiveAccess) RequireCustomRules() error {
	if a.Limits.CustomRules == 0 || a.Screening.SystemRulesOnly {
		return ErrFeatureNotIncluded
	}
	return nil
}
func (a EffectiveAccess) CheckScreening(ruleID, timeframe string, count int) error {
	if err := a.RequireFeature("screener"); err != nil {
		return err
	}
	if a.Screening.SystemRulesOnly && ruleID != "" && ruleID != core.BaselineRuleID {
		return ErrFeatureNotIncluded
	}
	if timeframe == "" {
		timeframe = "1d"
	}
	if !slices.Contains(a.Screening.Timeframes, timeframe) || count > a.Screening.MaxSymbols {
		return ErrPlanLimit
	}
	return nil
}

type AccessProvider interface {
	EffectiveAccess(context.Context, string) (EffectiveAccess, error)
}
type accessQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// ReadAccess accepts both a pool and an open transaction. Resource writes use
// it under the existing per-owner advisory lock, with subscription row locking.
func ReadAccess(ctx context.Context, db accessQueryer, owner string) (EffectiveAccess, error) {
	var status, code string
	var grants []string
	err := db.QueryRow(ctx, `select profile.status,
 coalesce((select s.plan_code from signalgen.subscriptions s join signalgen.subscription_plans p on p.code=s.plan_code and p.active
 where s.user_id=profile.user_id and s.status in ('active','trialing') and s.current_period_start<=now() and s.current_period_end>now()),'free'),
 array(select g.feature from signalgen.feature_grants g where g.user_id=profile.user_id and g.revoked_at is null and g.valid_until>now())
 from signalgen.account_profiles profile where profile.user_id=$1::uuid`, owner).Scan(&status, &code, &grants)
	if errors.Is(err, pgx.ErrNoRows) {
		return EffectiveAccess{}, access.ErrAccountNotFound
	}
	if err != nil {
		return EffectiveAccess{}, err
	}
	if status != access.StatusActive {
		return EffectiveAccess{}, access.ErrAccountSuspended
	}
	return ResolveAccess(code, grants), nil
}

// Legacy stores and test adapters still enforce their original feature checks.
// The active Postgres runtime always implements AccessProvider and rechecks policy.
func CheckScreening(ctx context.Context, source any, owner, ruleID, timeframe string, count int) error {
	if p, ok := source.(AccessProvider); ok {
		a, err := p.EffectiveAccess(ctx, owner)
		if err != nil {
			return err
		}
		return a.CheckScreening(ruleID, timeframe, count)
	}
	return nil
}
