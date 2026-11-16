package apitests

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/access"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/api"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/auth"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/payments"
	"github.com/Lucienthewizz/signalgen-2/backend/internal/session"
)

type paymentOrders struct{ orders map[string]payments.Order }

func (s *paymentOrders) CreateOrder(_ context.Context, o payments.Order) error {
	s.orders[o.ID] = o
	return nil
}
func (s *paymentOrders) AttachSnapToken(context.Context, string, string) error { return nil }
func (s *paymentOrders) Order(_ context.Context, user, id string) (payments.Order, error) {
	o, ok := s.orders[id]
	if !ok || o.UserID != user {
		return payments.Order{}, payments.ErrOrderNotFound
	}
	return o, nil
}
func (s *paymentOrders) ApplyStatus(_ context.Context, id string, st payments.Status) (payments.Order, error) {
	o, ok := s.orders[id]
	if !ok {
		return payments.Order{}, payments.ErrOrderNotFound
	}
	o.Status = st.OrderState()
	s.orders[id] = o
	return o, nil
}

func TestPaymentRoutes(t *testing.T) {
	midtrans := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"token":"snap-token","redirect_url":"https://pay.example/snap"}`))
	}))
	defer midtrans.Close()
	store := &paymentOrders{orders: map[string]payments.Order{}}
	service := &payments.Service{Gateway: payments.NewMidtrans("SB-Mid-server-TEST", false).WithBaseURLs(midtrans.URL, midtrans.URL), Store: store}
	newServer := func(options ...api.ServerOption) *api.Server {
		t.Helper()
		server, err := api.NewServer(fakeIdentity{principal: auth.Principal{ID: "user-a", Email: "a@example.test"}}, &fakeSessions{verified: session.Session{ID: "ses-a"}}, &fakeAccess{features: []string{access.FeatureBacktest}}, &fakeDatasets{}, &backtestGrants{}, options...)
		if err != nil {
			t.Fatal(err)
		}
		return server
	}

	// Without a Server Key the routes exist but report payments unavailable.
	if response := backtestHTTP(t, newServer(), "POST", "/api/v1/payments/checkout", map[string]string{"plan_code": "pro"}); response.Code != 503 {
		t.Fatalf("unconfigured checkout: %d %s", response.Code, response.Body)
	}

	server := newServer(api.WithPayments(service))
	unauthenticated := httptest.NewRequest("POST", "/api/v1/payments/checkout", strings.NewReader(`{"plan_code":"pro"}`))
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, unauthenticated)
	if recorder.Code != 401 {
		t.Fatalf("checkout without session: %d", recorder.Code)
	}
	if response := backtestHTTP(t, server, "POST", "/api/v1/payments/checkout", map[string]string{"plan_code": "free"}); response.Code != 422 {
		t.Fatalf("free plan checkout: %d %s", response.Code, response.Body)
	}
	response := backtestHTTP(t, server, "POST", "/api/v1/payments/checkout", map[string]any{"plan_code": "pro", "amount": 1})
	if response.Code != 400 {
		t.Fatalf("client-supplied amount must be rejected: %d %s", response.Code, response.Body)
	}
	response = backtestHTTP(t, server, "POST", "/api/v1/payments/checkout", map[string]string{"plan_code": "pro"})
	var created struct {
		Order     payments.Order `json:"order"`
		SnapToken string         `json:"snap_token"`
	}
	if response.Code != 201 || json.Unmarshal(response.Body.Bytes(), &created) != nil || created.SnapToken != "snap-token" || created.Order.Amount != 99000 {
		t.Fatalf("checkout: %d %s", response.Code, response.Body)
	}
	if response := backtestHTTP(t, server, "GET", "/api/v1/payments/orders/"+created.Order.ID, nil); response.Code != 200 || !strings.Contains(response.Body.String(), `"status":"pending"`) {
		t.Fatalf("order read: %d %s", response.Code, response.Body)
	}

	// The public notification endpoint rejects a forged signature.
	forged, _ := json.Marshal(payments.Notification{OrderID: created.Order.ID, StatusCode: "200", GrossAmount: "99000.00", SignatureKey: "bad"})
	request := httptest.NewRequest("POST", "/api/v1/payments/midtrans/notification", bytes.NewReader(forged))
	recorder = httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	if recorder.Code != 403 || store.orders[created.Order.ID].Status != payments.OrderPending {
		t.Fatalf("forged notification: %d %s", recorder.Code, recorder.Body)
	}
}
