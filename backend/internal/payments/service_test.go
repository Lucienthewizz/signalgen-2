package payments_test

import (
	"context"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/payments"
)

const testKey = "SB-Mid-server-TEST"

func sign(orderID, statusCode, gross string) string {
	sum := sha512.Sum512([]byte(orderID + statusCode + gross + testKey))
	return hex.EncodeToString(sum[:])
}

// fakeMidtrans records requests and answers like the Snap and status APIs.
func fakeMidtrans(t *testing.T, status payments.Status) (*payments.Midtrans, *[]string) {
	t.Helper()
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, _, ok := r.BasicAuth()
		if !ok || user != testKey {
			t.Errorf("missing Server Key basic auth on %s", r.URL.Path)
		}
		calls = append(calls, r.Method+" "+r.URL.Path)
		switch {
		case r.URL.Path == "/snap/v1/transactions":
			var body map[string]map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["transaction_details"]["gross_amount"] != float64(99000) {
				t.Errorf("gross_amount = %v", body["transaction_details"]["gross_amount"])
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"token":"snap-token","redirect_url":"https://pay.example/snap"}`))
		case strings.HasSuffix(r.URL.Path, "/status"):
			_ = json.NewEncoder(w).Encode(status)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return payments.NewMidtrans(testKey, false).WithBaseURLs(server.URL, server.URL), &calls
}

type memoryStore struct {
	orders  map[string]payments.Order
	applied []payments.Status
}

func (m *memoryStore) CreateOrder(_ context.Context, o payments.Order) error {
	m.orders[o.ID] = o
	return nil
}
func (m *memoryStore) AttachSnapToken(_ context.Context, id, token string) error {
	o := m.orders[id]
	o.SnapToken = token
	m.orders[id] = o
	return nil
}
func (m *memoryStore) Order(_ context.Context, user, id string) (payments.Order, error) {
	o, ok := m.orders[id]
	if !ok || o.UserID != user {
		return payments.Order{}, payments.ErrOrderNotFound
	}
	return o, nil
}
func (m *memoryStore) ApplyStatus(_ context.Context, id string, s payments.Status) (payments.Order, error) {
	o, ok := m.orders[id]
	if !ok {
		return payments.Order{}, payments.ErrOrderNotFound
	}
	m.applied = append(m.applied, s)
	o.Status = s.OrderState()
	m.orders[id] = o
	return o, nil
}

func TestCheckoutUsesServerPriceAndRejectsFreePlan(t *testing.T) {
	gateway, calls := fakeMidtrans(t, payments.Status{})
	store := &memoryStore{orders: map[string]payments.Order{}}
	service := &payments.Service{Gateway: gateway, Store: store}
	if _, _, err := service.Checkout(context.Background(), "user", "free", ""); !errors.Is(err, payments.ErrInvalidPlan) {
		t.Fatalf("free plan: %v", err)
	}
	order, snap, err := service.Checkout(context.Background(), "user", "pro", "user@example.test")
	if err != nil || snap.Token != "snap-token" || order.Amount != 99000 || order.Currency != "IDR" || !strings.HasPrefix(order.ID, "sg-") {
		t.Fatalf("checkout: %+v %+v %v", order, snap, err)
	}
	if store.orders[order.ID].SnapToken != "snap-token" || len(*calls) != 1 {
		t.Fatalf("token not stored or extra calls: %v", *calls)
	}
}

func TestNotificationNeedsSignatureAndUsesConfirmedStatus(t *testing.T) {
	// Midtrans' status API says pending, whatever the notification body claims.
	gateway, calls := fakeMidtrans(t, payments.Status{OrderID: "sg-order-0001", StatusCode: "201", TransactionStatus: "pending", GrossAmount: "99000.00"})
	store := &memoryStore{orders: map[string]payments.Order{"sg-order-0001": {ID: "sg-order-0001", UserID: "user", PlanCode: "pro", Amount: 99000, Status: payments.OrderPending}}}
	service := &payments.Service{Gateway: gateway, Store: store}

	forged := payments.Notification{OrderID: "sg-order-0001", StatusCode: "200", GrossAmount: "99000.00", SignatureKey: strings.Repeat("0", 128)}
	if _, err := service.HandleNotification(context.Background(), forged); !errors.Is(err, payments.ErrBadSignature) {
		t.Fatalf("forged signature: %v", err)
	}
	if len(*calls) != 0 || len(store.applied) != 0 {
		t.Fatal("forged notification reached Midtrans or the store")
	}
	valid := forged
	valid.SignatureKey = sign(valid.OrderID, valid.StatusCode, valid.GrossAmount)
	order, err := service.HandleNotification(context.Background(), valid)
	if err != nil || order.Status != payments.OrderPending || store.applied[0].TransactionStatus != "pending" {
		t.Fatalf("confirmed status not used: %+v %v", order, err)
	}
}

func TestStatusMapping(t *testing.T) {
	for _, tc := range []struct{ status, fraud, want string }{
		{"settlement", "", payments.OrderPaid},
		{"capture", "accept", payments.OrderPaid},
		{"capture", "challenge", payments.OrderPending},
		{"pending", "", payments.OrderPending},
		{"deny", "", payments.OrderFailed},
		{"cancel", "", payments.OrderFailed},
		{"expire", "", payments.OrderExpired},
		{"refund", "", payments.OrderPending},
	} {
		if got := (payments.Status{TransactionStatus: tc.status, FraudStatus: tc.fraud}).OrderState(); got != tc.want {
			t.Errorf("%s/%s = %s, want %s", tc.status, tc.fraud, got, tc.want)
		}
	}
	for raw, want := range map[string]int{"99000.00": 99000, "49000": 49000, "99000.50": 0, "-1": 0, "x": 0} {
		got, ok := payments.Status{GrossAmount: raw}.Amount()
		if (want == 0 && ok) || (want != 0 && got != want) {
			t.Errorf("Amount(%q) = %d,%v", raw, got, ok)
		}
	}
}

func TestNewMidtransDisabledWithoutKey(t *testing.T) {
	if payments.NewMidtrans("  ", false) != nil {
		t.Fatal("empty key must disable payments")
	}
	var service *payments.Service
	if service.Enabled() {
		t.Fatal("nil service reported enabled")
	}
}
