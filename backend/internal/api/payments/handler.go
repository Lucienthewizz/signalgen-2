// Package paymentsapi exposes Midtrans checkout to the signed-in owner and a
// public notification endpoint that only Midtrans can satisfy.
package paymentsapi

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/api/shared"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/payments"
)

type Handler struct {
	*shared.Context
	Payments *payments.Service
}

// Checkout creates an order for one month of a paid plan and returns the
// Snap token. It never changes access by itself.
func (h *Handler) Checkout(w http.ResponseWriter, r *http.Request) {
	principal, _, _, ok := h.RequireAppSession(w, r)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	if !h.Payments.Enabled() {
		shared.WriteError(w, r, http.StatusServiceUnavailable, "PAYMENTS_UNAVAILABLE", "Pembayaran online belum diaktifkan.")
		return
	}
	if !h.AllowRate(w, r, "payments:checkout", principal.ID) {
		return
	}
	var input struct {
		PlanCode string `json:"plan_code"`
	}
	if err := shared.DecodeJSON(r, &input); err != nil {
		shared.WriteJSONInputError(w, r, err, "Pilih paket yang ingin dibeli.")
		return
	}
	order, snap, err := h.Payments.Checkout(r.Context(), principal.ID, input.PlanCode, principal.Email)
	switch {
	case errors.Is(err, payments.ErrInvalidPlan):
		shared.WriteError(w, r, http.StatusUnprocessableEntity, "SUBSCRIPTION_PLAN_INVALID", "Paket ini tidak dapat dibeli.")
		return
	case err != nil:
		log.Printf("payments: checkout failed: %v", err)
		shared.WriteError(w, r, http.StatusBadGateway, "PAYMENT_GATEWAY_UNAVAILABLE", "Halaman pembayaran belum dapat dibuka. Coba lagi sebentar.")
		return
	}
	shared.WriteJSON(w, http.StatusCreated, map[string]any{"order": order, "snap_token": snap.Token, "redirect_url": snap.RedirectURL})
}

// Order returns the owner's order and refreshes a pending one from Midtrans.
func (h *Handler) Order(w http.ResponseWriter, r *http.Request) {
	principal, _, _, ok := h.RequireAppSession(w, r)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	if !h.Payments.Enabled() {
		shared.WriteError(w, r, http.StatusServiceUnavailable, "PAYMENTS_UNAVAILABLE", "Pembayaran online belum diaktifkan.")
		return
	}
	order, err := h.Payments.Refresh(r.Context(), principal.ID, r.PathValue("id"))
	if errors.Is(err, payments.ErrOrderNotFound) {
		shared.WriteError(w, r, http.StatusNotFound, "PAYMENT_ORDER_NOT_FOUND", "Pesanan tidak ditemukan.")
		return
	}
	if err != nil && order.ID == "" {
		log.Printf("payments: order refresh failed: %v", err)
		shared.WriteError(w, r, http.StatusBadGateway, "PAYMENT_GATEWAY_UNAVAILABLE", "Status pembayaran belum dapat diperiksa.")
		return
	}
	shared.WriteJSON(w, http.StatusOK, map[string]any{"order": order})
}

// MidtransNotification accepts Midtrans HTTP notifications. A bad signature
// is rejected; otherwise the status is re-read from Midtrans before use.
func (h *Handler) MidtransNotification(w http.ResponseWriter, r *http.Request) {
	if !h.Payments.Enabled() {
		shared.WriteError(w, r, http.StatusServiceUnavailable, "PAYMENTS_UNAVAILABLE", "Payments are not configured.")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	var notification payments.Notification
	if err != nil || json.Unmarshal(raw, &notification) != nil {
		shared.WriteError(w, r, http.StatusBadRequest, "INVALID_REQUEST", "Invalid notification.")
		return
	}
	order, err := h.Payments.HandleNotification(r.Context(), notification)
	switch {
	case errors.Is(err, payments.ErrBadSignature):
		shared.WriteError(w, r, http.StatusForbidden, "INVALID_SIGNATURE", "Invalid notification signature.")
	case errors.Is(err, payments.ErrAmountMismatch):
		// Never activate; acknowledge so Midtrans stops retrying, and log it.
		log.Printf("payments: amount mismatch for order %s; access not changed", notification.OrderID)
		shared.WriteJSON(w, http.StatusOK, map[string]any{"status": "rejected"})
	case errors.Is(err, payments.ErrOrderNotFound):
		// Dashboard test notifications use unknown order IDs; acknowledge them.
		shared.WriteJSON(w, http.StatusOK, map[string]any{"status": "ignored"})
	case err != nil:
		// Any other failure returns 5xx so Midtrans retries the notification.
		log.Printf("payments: notification for %s failed: %v", notification.OrderID, err)
		shared.WriteError(w, r, http.StatusInternalServerError, "PAYMENT_NOT_APPLIED", "Notification not applied; retry.")
	default:
		shared.WriteJSON(w, http.StatusOK, map[string]any{"status": order.Status})
	}
}
