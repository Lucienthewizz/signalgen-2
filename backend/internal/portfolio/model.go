// Package portfolio owns manual long-only transactions and server-side holdings.
// It never converts journal records or screening signals into broker executions.
package portfolio

import (
	"errors"
	"math/big"
	"regexp"
	"strings"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/internal/universe"
)

const MaxTransactions = 1000
const SchemaVersion = "portfolio-ledger-1"
const CostPolicy = "weighted-average-fees-1"

var (
	ErrInvalid      = errors.New("invalid portfolio transaction")
	ErrInsufficient = errors.New("sale exceeds recorded holdings")
	ErrConflict     = errors.New("portfolio transaction version conflict")
	ErrNotFound     = errors.New("portfolio transaction not found")
	ErrLimit        = errors.New("portfolio transaction limit reached")
	decimalPattern  = regexp.MustCompile(`^[0-9]{1,16}(\.[0-9]{1,6})?$`)
)

type Data struct {
	Symbol     string    `json:"symbol"`
	Market     string    `json:"market"`
	Currency   string    `json:"currency"`
	Side       string    `json:"side"`
	Quantity   string    `json:"quantity"`
	Price      string    `json:"price"`
	Fee        string    `json:"fee"`
	ExecutedAt time.Time `json:"executed_at"`
	Book       string    `json:"book"`
	Note       string    `json:"note"`
}

type Transaction struct {
	ID        string    `json:"id"`
	Version   int64     `json:"version"`
	Data      Data      `json:"data"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Position struct {
	Book          string  `json:"book"`
	Symbol        string  `json:"symbol"`
	Market        string  `json:"market"`
	Currency      string  `json:"currency"`
	Quantity      string  `json:"quantity"`
	AverageCost   *string `json:"average_cost"`
	CostBasis     string  `json:"cost_basis"`
	RealizedPnL   string  `json:"realized_pnl"`
	Fees          string  `json:"fees"`
	MarketValue   *string `json:"market_value"`
	UnrealizedPnL *string `json:"unrealized_pnl"`
}

type Total struct {
	Book        string `json:"book"`
	Market      string `json:"market"`
	Currency    string `json:"currency"`
	CostBasis   string `json:"cost_basis"`
	RealizedPnL string `json:"realized_pnl"`
	Fees        string `json:"fees"`
}

type Summary struct {
	SchemaVersion    string     `json:"schema_version"`
	CostPolicy       string     `json:"cost_policy"`
	TransactionCount int        `json:"transaction_count"`
	Positions        []Position `json:"positions"`
	Totals           []Total    `json:"totals"`
	Warnings         []string   `json:"warnings"`
}

func Normalize(input Data) (Data, error) {
	input.Symbol = strings.ToUpper(strings.TrimSpace(input.Symbol))
	input.Book, input.Note = strings.TrimSpace(input.Book), strings.TrimSpace(input.Note)
	if len(input.Symbol) > 20 || strings.ContainsAny(input.Book, "\x00\r\n\t") || strings.ContainsRune(input.Note, '\x00') || universe.SymbolMarket(input.Symbol) != input.Market || !((input.Market == "IDX" && input.Currency == "IDR") || (input.Market == "US" && input.Currency == "USD")) ||
		(input.Side != "BUY" && input.Side != "SELL") || len(input.Book) < 1 || len(input.Book) > 80 || len(input.Note) > 2000 || input.ExecutedAt.IsZero() || input.ExecutedAt.After(time.Now().Add(5*time.Minute)) || input.ExecutedAt.Nanosecond()%1000 != 0 {
		return Data{}, ErrInvalid
	}
	q, err := decimal(input.Quantity)
	if err != nil || q.Sign() <= 0 || q.Cmp(big.NewRat(100000000, 1)) > 0 {
		return Data{}, ErrInvalid
	}
	p, err := decimal(input.Price)
	if err != nil || p.Sign() <= 0 || p.Cmp(big.NewRat(1000000000, 1)) > 0 {
		return Data{}, ErrInvalid
	}
	f, err := decimal(input.Fee)
	if err != nil || f.Sign() < 0 || f.Cmp(big.NewRat(1000000000000, 1)) > 0 {
		return Data{}, ErrInvalid
	}
	if new(big.Rat).Mul(q, p).Cmp(big.NewRat(1000000000000, 1)) > 0 || (input.Market == "IDX" && !new(big.Rat).Quo(q, big.NewRat(100, 1)).IsInt()) {
		return Data{}, ErrInvalid
	}
	input.Quantity, input.Price, input.Fee = q.FloatString(6), p.FloatString(6), f.FloatString(6)
	input.ExecutedAt = input.ExecutedAt.UTC()
	return input, nil
}

func decimal(value string) (*big.Rat, error) {
	if !decimalPattern.MatchString(value) {
		return nil, ErrInvalid
	}
	parsed, ok := new(big.Rat).SetString(value)
	if !ok {
		return nil, ErrInvalid
	}
	return parsed, nil
}
