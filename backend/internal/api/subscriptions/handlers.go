package subscriptionsapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/subscription"
)

// ListSubscriptionPlans exposes only product capabilities. Prices and checkout
// are intentionally absent until a payment provider and commercial terms are
// approved.
func (server *Handler) ListSubscriptionPlans(writer http.ResponseWriter, request *http.Request) {
	plans, err := server.Subscriptions.Plans(request.Context())
	if err != nil {
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Daftar paket belum dapat dibaca.")
		return
	}
	shared.WriteJSON(writer, http.StatusOK, map[string]interface{}{"items": plans})
}

// CurrentSubscription is owner-scoped by deriving user ID from the verified
// bearer/app-session pair rather than accepting user_id from the request.
func (server *Handler) CurrentSubscription(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	current, err := server.Subscriptions.Current(request.Context(), principal.ID)
	if errors.Is(err, subscription.ErrNotFound) {
		shared.WriteJSON(writer, http.StatusOK, map[string]interface{}{"subscription": nil})
		return
	}
	if err != nil {
		writeSubscriptionError(writer, request, err)
		return
	}
	current.UserID = ""
	shared.WriteJSON(writer, http.StatusOK, map[string]interface{}{"subscription": current})
}

// CancelCurrentSubscription lets a user cancel only their own subscription.
// It never accepts a user ID and never activates paid access.
func (server *Handler) CancelCurrentSubscription(writer http.ResponseWriter, request *http.Request) {
	principal, _, _, ok := server.RequireAppSession(writer, request)
	if !ok {
		return
	}
	if !server.AllowRate(writer, request, "subscription:cancel", principal.ID) {
		return
	}
	var input struct {
		AtPeriodEnd bool   `json:"at_period_end"`
		Reason      string `json:"reason"`
	}
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Body pembatalan subscription tidak valid.")
		return
	}
	if strings.TrimSpace(input.Reason) == "" {
		input.Reason = "user requested cancellation"
	}
	current, err := server.Subscriptions.Cancel(request.Context(), subscription.CancelRequest{
		UserID: principal.ID, RequestID: shared.RequestID(request.Context()),
		AtPeriodEnd: input.AtPeriodEnd, Reason: input.Reason,
	})
	if err != nil {
		writeSubscriptionError(writer, request, err)
		return
	}
	current.UserID = ""
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusOK, map[string]interface{}{"subscription": current})
}

// ActivateOperatorSubscription is the temporary trusted activation path for
// the MVP. A future verified payment webhook may call the same domain service;
// a browser checkout response must never activate entitlement directly.
func (server *Handler) ActivateOperatorSubscription(writer http.ResponseWriter, request *http.Request) {
	principal, _, ok := server.RequireOperator(writer, request)
	if !ok {
		return
	}
	if !server.AllowRate(writer, request, "operator:subscription", principal.ID) {
		return
	}
	var input struct {
		UserID           string    `json:"user_id"`
		PlanCode         string    `json:"plan_code"`
		CurrentPeriodEnd time.Time `json:"current_period_end"`
		Reason           string    `json:"reason"`
	}
	if err := shared.DecodeJSON(request, &input); err != nil {
		shared.WriteJSONInputError(writer, request, err, "Body subscription tidak valid.")
		return
	}
	current, err := server.Subscriptions.ActivateManual(request.Context(), subscription.ActivateRequest{
		Actor: principal.ID, RequestID: shared.RequestID(request.Context()),
		UserID: input.UserID, PlanCode: input.PlanCode,
		CurrentPeriodEnd: input.CurrentPeriodEnd, Reason: input.Reason,
	})
	if err != nil {
		writeSubscriptionError(writer, request, err)
		return
	}
	writer.Header().Set("Cache-Control", "private, no-store")
	shared.WriteJSON(writer, http.StatusCreated, map[string]interface{}{"subscription": current})
}

func writeSubscriptionError(writer http.ResponseWriter, request *http.Request, err error) {
	switch {
	case errors.Is(err, subscription.ErrNotFound):
		shared.WriteError(writer, request, http.StatusNotFound, "SUBSCRIPTION_NOT_FOUND", "Subscription belum tersedia untuk akun ini.")
	case errors.Is(err, subscription.ErrPlanNotFound):
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "SUBSCRIPTION_PLAN_INVALID", "Paket subscription tidak tersedia.")
	case errors.Is(err, subscription.ErrInvalidValue):
		shared.WriteError(writer, request, http.StatusUnprocessableEntity, "INVALID_REQUEST", "Data subscription tidak valid.")
	case errors.Is(err, subscription.ErrInvalidState):
		shared.WriteError(writer, request, http.StatusConflict, "SUBSCRIPTION_STATE_INVALID", "Subscription tidak dapat dibatalkan dari status saat ini.")
	default:
		shared.WriteError(writer, request, http.StatusServiceUnavailable, "SERVICE_UNAVAILABLE", "Subscription belum dapat diproses.")
	}
}
