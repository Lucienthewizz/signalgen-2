package portfolio

import (
	"math/big"
	"sort"
)

type holding struct {
	data                           Data
	quantity, cost, realized, fees *big.Rat
}

// Recalculate uses exact rationals from decimal strings. Only output is rounded
// to six places; rounded average prices are never fed back into the ledger.
func Recalculate(transactions []Transaction) (Summary, error) {
	if len(transactions) > MaxTransactions {
		return Summary{}, ErrLimit
	}
	ordered := append([]Transaction(nil), transactions...)
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].Data.ExecutedAt.Equal(ordered[j].Data.ExecutedAt) {
			return ordered[i].ID < ordered[j].ID
		}
		return ordered[i].Data.ExecutedAt.Before(ordered[j].Data.ExecutedAt)
	})
	positions := make(map[string]*holding)
	seen := make(map[string]bool)
	for _, tx := range ordered {
		if tx.ID == "" || seen[tx.ID] {
			return Summary{}, ErrInvalid
		}
		seen[tx.ID] = true
		data, err := Normalize(tx.Data)
		if err != nil {
			return Summary{}, err
		}
		key := data.Book + "\x00" + data.Market + "\x00" + data.Symbol
		h := positions[key]
		if h == nil {
			h = &holding{data: data, quantity: new(big.Rat), cost: new(big.Rat), realized: new(big.Rat), fees: new(big.Rat)}
			positions[key] = h
		}
		q, _ := decimal(data.Quantity)
		price, _ := decimal(data.Price)
		fee, _ := decimal(data.Fee)
		notional := new(big.Rat).Mul(q, price)
		if data.Side == "BUY" {
			h.quantity.Add(h.quantity, q)
			h.cost.Add(h.cost, new(big.Rat).Add(notional, fee))
		} else {
			if q.Cmp(h.quantity) > 0 {
				return Summary{}, ErrInsufficient
			}
			basis := new(big.Rat).Mul(new(big.Rat).Quo(h.cost, h.quantity), q)
			h.realized.Add(h.realized, new(big.Rat).Sub(new(big.Rat).Sub(notional, fee), basis))
			h.cost.Sub(h.cost, basis)
			h.quantity.Sub(h.quantity, q)
		}
		h.fees.Add(h.fees, fee)
	}
	result := Summary{SchemaVersion: SchemaVersion, CostPolicy: CostPolicy, TransactionCount: len(ordered), Positions: []Position{}, Totals: []Total{}, Warnings: []string{
		"Manual recorded transactions, not verified broker fills; long-only weighted average, no FX conversion.",
		"No automatic split/dividend adjustments. No market quote loaded: market value and unrealized P&L are unknown, not zero.",
		"Transactions are ordered by executed_at then UUID; supply distinct timestamps when execution order matters.",
	}}
	keys := make([]string, 0, len(positions))
	for key := range positions {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	totals := map[string]*holding{}
	for _, key := range keys {
		h := positions[key]
		d := h.data
		p := Position{Book: d.Book, Symbol: d.Symbol, Market: d.Market, Currency: d.Currency, Quantity: h.quantity.FloatString(6), CostBasis: h.cost.FloatString(6), RealizedPnL: h.realized.FloatString(6), Fees: h.fees.FloatString(6)}
		if h.quantity.Sign() > 0 {
			value := new(big.Rat).Quo(h.cost, h.quantity).FloatString(6)
			p.AverageCost = &value
		}
		result.Positions = append(result.Positions, p)
		totalKey := d.Book + "\x00" + d.Market
		total := totals[totalKey]
		if total == nil {
			total = &holding{data: d, cost: new(big.Rat), realized: new(big.Rat), fees: new(big.Rat)}
			totals[totalKey] = total
		}
		total.cost.Add(total.cost, h.cost)
		total.realized.Add(total.realized, h.realized)
		total.fees.Add(total.fees, h.fees)
	}
	keys = keys[:0]
	for key := range totals {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		h := totals[key]
		result.Totals = append(result.Totals, Total{Book: h.data.Book, Market: h.data.Market, Currency: h.data.Currency, CostBasis: h.cost.FloatString(6), RealizedPnL: h.realized.FloatString(6), Fees: h.fees.FloatString(6)})
	}
	return result, nil
}
