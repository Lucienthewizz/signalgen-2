package payments

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/subscription"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresStore struct{ DB *pgxpool.Pool }

const orderColumns = `id,user_id::text,plan_code,amount,currency,status,coalesce(snap_token,''),coalesce(paid_at,'epoch'::timestamptz),created_at`

func scanOrder(row pgx.Row) (Order, error) {
	var order Order
	err := row.Scan(&order.ID, &order.UserID, &order.PlanCode, &order.Amount, &order.Currency, &order.Status, &order.SnapToken, &order.PaidAt, &order.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Order{}, ErrOrderNotFound
	}
	if order.PaidAt.Equal(time.Unix(0, 0)) {
		order.PaidAt = time.Time{}
	}
	return order, err
}

func (s *PostgresStore) CreateOrder(ctx context.Context, order Order) error {
	_, err := s.DB.Exec(ctx, `insert into signalgen.payment_orders (id,user_id,plan_code,amount,currency,provider,status)
select $1,$2::uuid,$3,$4,$5,$6,'pending'
where exists(select 1 from signalgen.account_profiles where user_id=$2::uuid and status='active')`,
		order.ID, order.UserID, order.PlanCode, order.Amount, order.Currency, Provider)
	return err
}

func (s *PostgresStore) AttachSnapToken(ctx context.Context, orderID, token string) error {
	_, err := s.DB.Exec(ctx, `update signalgen.payment_orders set snap_token=$2,updated_at=now() where id=$1 and status='pending'`, orderID, token)
	return err
}

func (s *PostgresStore) Order(ctx context.Context, userID, orderID string) (Order, error) {
	return scanOrder(s.DB.QueryRow(ctx, `select `+orderColumns+` from signalgen.payment_orders where id=$1 and user_id=$2::uuid`, orderID, userID))
}

func (s *PostgresStore) ApplyStatus(ctx context.Context, orderID string, status Status) (Order, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return Order{}, err
	}
	defer tx.Rollback(ctx)
	order, err := scanOrder(tx.QueryRow(ctx, `select `+orderColumns+` from signalgen.payment_orders where id=$1 for update`, orderID))
	if err != nil {
		return Order{}, err
	}
	next, err := nextOrderState(order, status)
	if err != nil {
		return Order{}, err
	}
	if next == order.Status && next != OrderPending {
		return order, nil // already final; repeated notifications change nothing
	}
	if _, err := tx.Exec(ctx, `update signalgen.payment_orders set status=$2,provider_status=$3,payment_type=nullif($4,''),
provider_transaction_id=nullif($5,''),paid_at=case when $2='paid' then now() else null end,updated_at=now() where id=$1`,
		orderID, next, status.TransactionStatus, status.PaymentType, status.TransactionID); err != nil {
		return Order{}, err
	}
	if next == OrderPaid {
		if _, err := subscription.ActivatePaymentTx(ctx, tx, subscription.PaymentActivation{UserID: order.UserID, PlanCode: order.PlanCode, Provider: Provider, OrderID: order.ID}); err != nil {
			if errors.Is(err, subscription.ErrNotFound) {
				return Order{}, ErrAccountInactive
			}
			return Order{}, err
		}
	}
	updated, err := scanOrder(tx.QueryRow(ctx, `select `+orderColumns+` from signalgen.payment_orders where id=$1`, orderID))
	if err != nil {
		return Order{}, err
	}
	return updated, tx.Commit(ctx)
}

// nextOrderState decides the order's new status. A paid order never changes
// again, and a payment counts only if Midtrans reports the exact order amount.
func nextOrderState(order Order, status Status) (string, error) {
	if order.Status == OrderPaid {
		return OrderPaid, nil
	}
	next := status.OrderState()
	if next == OrderPaid {
		amount, ok := status.Amount()
		if !ok || amount != order.Amount || (status.Currency != "" && status.Currency != order.Currency) {
			return "", ErrAmountMismatch
		}
	}
	return next, nil
}

// Ready reports whether the payment_orders migration and runtime grants exist.
func (s *PostgresStore) Ready(ctx context.Context) error {
	var ready bool
	err := s.DB.QueryRow(ctx, `select to_regclass('signalgen.payment_orders') is not null
  and has_table_privilege(current_user,'signalgen.payment_orders','SELECT')
  and has_table_privilege(current_user,'signalgen.payment_orders','INSERT')
  and has_table_privilege(current_user,'signalgen.payment_orders','UPDATE')`).Scan(&ready)
	if err != nil {
		return fmt.Errorf("payments readiness: %w", err)
	}
	if !ready {
		return fmt.Errorf("payment_orders migration is not applied")
	}
	return nil
}
