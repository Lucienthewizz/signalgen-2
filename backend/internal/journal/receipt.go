// Package journal attests matched screening snapshots for an append-only journal.
// It does not turn a signal into an executed trade or calculate portfolio P&L.
package journal

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
	"github.com/google/uuid"
)

const Schema = "screening-journal-1"
const MaxReceiptBytes = 32 << 10
const ReceiptLifetime = 24 * time.Hour

var ErrReceipt = errors.New("screening receipt is invalid or expired")

type Entry struct {
	Schema          string             `json:"schema_version"`
	Source          string             `json:"source"`
	Symbol          string             `json:"symbol"`
	Market          string             `json:"market"`
	Currency        string             `json:"currency"`
	RuleID          string             `json:"rule_id"`
	RuleName        string             `json:"rule_name"`
	DefinitionHash  string             `json:"definition_hash"`
	Timeframe       string             `json:"timeframe"`
	CandleAt        string             `json:"candle_at"`
	ScreenedAt      string             `json:"screened_at"`
	SignalType      string             `json:"signal_type,omitempty"`
	Matched         bool               `json:"matched"`
	Price           float64            `json:"price"`
	Features        core.FeatureVector `json:"features"`
	ReasonCodes     []string           `json:"reason_codes"`
	DatasetChecksum string             `json:"dataset_checksum"`
}

type Receipt struct {
	ID        string `json:"id"`
	Owner     string `json:"owner"`
	SessionID string `json:"session_id"`
	ExpiresAt int64  `json:"expires_at"`
	Data      Entry  `json:"data"`
}

// Like the existing in-memory screener snapshots/tickets, unsaved receipts are
// process-local. Restarting the API requires a fresh screening, not a new key in .env.
type Issuer struct {
	key [32]byte
	now func() time.Time
}

func NewIssuer() (*Issuer, error) {
	issuer := &Issuer{now: time.Now}
	_, err := rand.Read(issuer.key[:])
	return issuer, err
}

func (issuer *Issuer) Issue(owner, sessionID string, entry Entry) (string, error) {
	if owner == "" || sessionID == "" || !entry.Matched || entry.Symbol == "" || entry.Price <= 0 {
		return "", ErrReceipt
	}
	entry.Schema, entry.Source = Schema, "screening"
	entry.ScreenedAt = issuer.now().UTC().Format(time.RFC3339Nano)
	receipt := Receipt{ID: uuid.NewString(), Owner: owner, SessionID: sessionID, ExpiresAt: issuer.now().Add(ReceiptLifetime).Unix(), Data: entry}
	raw, err := json.Marshal(receipt)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, issuer.key[:])
	mac.Write([]byte(Schema + "." + payload))
	token := payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if len(token) > MaxReceiptBytes {
		return "", ErrReceipt
	}
	return token, nil
}

func (issuer *Issuer) Verify(token, owner, sessionID string) (Receipt, error) {
	if len(token) == 0 || len(token) > MaxReceiptBytes {
		return Receipt{}, ErrReceipt
	}
	payload, signature, ok := strings.Cut(token, ".")
	if !ok {
		return Receipt{}, ErrReceipt
	}
	provided, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil {
		return Receipt{}, ErrReceipt
	}
	mac := hmac.New(sha256.New, issuer.key[:])
	mac.Write([]byte(Schema + "." + payload))
	if !hmac.Equal(provided, mac.Sum(nil)) {
		return Receipt{}, ErrReceipt
	}
	raw, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return Receipt{}, ErrReceipt
	}
	var receipt Receipt
	if json.Unmarshal(raw, &receipt) != nil || receipt.Owner != owner || receipt.SessionID != sessionID ||
		receipt.ExpiresAt <= issuer.now().Unix() || receipt.Data.Schema != Schema || !receipt.Data.Matched ||
		receipt.Data.Source != "screening" || uuid.Validate(receipt.ID) != nil {
		return Receipt{}, ErrReceipt
	}
	return receipt, nil
}
