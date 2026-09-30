package subscription

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresRepository struct{ db *pgxpool.Pool }

func NewPostgresRepository(db *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (store *PostgresRepository) Plans(ctx context.Context) ([]Plan, error) {
	rows, err := store.db.Query(ctx, `
select plan.code,plan.name,plan.description,
  coalesce(array_agg(feature.feature order by feature.feature)
    filter (where feature.feature is not null),'{}')
from signalgen.subscription_plans plan
left join signalgen.subscription_plan_features feature on feature.plan_code=plan.code
where plan.active
group by plan.code,plan.name,plan.description
order by plan.code`)
	if err != nil {
		return nil, fmt.Errorf("list subscription plans: %w", err)
	}
	defer rows.Close()
	plans := make([]Plan, 0)
	for rows.Next() {
		var plan Plan
		if err := rows.Scan(&plan.Code, &plan.Name, &plan.Description, &plan.Features); err != nil {
			return nil, err
		}
		plans = append(plans, plan)
	}
	return plans, rows.Err()
}

func (store *PostgresRepository) Current(ctx context.Context, userID string) (Subscription, error) {
	if strings.TrimSpace(userID) == "" {
		return Subscription{}, ErrInvalidValue
	}
	return scanSubscription(store.db.QueryRow(ctx, subscriptionSelect+` where subscription.user_id=$1::uuid`, userID))
}

func (store *PostgresRepository) ActivateManual(ctx context.Context, request ActivateRequest) (Subscription, error) {
	request.Actor = strings.TrimSpace(request.Actor)
	request.RequestID = strings.TrimSpace(request.RequestID)
	request.UserID = strings.TrimSpace(request.UserID)
	request.PlanCode = strings.TrimSpace(request.PlanCode)
	request.Reason = strings.TrimSpace(request.Reason)
	if request.Actor == "" || request.RequestID == "" || request.UserID == "" || request.PlanCode == "" || request.Reason == "" || !request.CurrentPeriodEnd.After(time.Now()) {
		return Subscription{}, ErrInvalidValue
	}
	tx, err := store.db.Begin(ctx)
	if err != nil {
		return Subscription{}, err
	}
	defer tx.Rollback(ctx)
	var actorAllowed, targetActive, planActive bool
	if err := tx.QueryRow(ctx, `select exists(select 1 from signalgen.account_profiles where user_id=$1::uuid and role='operator' and status='active')`, request.Actor).Scan(&actorAllowed); err != nil {
		return Subscription{}, err
	}
	if !actorAllowed {
		return Subscription{}, ErrInvalidValue
	}
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
	before, err := subscriptionJSON(ctx, tx, request.UserID)
	if err != nil {
		return Subscription{}, err
	}
	action := "subscription.activate"
	if before != nil {
		action = "subscription.change_plan"
	}
	_, err = tx.Exec(ctx, `
insert into signalgen.subscriptions
  (user_id,plan_code,status,current_period_start,current_period_end,cancel_at_period_end,source,updated_at)
values ($1::uuid,$2,'active',now(),$3,false,'manual',now())
on conflict (user_id) do update set
  plan_code=excluded.plan_code,status='active',current_period_start=now(),
  current_period_end=excluded.current_period_end,cancel_at_period_end=false,
  source='manual',provider=null,provider_customer_ref=null,
  provider_subscription_ref=null,updated_at=now()`, request.UserID, request.PlanCode, request.CurrentPeriodEnd.UTC())
	if err != nil {
		return Subscription{}, fmt.Errorf("activate subscription: %w", err)
	}
	after, err := subscriptionJSON(ctx, tx, request.UserID)
	if err != nil {
		return Subscription{}, err
	}
	if err := insertEvent(ctx, tx, request.UserID, request.Actor, action, request.Reason, request.RequestID, before, after); err != nil {
		return Subscription{}, err
	}
	result, err := scanSubscription(tx.QueryRow(ctx, subscriptionSelect+` where subscription.user_id=$1::uuid`, request.UserID))
	if err != nil {
		return Subscription{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Subscription{}, err
	}
	return result, nil
}

func (store *PostgresRepository) Cancel(ctx context.Context, request CancelRequest) (Subscription, error) {
	request.UserID = strings.TrimSpace(request.UserID)
	request.RequestID = strings.TrimSpace(request.RequestID)
	request.Reason = strings.TrimSpace(request.Reason)
	if request.UserID == "" || request.RequestID == "" || request.Reason == "" {
		return Subscription{}, ErrInvalidValue
	}
	tx, err := store.db.Begin(ctx)
	if err != nil {
		return Subscription{}, err
	}
	defer tx.Rollback(ctx)
	before, status, err := subscriptionJSONForUpdate(ctx, tx, request.UserID)
	if err != nil {
		return Subscription{}, err
	}
	if before == nil {
		return Subscription{}, ErrNotFound
	}
	if status == StatusCanceled || status == StatusExpired {
		return Subscription{}, ErrInvalidState
	}
	action := "subscription.cancel_now"
	if request.AtPeriodEnd {
		action = "subscription.cancel_scheduled"
		_, err = tx.Exec(ctx, `update signalgen.subscriptions set cancel_at_period_end=true,updated_at=now() where user_id=$1::uuid`, request.UserID)
	} else {
		_, err = tx.Exec(ctx, `update signalgen.subscriptions set status='canceled',cancel_at_period_end=false,updated_at=now() where user_id=$1::uuid`, request.UserID)
	}
	if err != nil {
		return Subscription{}, fmt.Errorf("cancel subscription: %w", err)
	}
	after, err := subscriptionJSON(ctx, tx, request.UserID)
	if err != nil {
		return Subscription{}, err
	}
	if err := insertEvent(ctx, tx, request.UserID, request.UserID, action, request.Reason, request.RequestID, before, after); err != nil {
		return Subscription{}, err
	}
	result, err := scanSubscription(tx.QueryRow(ctx, subscriptionSelect+` where subscription.user_id=$1::uuid`, request.UserID))
	if err != nil {
		return Subscription{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Subscription{}, err
	}
	return result, nil
}

const subscriptionSelect = `
select subscription.id,subscription.user_id::text,subscription.plan_code,plan.name,
  case
    when subscription.status in ('trialing','active')
      and subscription.current_period_end <= now() then 'expired'
    else subscription.status
  end,
  coalesce(array(select feature from signalgen.subscription_plan_features
    where plan_code=subscription.plan_code order by feature),'{}'),
  subscription.current_period_start,subscription.current_period_end,
  subscription.cancel_at_period_end,subscription.source,
  subscription.created_at,subscription.updated_at
from signalgen.subscriptions subscription
join signalgen.subscription_plans plan on plan.code=subscription.plan_code`

type rowScanner interface{ Scan(dest ...any) error }

func scanSubscription(row rowScanner) (Subscription, error) {
	var result Subscription
	err := row.Scan(&result.ID, &result.UserID, &result.PlanCode, &result.PlanName,
		&result.Status, &result.Features, &result.CurrentPeriodStart,
		&result.CurrentPeriodEnd, &result.CancelAtPeriodEnd, &result.Source,
		&result.CreatedAt, &result.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Subscription{}, ErrNotFound
	}
	if err != nil {
		return Subscription{}, err
	}
	return result, nil
}

func subscriptionJSON(ctx context.Context, tx pgx.Tx, userID string) (json.RawMessage, error) {
	var value json.RawMessage
	err := tx.QueryRow(ctx, `select to_jsonb(subscription) from signalgen.subscriptions subscription where user_id=$1::uuid`, userID).Scan(&value)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return value, err
}

func subscriptionJSONForUpdate(ctx context.Context, tx pgx.Tx, userID string) (json.RawMessage, string, error) {
	var value json.RawMessage
	var status string
	err := tx.QueryRow(ctx, `select to_jsonb(subscription),
case when status in ('trialing','active') and current_period_end<=now() then 'expired' else status end
from signalgen.subscriptions subscription where user_id=$1::uuid for update`, userID).Scan(&value, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", nil
	}
	return value, status, err
}

func insertEvent(ctx context.Context, tx pgx.Tx, userID, actor, action, reason, requestID string, before, after json.RawMessage) error {
	var subscriptionID string
	if err := tx.QueryRow(ctx, `select id from signalgen.subscriptions where user_id=$1::uuid`, userID).Scan(&subscriptionID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `insert into signalgen.subscription_events
  (subscription_id,user_id,actor,action,reason,request_id,before_json,after_json)
values ($1,$2::uuid,$3,$4,$5,$6,$7,$8)`, subscriptionID, userID, actor, action, reason, requestID, before, after)
	return err
}
