package records

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Lucienthewizz/signalgen-2/backend/core"
)

var ErrInvalid = errors.New("invalid record")
var UUID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var symbol = regexp.MustCompile(`^[A-Z][A-Z0-9.:-]{0,19}$`)

func strict(raw []byte, v any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(v) != nil || d.Decode(new(any)) != io.EOF {
		return ErrInvalid
	}
	return nil
}

type TradeInput struct {
	Symbol     string   `json:"symbol"`
	Market     string   `json:"market"`
	Currency   string   `json:"currency"`
	Side       string   `json:"side"`
	Quantity   float64  `json:"quantity"`
	EntryPrice float64  `json:"entry_price"`
	ExitPrice  *float64 `json:"exit_price"`
	EntryFee   float64  `json:"entry_fee"`
	ExitFee    float64  `json:"exit_fee"`
	EntryDate  string   `json:"entry_date"`
	ExitDate   string   `json:"exit_date"`
	Book       string   `json:"book"`
	Note       string   `json:"note"`
}
type Trade struct {
	TradeInput
	NetPL     *float64 `json:"net_pl"`
	ReturnPct *float64 `json:"return_pct"`
}

// Exact decimal arithmetic until final currency rounding. No client P&L is accepted.
func rat(v float64) *big.Rat {
	r, _ := new(big.Rat).SetString(strconv.FormatFloat(v, 'f', -1, 64))
	return r
}
func money(v *big.Rat) float64 { f, _ := v.Float64(); return math.Round(f*100) / 100 }
func NormalizeTrade(raw []byte) (json.RawMessage, error) {
	var in TradeInput
	if len(raw) > 8192 || strict(raw, &in) != nil {
		return nil, ErrInvalid
	}
	in.Symbol = strings.ToUpper(strings.TrimSpace(in.Symbol))
	in.Book = strings.TrimSpace(in.Book)
	in.Note = strings.TrimSpace(in.Note)
	entry, e := time.Parse("2006-01-02", in.EntryDate)
	if e != nil || !symbol.MatchString(in.Symbol) || (in.Side != "BUY" && in.Side != "SELL") || !((in.Market == "IDX" && in.Currency == "IDR") || (in.Market == "US" && in.Currency == "USD")) || len(in.Book) < 1 || len(in.Book) > 80 || len(in.Note) > 2000 {
		return nil, ErrInvalid
	}
	for _, v := range []float64{in.Quantity, in.EntryPrice, in.EntryFee, in.ExitFee} {
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v > 1e12 {
			return nil, ErrInvalid
		}
	}
	if in.Quantity < 1e-6 || in.Quantity > 1e8 || in.EntryPrice < 1e-6 || in.EntryPrice > 1e9 || in.Quantity*in.EntryPrice > 1e12 || entry.After(time.Now().UTC().AddDate(0, 0, 1)) {
		return nil, ErrInvalid
	}
	if in.Market == "IDX" && (in.Quantity != math.Trunc(in.Quantity) || math.Mod(in.Quantity, 100) != 0) {
		return nil, ErrInvalid
	}
	out := Trade{TradeInput: in}
	if in.ExitPrice != nil {
		exit, e := time.Parse("2006-01-02", in.ExitDate)
		if e != nil || exit.Before(entry) || exit.After(time.Now().UTC().AddDate(0, 0, 1)) || *in.ExitPrice < 1e-6 || *in.ExitPrice > 1e9 || in.Quantity**in.ExitPrice > 1e12 || math.IsNaN(*in.ExitPrice) || math.IsInf(*in.ExitPrice, 0) {
			return nil, ErrInvalid
		}
		delta := new(big.Rat).Sub(rat(*in.ExitPrice), rat(in.EntryPrice))
		if in.Side == "SELL" {
			delta.Neg(delta)
		}
		net := new(big.Rat).Mul(delta, rat(in.Quantity))
		net.Sub(net, rat(in.EntryFee))
		net.Sub(net, rat(in.ExitFee))
		pnl := money(net)
		basis := new(big.Rat).Mul(rat(in.Quantity), rat(in.EntryPrice))
		basis.Add(basis, rat(in.EntryFee))
		pct, _ := new(big.Rat).Mul(new(big.Rat).Quo(net, basis), big.NewRat(100, 1)).Float64()
		out.NetPL = &pnl
		out.ReturnPct = &pct
	} else if in.ExitDate != "" || in.ExitFee != 0 {
		return nil, ErrInvalid
	}
	return json.Marshal(out)
}

type Archive struct {
	FormatVersion int    `json:"format_version"`
	ID            string `json:"id"`
	SavedAt       string `json:"saved_at"`
	Title         string `json:"title"`
	Currency      string `json:"currency"`
	Source        struct {
		DatasetID string `json:"dataset_id"`
		Version   string `json:"version"`
		Checksum  string `json:"checksum"`
		Universe  struct {
			ID      string   `json:"id"`
			Name    string   `json:"name"`
			Version int64    `json:"version"`
			Symbols []string `json:"symbols"`
		} `json:"universe"`
		Rule *struct {
			ID             string `json:"id"`
			Name           string `json:"name"`
			Version        int64  `json:"version"`
			DefinitionHash string `json:"definition_hash"`
		} `json:"rule,omitempty"`
	} `json:"source"`
	Result core.BacktestResult `json:"result"`
}

func NormalizeArchive(raw []byte, id string) (json.RawMessage, error) {
	var a Archive
	if len(raw) > MaxArchiveBytes || strict(raw, &a) != nil || !UUID.MatchString(id) || a.ID != id || a.FormatVersion != 1 || len(a.Title) < 1 || len(a.Title) > 360 || a.Result.SchemaVersion != core.BacktestSchemaVersion || a.Result.PolicyVersion != core.BacktestPolicyVersion || a.Result.Execution != "portable_go_backtest" || len(a.Result.Horizons) != a.Result.Config.NSteps || core.ValidateBacktestConfig(a.Result.Config) != nil {
		return nil, ErrInvalid
	}
	saved, e := time.Parse(time.RFC3339Nano, a.SavedAt)
	if e != nil || saved.After(time.Now().Add(5*time.Minute)) || !((a.Currency == "IDR") || (a.Currency == "USD")) {
		return nil, ErrInvalid
	}
	if len(a.Source.Universe.Symbols) < 1 || len(a.Source.Universe.Symbols) > 10 || len(a.Source.DatasetID) > 200 || len(a.Source.Version) > 100 || len(a.Source.Checksum) > 128 || len(a.Source.Universe.ID) > 200 || len(a.Source.Universe.Name) > 100 {
		return nil, ErrInvalid
	}
	for _, s := range a.Source.Universe.Symbols {
		if !symbol.MatchString(s) {
			return nil, ErrInvalid
		}
	}
	if a.Source.Rule != nil && (len(a.Source.Rule.ID) > 200 || len(a.Source.Rule.Name) > 100 || len(a.Source.Rule.DefinitionHash) > 128) {
		return nil, ErrInvalid
	}
	for i, h := range a.Result.Horizons {
		if h.Step != i+1 || len(h.Trades)+len(h.Skipped) > 2000 || len(h.EquityCurve) > 25000 || len(h.BySymbol) > 10 {
			return nil, ErrInvalid
		}
	}
	return json.Marshal(a)
}
