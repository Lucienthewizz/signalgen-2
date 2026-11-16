// Package payments sells one paid month through Midtrans Snap. The browser
// only opens the payment page; access changes only after a notification whose
// signature is valid and whose status is confirmed with the Midtrans API.
package payments

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/subscription"
)

const Provider = "midtrans"

const (
	OrderPending = "pending"
	OrderPaid    = "paid"
	OrderFailed  = "failed"
	OrderExpired = "expired"
)

var (
	ErrNotConfigured   = errors.New("payments are not configured")
	ErrInvalidPlan     = errors.New("plan cannot be purchased")
	ErrOrderNotFound   = errors.New("payment order not found")
	ErrBadSignature    = errors.New("invalid notification signature")
	ErrAmountMismatch  = errors.New("payment amount does not match the order")
	ErrGateway         = errors.New("payment gateway unavailable")
	ErrAccountInactive = errors.New("account is not active")
)

type Order struct {
	ID        string    `json:"order_id"`
	UserID    string    `json:"-"`
	PlanCode  string    `json:"plan_code"`
	Amount    int       `json:"amount"`
	Currency  string    `json:"currency"`
	Status    string    `json:"status"`
	SnapToken string    `json:"-"`
	PaidAt    time.Time `json:"paid_at,omitzero"`
	CreatedAt time.Time `json:"created_at"`
}

type SnapResult struct {
	Token       string `json:"token"`
	RedirectURL string `json:"redirect_url"`
}

// Notification is the subset of the Midtrans HTTP notification used here.
type Notification struct {
	OrderID      string `json:"order_id"`
	StatusCode   string `json:"status_code"`
	GrossAmount  string `json:"gross_amount"`
	SignatureKey string `json:"signature_key"`
}

// Status is the Midtrans transaction status response.
type Status struct {
	OrderID           string `json:"order_id"`
	StatusCode        string `json:"status_code"`
	TransactionStatus string `json:"transaction_status"`
	FraudStatus       string `json:"fraud_status"`
	GrossAmount       string `json:"gross_amount"`
	Currency          string `json:"currency"`
	PaymentType       string `json:"payment_type"`
	TransactionID     string `json:"transaction_id"`
}

// OrderState maps a Midtrans status to the order status it implies.
func (s Status) OrderState() string {
	switch s.TransactionStatus {
	case "settlement":
		return OrderPaid
	case "capture":
		if s.FraudStatus == "" || s.FraudStatus == "accept" {
			return OrderPaid
		}
	case "deny", "cancel", "failure":
		return OrderFailed
	case "expire":
		return OrderExpired
	}
	return OrderPending
}

// Amount parses Midtrans "49000.00" into whole rupiah.
func (s Status) Amount() (int, bool) {
	value, err := strconv.ParseFloat(strings.TrimSpace(s.GrossAmount), 64)
	if err != nil || value <= 0 || value != math.Trunc(value) || value > math.MaxInt32 {
		return 0, false
	}
	return int(value), true
}

type Gateway interface {
	CreateSnap(ctx context.Context, order Order, customerEmail string) (SnapResult, error)
	Status(ctx context.Context, orderID string) (Status, error)
	VerifyNotification(n Notification) bool
}

type Store interface {
	CreateOrder(ctx context.Context, order Order) error
	AttachSnapToken(ctx context.Context, orderID, token string) error
	// Order returns an order owned by userID.
	Order(ctx context.Context, userID, orderID string) (Order, error)
	// ApplyStatus records a confirmed status. A first transition to paid
	// activates the subscription in the same transaction; repeats are no-ops.
	ApplyStatus(ctx context.Context, orderID string, status Status) (Order, error)
}

type Service struct {
	Gateway Gateway
	Store   Store
}

func (s *Service) Enabled() bool { return s != nil && s.Gateway != nil && s.Store != nil }

// Checkout creates a pending order with the server-side price and a Snap token.
func (s *Service) Checkout(ctx context.Context, userID, planCode, customerEmail string) (Order, SnapResult, error) {
	if !s.Enabled() {
		return Order{}, SnapResult{}, ErrNotConfigured
	}
	price := subscription.PriceForPlan(strings.TrimSpace(planCode))
	if price.Amount <= 0 || price.Currency != "IDR" {
		return Order{}, SnapResult{}, ErrInvalidPlan
	}
	id, err := newOrderID()
	if err != nil {
		return Order{}, SnapResult{}, err
	}
	order := Order{ID: id, UserID: userID, PlanCode: strings.TrimSpace(planCode), Amount: price.Amount, Currency: price.Currency, Status: OrderPending}
	if err := s.Store.CreateOrder(ctx, order); err != nil {
		return Order{}, SnapResult{}, err
	}
	snap, err := s.Gateway.CreateSnap(ctx, order, customerEmail)
	if err != nil {
		return Order{}, SnapResult{}, err
	}
	if err := s.Store.AttachSnapToken(ctx, order.ID, snap.Token); err != nil {
		return Order{}, SnapResult{}, err
	}
	return order, snap, nil
}

// HandleNotification verifies the signature, then trusts only the status read
// back from Midtrans, never the notification body itself.
func (s *Service) HandleNotification(ctx context.Context, n Notification) (Order, error) {
	if !s.Enabled() {
		return Order{}, ErrNotConfigured
	}
	if n.OrderID == "" || !s.Gateway.VerifyNotification(n) {
		return Order{}, ErrBadSignature
	}
	status, err := s.Gateway.Status(ctx, n.OrderID)
	if err != nil {
		return Order{}, err
	}
	if status.OrderID != n.OrderID {
		return Order{}, ErrBadSignature
	}
	return s.Store.ApplyStatus(ctx, n.OrderID, status)
}

// Refresh re-reads a pending order's status for its owner, so the page can
// update even if a notification is delayed.
func (s *Service) Refresh(ctx context.Context, userID, orderID string) (Order, error) {
	if !s.Enabled() {
		return Order{}, ErrNotConfigured
	}
	order, err := s.Store.Order(ctx, userID, orderID)
	if err != nil || order.Status != OrderPending {
		return order, err
	}
	status, err := s.Gateway.Status(ctx, orderID)
	if errors.Is(err, ErrOrderNotFound) {
		return order, nil // the payment page was not completed yet
	}
	if err != nil {
		return order, err
	}
	if status.OrderID != orderID {
		return order, nil
	}
	return s.Store.ApplyStatus(ctx, orderID, status)
}

func newOrderID() (string, error) {
	raw := make([]byte, 12)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return "sg-" + hex.EncodeToString(raw), nil
}
