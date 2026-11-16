package subscription

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

// PaymentActivation grants one paid month after a payment adapter has
// verified the payment. It runs inside the adapter's transaction so the order
// and the subscription change commit together.
type PaymentActivation struct {
	UserID   string
	PlanCode string
	Provider string
	OrderID  string
}

// ActivatePaymentTx adds one month of the paid plan. Paying again for the
// active plan extends it from its current end, so remaining days are kept.
// Paying for a different plan, or after expiry, starts a new month now.
func ActivatePaymentTx(ctx context.Context, tx pgx.Tx, request PaymentActivation) (Subscription, error) {
	request.UserID = strings.TrimSpace(request.UserID)
	request.PlanCode = strings.TrimSpace(request.PlanCode)
	request.Provider = strings.TrimSpace(request.Provider)
	request.OrderID = strings.TrimSpace(request.OrderID)
	if request.UserID == "" || request.Provider == "" || request.OrderID == "" || PriceForPlan(request.PlanCode).Amount <= 0 {
		return Subscription{}, ErrInvalidValue
	}
	var targetActive, planActive bool
	if err := tx.QueryRow(ctx, `select exists(select 1 from signalgen.account_profiles where user_id=$1::uuid and status='active')`, request.UserID).Scan(&targetActive); err != nil {
		return Subscription{}, err
	}
	if !targetActive {
		return Subscription{}, ErrNotFound
	}
	if err := tx.QueryRow(ctx, `select exists(select 1 from signalgen.subscription_plans where code=$1 and active)`, request.PlanCode).Scan(&planActive); err != nil {
		return Subscription{}, err
	}
	if !planActive {
		return Subscription{}, ErrPlanNotFound
	}
	before, _, err := subscriptionJSONForUpdate(ctx, tx, request.UserID)
	if err != nil {
		return Subscription{}, err
	}
	action := "subscription.activate"
	if before != nil {
		action = "subscription.change_plan"
	}
	_, err = tx.Exec(ctx, `
insert into signalgen.subscriptions
  (user_id,plan_code,status,current_period_start,current_period_end,cancel_at_period_end,
   source,provider,provider_subscription_ref,updated_at)
values ($1::uuid,$2,'active',now(),now() + interval '1 month',false,'payment_provider',$3,$4,now())
on conflict (user_id) do update set
  current_period_start = case
    when subscriptions.plan_code=excluded.plan_code and subscriptions.status in ('trialing','active')
      and subscriptions.current_period_end>now() then subscriptions.current_period_start
    else now() end,
  current_period_end = case
    when subscriptions.plan_code=excluded.plan_code and subscriptions.status in ('trialing','active')
      and subscriptions.current_period_end>now() then subscriptions.current_period_end + interval '1 month'
    else now() + interval '1 month' end,
  plan_code=excluded.plan_code,status='active',cancel_at_period_end=false,
  source='payment_provider',provider=excluded.provider,provider_customer_ref=null,
  provider_subscription_ref=excluded.provider_subscription_ref,updated_at=now()`,
		request.UserID, request.PlanCode, request.Provider, request.OrderID)
	if err != nil {
		return Subscription{}, fmt.Errorf("activate paid subscription: %w", err)
	}
	after, err := subscriptionJSON(ctx, tx, request.UserID)
	if err != nil {
		return Subscription{}, err
	}
	reason := "payment " + request.Provider + " order " + request.OrderID
	if err := insertEvent(ctx, tx, request.UserID, "payment:"+request.Provider, action, reason, request.OrderID, before, after); err != nil {
		return Subscription{}, err
	}
	return scanSubscription(tx.QueryRow(ctx, subscriptionSelect+` where subscription.user_id=$1::uuid`, request.UserID))
}
