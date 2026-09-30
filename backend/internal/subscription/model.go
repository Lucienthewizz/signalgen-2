// Package subscription owns SignalGen plan and subscription lifecycle state.
// Payment providers are adapters outside this package; a browser can never
// activate its own paid subscription.
package subscription

import (
	"errors"
	"time"
)

const (
	StatusTrialing = "trialing"
	StatusActive   = "active"
	StatusPastDue  = "past_due"
	StatusCanceled = "canceled"
	StatusExpired  = "expired"
)

var (
	ErrNotFound     = errors.New("subscription not found")
	ErrInvalidValue = errors.New("invalid subscription value")
	ErrPlanNotFound = errors.New("subscription plan not found")
	ErrInvalidState = errors.New("invalid subscription state")
)

type Plan struct {
	Code        string   `json:"code"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Features    []string `json:"features"`
}

type Subscription struct {
	ID                 string    `json:"id"`
	UserID             string    `json:"user_id,omitempty"`
	PlanCode           string    `json:"plan_code"`
	PlanName           string    `json:"plan_name"`
	Status             string    `json:"status"`
	Features           []string  `json:"features"`
	CurrentPeriodStart time.Time `json:"current_period_start"`
	CurrentPeriodEnd   time.Time `json:"current_period_end"`
	CancelAtPeriodEnd  bool      `json:"cancel_at_period_end"`
	Source             string    `json:"source"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

type ActivateRequest struct {
	Actor            string
	RequestID        string
	UserID           string
	PlanCode         string
	CurrentPeriodEnd time.Time
	Reason           string
}

type CancelRequest struct {
	UserID      string
	RequestID   string
	AtPeriodEnd bool
	Reason      string
}
