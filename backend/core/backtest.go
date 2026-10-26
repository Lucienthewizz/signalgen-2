package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"sort"
	"time"
)

const (
	BacktestSchemaVersion = "backtest-1"
	BacktestPolicyVersion = "holding-next-open-1"
	MaxBacktestCandles    = 2500
	MaxBacktestEntries    = 2000
)

type BacktestConfig struct {
	Mode           string  `json:"mode"`
	Timeframe      string  `json:"timeframe"`
	From           string  `json:"from"`
	To             string  `json:"to"`
	NSteps         int     `json:"n_steps"`
	ExitStrategy   string  `json:"exit_strategy"`
	InitialCapital float64 `json:"initial_capital"`
	PositionSizing string  `json:"position_sizing"`
	PositionSize   float64 `json:"position_size"`
	CommissionPct  float64 `json:"commission_pct"`
	SlippagePct    float64 `json:"slippage_pct"`
}

func DefaultBacktestConfig() BacktestConfig {
	return BacktestConfig{Mode: "manual", Timeframe: "1d", NSteps: 1, ExitStrategy: "holding_period", InitialCapital: 10000, PositionSizing: "percent_equity", PositionSize: 100}
}

// Defaults apply only to omitted JSON fields; an explicit zero capital is invalid.
func (config *BacktestConfig) UnmarshalJSON(raw []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	for _, value := range fields {
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return fmt.Errorf("backtest config fields cannot be null")
		}
	}
	type plain BacktestConfig
	value := plain(DefaultBacktestConfig())
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return err
	}
	*config = BacktestConfig(value)
	return nil
}

type BacktestSeries struct {
	Symbol   string   `json:"symbol"`
	Timezone string   `json:"timezone,omitempty"`
	Candles  []Candle `json:"candles"`
}

type BacktestEntry struct {
	Symbol     string `json:"symbol"`
	Timestamp  string `json:"timestamp"`
	SignalType string `json:"signal_type"`
}

type BacktestRequest struct {
	SchemaVersion string           `json:"schema_version"`
	Config        BacktestConfig   `json:"config"`
	Series        []BacktestSeries `json:"series"`
	Entries       []BacktestEntry  `json:"entries"`
}

type BacktestTrade struct {
	Symbol          string   `json:"symbol"`
	SignalTime      string   `json:"signal_time"`
	EntryTime       string   `json:"entry_time"`
	ExitTime        string   `json:"exit_time,omitempty"`
	Status          string   `json:"status"`
	Quantity        float64  `json:"quantity"`
	EntryPrice      float64  `json:"entry_price"`
	ExitPrice       *float64 `json:"exit_price"`
	EntryCommission float64  `json:"entry_commission"`
	ExitCommission  float64  `json:"exit_commission"`
	NetPL           float64  `json:"net_pl"`
	UnrealizedPL    float64  `json:"unrealized_pl"`
	ReturnPct       float64  `json:"return_pct"`
}

type BacktestSkipped struct {
	BacktestEntry
	Reason string `json:"reason"`
}

type BacktestEquity struct {
	Timestamp string  `json:"timestamp"`
	Equity    float64 `json:"equity"`
}

type BacktestMetrics struct {
	InitialCapital  float64  `json:"initial_capital"`
	FinalEquity     float64  `json:"final_equity"`
	NetPLCash       float64  `json:"net_pl_cash"`
	UnrealizedPL    float64  `json:"unrealized_pl"`
	TotalReturnPct  float64  `json:"total_return_pct"`
	ClosedTrades    int      `json:"closed_trades"`
	OpenTrades      int      `json:"open_trades"`
	Wins            int      `json:"wins"`
	Losses          int      `json:"losses"`
	Flats           int      `json:"flats"`
	WinRate         float64  `json:"win_rate"`
	ProfitFactor    *float64 `json:"profit_factor"`
	MaxDrawdownPct  float64  `json:"max_drawdown_pct"`
	TotalCommission float64  `json:"total_commission"`
}

type BacktestHorizon struct {
	Step        int               `json:"step"`
	Label       string            `json:"label"`
	Trades      []BacktestTrade   `json:"trades"`
	Skipped     []BacktestSkipped `json:"skipped"`
	Metrics     BacktestMetrics   `json:"metrics"`
	EquityCurve []BacktestEquity  `json:"equity_curve"`
}

type BacktestResult struct {
	SchemaVersion string            `json:"schema_version"`
	PolicyVersion string            `json:"policy_version"`
	Execution     string            `json:"execution"`
	Config        BacktestConfig    `json:"config"`
	Horizons      []BacktestHorizon `json:"horizons"`
	Warnings      []string          `json:"warnings"`
}

func ValidateBacktestConfig(config BacktestConfig) error {
	from, e1 := time.Parse("2006-01-02", config.From)
	to, e2 := time.Parse("2006-01-02", config.To)
	if e1 != nil || e2 != nil || to.Before(from) || to.Sub(from) > 5*366*24*time.Hour {
		return fmt.Errorf("invalid entry range (maximum five years)")
	}
	if (config.Mode != "rule" && config.Mode != "manual") || config.Timeframe != "1d" || config.ExitStrategy != "holding_period" || config.NSteps < 1 || config.NSteps > 100 {
		return fmt.Errorf("unsupported backtest mode, timeframe, exit strategy or horizon")
	}
	for _, v := range []float64{config.InitialCapital, config.PositionSize, config.CommissionPct, config.SlippagePct} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return fmt.Errorf("non-finite backtest configuration")
		}
	}
	if config.InitialCapital <= 0 || config.InitialCapital > 1e15 || config.PositionSize <= 0 || config.PositionSize > 1e15 || config.CommissionPct < 0 || config.CommissionPct > 10 || config.SlippagePct < 0 || config.SlippagePct > 10 {
		return fmt.Errorf("invalid capital, sizing or costs")
	}
	if config.PositionSizing != "percent_equity" && config.PositionSizing != "fixed_amount" {
		return fmt.Errorf("unsupported position sizing")
	}
	if config.PositionSizing == "percent_equity" && config.PositionSize > 100 {
		return fmt.Errorf("percent equity exceeds 100")
	}
	return nil
}

// ComputeBacktestFeatures keeps the screener's purpose/version contract intact.
// Its call graph never reaches the private rule evaluator, including in WASM.
func ComputeBacktestFeatures(request FeatureRequest) (FeatureResult, error) {
	if request.Purpose != "backtest" || len(request.Candles) > MaxBacktestCandles {
		return FeatureResult{}, fmt.Errorf("invalid backtest feature scope")
	}
	if err := validateBacktestDays(request.Candles); err != nil {
		return FeatureResult{}, err
	}
	request.Purpose = "screen"
	return ComputeFeatures(request)
}

func validateBacktestDays(candles []Candle) error {
	previousDay := ""
	for _, candle := range candles {
		stamp, err := time.Parse(time.RFC3339, candle.Timestamp)
		if err != nil {
			return fmt.Errorf("invalid backtest candle timestamp")
		}
		day := stamp.UTC().Format("2006-01-02")
		if day <= previousDay {
			return fmt.Errorf("backtest requires one candle per UTC session date")
		}
		previousDay = day
	}
	return nil
}

// RunBacktest consumes entry decisions, never private rule definitions.
func RunBacktest(request BacktestRequest) (BacktestResult, error) {
	if request.SchemaVersion != BacktestSchemaVersion {
		return BacktestResult{}, fmt.Errorf("unsupported backtest schema")
	}
	if err := ValidateBacktestConfig(request.Config); err != nil {
		return BacktestResult{}, err
	}
	if len(request.Series) < 1 || len(request.Series) > 10 || len(request.Entries) > MaxBacktestEntries {
		return BacktestResult{}, fmt.Errorf("backtest scope exceeds limits")
	}
	series := make(map[string][]Candle, len(request.Series))
	timelineSet := map[string]bool{}
	for _, item := range request.Series {
		if item.Symbol == "" || series[item.Symbol] != nil || (item.Timezone != "" && item.Timezone != "UTC") || len(item.Candles) > MaxBacktestCandles {
			return BacktestResult{}, fmt.Errorf("invalid or duplicate series")
		}
		if err := validateFeatureRequest(FeatureRequest{Purpose: "screen", Symbol: item.Symbol, Candles: item.Candles}); err != nil {
			return BacktestResult{}, err
		}
		if err := validateBacktestDays(item.Candles); err != nil {
			return BacktestResult{}, err
		}
		// Canonical UTC keys make equivalent timestamp offsets order identically.
		candles := append([]Candle(nil), item.Candles...)
		for i := range candles {
			stamp, _ := time.Parse(time.RFC3339, candles[i].Timestamp)
			candles[i].Timestamp = stamp.UTC().Format(time.RFC3339Nano)
			timelineSet[candles[i].Timestamp[:10]+"T00:00:00Z"] = true
		}
		series[item.Symbol] = candles
	}
	entries := append([]BacktestEntry(nil), request.Entries...)
	seen := map[string]bool{}
	for i := range entries {
		entry := &entries[i]
		stamp, err := time.Parse(time.RFC3339, entry.Timestamp)
		if err != nil || series[entry.Symbol] == nil || (entry.SignalType != "" && entry.SignalType != "BUY") {
			return BacktestResult{}, fmt.Errorf("unsupported entry direction, timestamp or symbol")
		}
		entry.Timestamp = stamp.UTC().Format(time.RFC3339Nano)
		entry.SignalType = "BUY"
		if entry.Timestamp[:10] < request.Config.From || entry.Timestamp[:10] > request.Config.To {
			return BacktestResult{}, fmt.Errorf("entry outside requested range")
		}
		index := sort.Search(len(series[entry.Symbol]), func(i int) bool { return series[entry.Symbol][i].Timestamp >= entry.Timestamp })
		if index >= len(series[entry.Symbol]) || series[entry.Symbol][index].Timestamp != entry.Timestamp {
			return BacktestResult{}, fmt.Errorf("entry must reference an exact candle timestamp")
		}
		if index < 19 {
			return BacktestResult{}, fmt.Errorf("entry requires twenty completed warmup candles")
		}
		key := entry.Symbol + "\x00" + entry.Timestamp
		if seen[key] {
			return BacktestResult{}, fmt.Errorf("duplicate entry")
		}
		seen[key] = true
	}
	sort.Slice(entries, func(i, j int) bool {
		return backtestEntryBefore(entries[i], entries[j])
	})
	timeline := make([]string, 0, len(timelineSet))
	for stamp := range timelineSet {
		timeline = append(timeline, stamp)
	}
	sort.Strings(timeline)
	result := BacktestResult{SchemaVersion: BacktestSchemaVersion, PolicyVersion: BacktestPolicyVersion, Execution: "portable_go_backtest", Config: request.Config, Horizons: []BacktestHorizon{}, Warnings: []string{"Hypothetical long-only analysis; fractional quantity; no lot-size, liquidity, corporate-action or broker execution model.", "Candle timestamps identify sessions; signals are known only after session close. Manual entries must reference exact snapshot timestamps."}}
	for step := 1; step <= request.Config.NSteps; step++ {
		result.Horizons = append(result.Horizons, simulateBacktest(request.Config, entries, series, timeline, step))
	}
	// Never let overflow become an unencodable successful result at the WASM boundary.
	if _, err := json.Marshal(result); err != nil {
		return BacktestResult{}, fmt.Errorf("backtest arithmetic exceeded finite range")
	}
	return result, nil
}

type scheduledEntry struct {
	entry    BacktestEntry
	index    int
	fillTime string
}

func backtestEntryBefore(left, right BacktestEntry) bool {
	leftTime, _ := time.Parse(time.RFC3339Nano, left.Timestamp)
	rightTime, _ := time.Parse(time.RFC3339Nano, right.Timestamp)
	if leftTime.Equal(rightTime) {
		return left.Symbol < right.Symbol
	}
	return leftTime.Before(rightTime)
}

func simulateBacktest(config BacktestConfig, entries []BacktestEntry, series map[string][]Candle, timeline []string, step int) BacktestHorizon {
	result := BacktestHorizon{Step: step, Label: fmt.Sprintf("T+%d", step), Trades: []BacktestTrade{}, Skipped: []BacktestSkipped{}, EquityCurve: []BacktestEquity{{Timestamp: "", Equity: config.InitialCapital}}}
	pending := []scheduledEntry{}
	for _, entry := range entries {
		candles := series[entry.Symbol]
		i := sort.Search(len(candles), func(i int) bool { return candles[i].Timestamp >= entry.Timestamp }) + 1
		if i >= len(candles) {
			result.Skipped = append(result.Skipped, BacktestSkipped{entry, "NO_NEXT_CANDLE"})
			continue
		}
		pending = append(pending, scheduledEntry{entry, i, candles[i].Timestamp})
	}
	sort.SliceStable(pending, func(i, j int) bool {
		if pending[i].fillTime[:10] == pending[j].fillTime[:10] {
			return backtestEntryBefore(pending[i].entry, pending[j].entry)
		}
		return pending[i].fillTime[:10] < pending[j].fillTime[:10]
	})
	cash, peak := config.InitialCapital, config.InitialCapital
	active := -1
	exitIndex := -1
	cursor := 0
	mark := 0.0
	cost := config.CommissionPct / 100
	slip := config.SlippagePct / 100
	for _, stamp := range timeline {
		// An existing position occupies this session through its close. Other entries
		// at that session's open cannot spend the proceeds of that later close.
		for cursor < len(pending) && pending[cursor].fillTime[:10] == stamp[:10] {
			item := pending[cursor]
			cursor++
			if active >= 0 {
				result.Skipped = append(result.Skipped, BacktestSkipped{item.entry, "POSITION_OPEN"})
				continue
			}
			budget := config.PositionSize
			if config.PositionSizing == "percent_equity" {
				budget = cash * config.PositionSize / 100
			}
			budget = math.Min(budget, cash)
			if budget <= 0 {
				result.Skipped = append(result.Skipped, BacktestSkipped{item.entry, "INSUFFICIENT_CAPITAL"})
				continue
			}
			price := series[item.entry.Symbol][item.index].Open * (1 + slip)
			quantity := budget / (price * (1 + cost))
			fee := quantity * price * cost
			if quantity <= 0 || math.IsInf(quantity, 0) {
				result.Skipped = append(result.Skipped, BacktestSkipped{item.entry, "INSUFFICIENT_CAPITAL"})
				continue
			}
			cash = math.Max(0, cash-quantity*price-fee)
			result.Trades = append(result.Trades, BacktestTrade{Symbol: item.entry.Symbol, SignalTime: item.entry.Timestamp, EntryTime: item.fillTime, Status: "open", Quantity: quantity, EntryPrice: price, EntryCommission: fee})
			active = len(result.Trades) - 1
			exitIndex = item.index + step - 1
			mark = price
		}
		if active >= 0 {
			trade := &result.Trades[active]
			candles := series[trade.Symbol]
			i := sort.Search(len(candles), func(i int) bool { return candles[i].Timestamp[:10] >= stamp[:10] })
			if i < len(candles) && candles[i].Timestamp[:10] == stamp[:10] {
				mark = candles[i].Close
				if i == exitIndex {
					price := mark * (1 - slip)
					fee := trade.Quantity * price * cost
					cash += trade.Quantity*price - fee
					trade.UnrealizedPL = 0
					trade.Status = "closed"
					trade.ExitTime = candles[i].Timestamp
					trade.ExitPrice = &price
					trade.ExitCommission = fee
					trade.NetPL = trade.Quantity*(price-trade.EntryPrice) - trade.EntryCommission - fee
					trade.ReturnPct = trade.NetPL / (trade.Quantity*trade.EntryPrice + trade.EntryCommission) * 100
					active = -1
				}
			}
		}
		equity := cash
		if active >= 0 {
			trade := &result.Trades[active]
			trade.UnrealizedPL = trade.Quantity*(mark-trade.EntryPrice) - trade.EntryCommission
			trade.ReturnPct = trade.UnrealizedPL / (trade.Quantity*trade.EntryPrice + trade.EntryCommission) * 100
			equity += trade.Quantity * mark
		}
		peak = math.Max(peak, equity)
		if peak > 0 {
			result.Metrics.MaxDrawdownPct = math.Max(result.Metrics.MaxDrawdownPct, (peak-equity)/peak*100)
		}
		result.EquityCurve = append(result.EquityCurve, BacktestEquity{stamp, equity})
	}
	metrics := &result.Metrics
	metrics.InitialCapital = config.InitialCapital
	metrics.FinalEquity = result.EquityCurve[len(result.EquityCurve)-1].Equity
	metrics.TotalReturnPct = (metrics.FinalEquity/config.InitialCapital - 1) * 100
	profit, loss := 0.0, 0.0
	for _, trade := range result.Trades {
		metrics.TotalCommission += trade.EntryCommission + trade.ExitCommission
		if trade.Status == "open" {
			metrics.OpenTrades++
			metrics.UnrealizedPL += trade.UnrealizedPL
			continue
		}
		metrics.ClosedTrades++
		metrics.NetPLCash += trade.NetPL
		switch {
		case trade.NetPL > 0:
			metrics.Wins++
			profit += trade.NetPL
		case trade.NetPL < 0:
			metrics.Losses++
			loss -= trade.NetPL
		default:
			metrics.Flats++
		}
	}
	if metrics.ClosedTrades > 0 {
		metrics.WinRate = float64(metrics.Wins) / float64(metrics.ClosedTrades) * 100
	}
	if loss > 0 {
		ratio := profit / loss
		metrics.ProfitFactor = &ratio
	}
	return result
}

type BacktestCapabilities struct {
	SchemaVersion       string   `json:"schema_version"`
	PolicyVersion       string   `json:"policy_version"`
	Modes               []string `json:"modes"`
	Timeframes          []string `json:"timeframes"`
	SignalTypes         []string `json:"signal_types"`
	ExitStrategies      []string `json:"exit_strategies"`
	MaxSymbols          int      `json:"max_symbols"`
	MaxCandlesPerSymbol int      `json:"max_candles_per_symbol"`
	MaxEntries          int      `json:"max_entries"`
	MaxHorizon          int      `json:"max_horizon"`
	FinancialExecution  string   `json:"financial_execution"`
	DecisionExecution   string   `json:"decision_execution"`
}

func GetBacktestCapabilities() BacktestCapabilities {
	return BacktestCapabilities{BacktestSchemaVersion, BacktestPolicyVersion, []string{"rule", "manual"}, []string{"1d"}, []string{"BUY"}, []string{"holding_period"}, 10, MaxBacktestCandles, MaxBacktestEntries, 100, "client_wasm", "server_private"}
}

// DecodeBacktestRequest rejects unknown execution knobs instead of quietly
// pretending that a legacy price basis or exit strategy was honored.
func DecodeBacktestRequest(raw []byte) (BacktestRequest, error) {
	var request BacktestRequest
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if len(raw) > 8<<20 {
		return request, fmt.Errorf("backtest input exceeds 8 MiB")
	}
	if err := decoder.Decode(&request); err != nil {
		return request, err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return request, fmt.Errorf("expected one backtest object")
	}
	return request, nil
}
