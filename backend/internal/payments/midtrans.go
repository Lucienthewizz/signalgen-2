package payments

import (
	"bytes"
	"context"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Midtrans talks to the Snap and Core status APIs with one Server Key.
type Midtrans struct {
	serverKey string
	snapURL   string
	apiURL    string
	client    *http.Client
}

// NewMidtrans returns nil when serverKey is empty, which disables checkout.
func NewMidtrans(serverKey string, production bool) *Midtrans {
	serverKey = strings.TrimSpace(serverKey)
	if serverKey == "" {
		return nil
	}
	m := &Midtrans{serverKey: serverKey, snapURL: "https://app.sandbox.midtrans.com", apiURL: "https://api.sandbox.midtrans.com", client: &http.Client{Timeout: 15 * time.Second}}
	if production {
		m.snapURL, m.apiURL = "https://app.midtrans.com", "https://api.midtrans.com"
	}
	return m
}

// WithBaseURLs points the client at test servers.
func (m *Midtrans) WithBaseURLs(snapURL, apiURL string) *Midtrans {
	m.snapURL, m.apiURL = strings.TrimRight(snapURL, "/"), strings.TrimRight(apiURL, "/")
	return m
}

func (m *Midtrans) do(ctx context.Context, method, endpoint string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return err
	}
	request.SetBasicAuth(m.serverKey, "")
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := m.client.Do(request)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrGateway, err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("%w: %v", ErrGateway, err)
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return fmt.Errorf("%w: HTTP %d", ErrGateway, response.StatusCode)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("%w: %v", ErrGateway, err)
	}
	return nil
}

func (m *Midtrans) CreateSnap(ctx context.Context, order Order, customerEmail string) (SnapResult, error) {
	body := map[string]any{
		"transaction_details": map[string]any{"order_id": order.ID, "gross_amount": order.Amount},
		"item_details":        []map[string]any{{"id": order.PlanCode, "price": order.Amount, "quantity": 1, "name": "SignalGen " + planName(order.PlanCode) + " (1 bulan)"}},
		"credit_card":         map[string]any{"secure": true},
	}
	if customerEmail != "" {
		body["customer_details"] = map[string]any{"email": customerEmail}
	}
	var out SnapResult
	if err := m.do(ctx, http.MethodPost, m.snapURL+"/snap/v1/transactions", body, &out); err != nil {
		return SnapResult{}, err
	}
	if out.Token == "" {
		return SnapResult{}, fmt.Errorf("%w: missing Snap token", ErrGateway)
	}
	return out, nil
}

// Status reads the authoritative transaction state from Midtrans.
func (m *Midtrans) Status(ctx context.Context, orderID string) (Status, error) {
	var out Status
	err := m.do(ctx, http.MethodGet, m.apiURL+"/v2/"+url.PathEscape(orderID)+"/status", nil, &out)
	if err != nil {
		return Status{}, err
	}
	if out.StatusCode == "404" {
		return Status{}, ErrOrderNotFound
	}
	return out, nil
}

// VerifyNotification checks signature_key = SHA512(order_id+status_code+gross_amount+server key).
func (m *Midtrans) VerifyNotification(n Notification) bool {
	sum := sha512.Sum512([]byte(n.OrderID + n.StatusCode + n.GrossAmount + m.serverKey))
	expected := hex.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(expected), []byte(strings.ToLower(n.SignatureKey))) == 1
}

func planName(code string) string {
	switch code {
	case "analyst":
		return "Analyst"
	case "pro":
		return "Pro"
	}
	return code
}
