"""Backtest HTTP endpoints migrated from the legacy application module."""

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response

from app.auth.dependencies import get_current_user
from app.schemas.backtests import BacktestRequest, BacktestScreenRequest
from app.services.backtest_service import BacktestNotFoundError, BacktestService


def create_backtests_router(backtest_service: BacktestService) -> APIRouter:
    router = APIRouter(tags=["backtests"])
    logger = logging.getLogger(__name__)

    # ============================================================
    # BACKTESTING API ENDPOINTS
    # ============================================================

    @router.post("/api/backtest/screen")
    async def run_backtest_screen(
        request: BacktestScreenRequest,
        current_user=Depends(get_current_user),
    ):
        """
        New backtesting screen endpoint with 2 modes:
        - rule: generate entries from rule signals within date range
        - manual: user-provided entry timestamps
        """
        user_id = str(current_user.id)
        try:
            from app.data_sources import CachedDataSource, IBKRDataSource, YahooDataSource
            from app.core.rule_engine import RuleEngine
            from app.core.indicator_engine import IndicatorEngine
            from datetime import timezone

            def _parse_dt(value: str, field_name: str) -> datetime:
                try:
                    return datetime.fromisoformat(value.replace('Z', '+00:00'))
                except Exception as ex:
                    raise ValueError(f"Invalid {field_name}: {value}") from ex

            def _normalize_dt(value: datetime) -> datetime:
                if value.tzinfo is not None:
                    return value.astimezone(timezone.utc).replace(tzinfo=None)
                return value

            def _utc_iso(value: datetime) -> str:
                if value.tzinfo is not None:
                    value = value.astimezone(timezone.utc).replace(tzinfo=None)
                return value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")

            def _wall_clock_iso(value: datetime) -> str:
                if value.tzinfo is not None:
                    value = value.replace(tzinfo=None)
                return value.isoformat()

            def _is_numeric_operand(value: Any) -> bool:
                if isinstance(value, (int, float)):
                    return True
                if isinstance(value, str):
                    try:
                        float(value)
                        return True
                    except ValueError:
                        return False
                return False

            def _required_rule_operands(rule_def: Dict[str, Any]) -> set:
                return RuleEngine.extract_required_operands(rule_def)

            def _has_required_indicators(indicators: Dict[str, Any], required: set) -> bool:
                return all(operand in indicators for operand in required)

            def _calculate_trade_pl(signal_type: str, entry_price: float, exit_price: float) -> Dict[str, float]:
                direction = -1 if str(signal_type).upper() == "SELL" else 1
                pl = (exit_price - entry_price) * direction
                pl_pct = 0 if entry_price == 0 else (pl / entry_price) * 100
                return {"pl": pl, "pl_pct": pl_pct}

            def _basis_price(candle: Dict[str, Any], basis: str) -> float:
                if basis not in {"open", "high", "low", "close"}:
                    raise ValueError(f"Unsupported price basis: {basis}")
                return float(candle[basis])

            def _empty_step_metrics(step: int) -> Dict[str, Any]:
                return {
                    "step": step,
                    "label": f"T+{step}",
                    "evaluated": 0,
                    "missing": 0,
                    "wins": 0,
                    "losses": 0,
                    "flats": 0,
                    "win_rate": 0,
                    "total_pl": 0,
                    "avg_pl": 0,
                    "total_pl_pct": 0,
                    "avg_pl_pct": 0,
                    "best_pl": None,
                    "worst_pl": None,
                    "best_pl_pct": None,
                    "worst_pl_pct": None,
                    "avg_win": 0,
                    "avg_loss": 0,
                    "profit_factor": None,
                    # Capital-based metrics (item #1/#2)
                    "initial_capital": 0,
                    "final_equity": 0,
                    "net_pl_cash": 0,
                    "total_return_pct": 0,
                    "max_drawdown_pct": 0,
                    "avg_win_cash": 0,
                    "avg_loss_cash": 0,
                    "risk_reward": None,
                    "expectancy_cash": 0,
                    "sharpe": None,
                    "total_commission": 0,
                    "equity_curve": []
                }

            exit_price_basis = request.pl_basis or request.exit_price_basis or 'close'
            entry_price_basis = request.entry_price_basis or 'close'

            capital_cfg = {
                "initial_capital": float(request.initial_capital),
                "position_sizing": request.position_sizing,
                "position_size": float(request.position_size),
                "commission_pct": float(request.commission_pct),
                "slippage_pct": float(request.slippage_pct),
            }

            def _simulate_horizon(rows: List[Dict[str, Any]], label: str) -> Dict[str, Any]:
                """
                Simulate a single-position, sequential portfolio for one exit horizon.

                Assumptions (documented for thesis validity):
                - One position at a time; trades are processed in entry-time order and
                  equity compounds trade-by-trade (no overlapping positions).
                - Commission and slippage are applied to both legs (entry + exit).
                - Sharpe is a per-trade ratio (mean/stdev of per-trade returns), not annualized.
                """
                initial_capital = capital_cfg["initial_capital"]
                comm = capital_cfg["commission_pct"] / 100.0
                slip = capital_cfg["slippage_pct"] / 100.0

                # Order trades that have an exit at this horizon by entry time
                ordered = []
                for row in rows:
                    step_data = row.get("steps", {}).get(label)
                    if not step_data or step_data.get("exit_price") is None:
                        continue
                    ordered.append(row)
                ordered.sort(key=lambda r: str(r.get("entry_time") or ""))

                equity = initial_capital
                peak = initial_capital
                max_dd = 0.0
                net_pls = []
                trade_returns = []
                total_commission = 0.0
                equity_curve = [{"t": None, "equity": round(equity, 4), "label": "start"}]

                for row in ordered:
                    step_data = row["steps"][label]
                    sign = -1 if str(row.get("signal_type", "BUY")).upper() == "SELL" else 1
                    entry = float(row["entry_price"])
                    exit_price = float(step_data["exit_price"])
                    if entry <= 0:
                        continue

                    # Slippage worsens both fills relative to trade direction
                    eff_entry = entry * (1 + sign * slip)
                    eff_exit = exit_price * (1 - sign * slip)
                    if eff_entry <= 0:
                        continue

                    # Position sizing
                    if capital_cfg["position_sizing"] == "fixed_amount":
                        notional = min(capital_cfg["position_size"], equity)
                    else:  # percent_equity
                        notional = equity * (capital_cfg["position_size"] / 100.0)
                    if notional <= 0:
                        continue

                    shares = notional / eff_entry
                    gross = (eff_exit - eff_entry) * sign * shares
                    commission = (notional + shares * eff_exit) * comm
                    net = gross - commission
                    total_commission += commission

                    equity += net
                    peak = max(peak, equity)
                    if peak > 0:
                        dd = (peak - equity) / peak
                        max_dd = max(max_dd, dd)

                    net_pls.append(net)
                    trade_returns.append(net / notional if notional else 0.0)
                    equity_curve.append({
                        "t": step_data.get("time") or row.get("entry_time"),
                        "equity": round(equity, 4),
                        "symbol": row.get("symbol"),
                        "pl": round(net, 4),
                    })

                n = len(net_pls)
                wins = [p for p in net_pls if p > 0]
                losses = [p for p in net_pls if p < 0]
                gross_profit = sum(wins)
                gross_loss = abs(sum(losses))
                avg_win_cash = (gross_profit / len(wins)) if wins else 0.0
                avg_loss_cash = (sum(losses) / len(losses)) if losses else 0.0  # negative
                expectancy = (sum(net_pls) / n) if n else 0.0

                # Per-trade Sharpe (not annualized)
                sharpe = None
                if n >= 2:
                    mean_r = sum(trade_returns) / n
                    var = sum((r - mean_r) ** 2 for r in trade_returns) / (n - 1)
                    std = var ** 0.5
                    sharpe = (mean_r / std) if std > 0 else None

                risk_reward = (avg_win_cash / abs(avg_loss_cash)) if avg_loss_cash != 0 else None

                return {
                    "initial_capital": round(initial_capital, 2),
                    "final_equity": round(equity, 2),
                    "net_pl_cash": round(equity - initial_capital, 2),
                    "total_return_pct": ((equity - initial_capital) / initial_capital * 100) if initial_capital else 0,
                    "max_drawdown_pct": round(max_dd * 100, 2),
                    "avg_win_cash": round(avg_win_cash, 2),
                    "avg_loss_cash": round(avg_loss_cash, 2),
                    "risk_reward": round(risk_reward, 2) if risk_reward is not None else None,
                    "expectancy_cash": round(expectancy, 2),
                    "sharpe": round(sharpe, 3) if sharpe is not None else None,
                    "total_commission": round(total_commission, 2),
                    "equity_curve": equity_curve,
                }

            def _aggregate_label(rows: List[Dict[str, Any]], label: str, step_num: int) -> Dict[str, Any]:
                """Aggregate price-based + capital-based metrics for one exit label
                (either a T+k horizon or the realized-exit pseudo-label)."""
                values = []
                missing = 0
                for row in rows:
                    step_data = row.get("steps", {}).get(label)
                    if not step_data or step_data.get("pl") is None:
                        missing += 1
                        continue
                    values.append(step_data)

                metrics = _empty_step_metrics(step_num)
                metrics["label"] = label
                metrics["missing"] = missing
                if values:
                    pls = [float(v["pl"]) for v in values]
                    pl_pcts = [float(v["pl_pct"]) for v in values]
                    wins = [v for v in pls if v > 0]
                    losses = [v for v in pls if v < 0]
                    flats = [v for v in pls if v == 0]
                    gross_profit = sum(wins)
                    gross_loss = abs(sum(losses))

                    metrics.update({
                        "evaluated": len(values),
                        "wins": len(wins),
                        "losses": len(losses),
                        "flats": len(flats),
                        "win_rate": (len(wins) / len(values)) * 100,
                        "total_pl": sum(pls),
                        "avg_pl": sum(pls) / len(pls),
                        "total_pl_pct": sum(pl_pcts),
                        "avg_pl_pct": sum(pl_pcts) / len(pl_pcts),
                        "best_pl": max(pls),
                        "worst_pl": min(pls),
                        "best_pl_pct": max(pl_pcts),
                        "worst_pl_pct": min(pl_pcts),
                        "avg_win": (sum(wins) / len(wins)) if wins else 0,
                        "avg_loss": (sum(losses) / len(losses)) if losses else 0,
                        "profit_factor": (gross_profit / gross_loss) if gross_loss > 0 else (None if gross_profit == 0 else gross_profit)
                    })
                # Merge capital-based simulation (equity curve, drawdown, return%, expectancy, sharpe)
                metrics.update(_simulate_horizon(rows, label))
                return metrics

            def _calculate_metrics(rows: List[Dict[str, Any]], n_steps: int, exit_basis: str) -> Dict[str, Any]:
                per_step = [_aggregate_label(rows, f"T+{step}", step) for step in range(1, n_steps + 1)]
                by_symbol: Dict[str, Dict[str, Any]] = {}

                final_label = f"T+{n_steps}"
                for row in rows:
                    symbol = row["symbol"]
                    if symbol not in by_symbol:
                        by_symbol[symbol] = {
                            "symbol": symbol,
                            "trades": 0,
                            "evaluated": 0,
                            "wins": 0,
                            "losses": 0,
                            "total_pl": 0,
                            "avg_pl": 0,
                            "avg_pl_pct": 0
                        }
                    by_symbol[symbol]["trades"] += 1
                    # Use the same realized-exit P/L as the headline metrics (item consistency),
                    # not the fixed final-horizon step, so the two win rates agree per symbol.
                    realized_step = row.get("steps", {}).get("REALIZED")
                    if not realized_step or realized_step.get("pl") is None:
                        continue
                    by_symbol[symbol]["evaluated"] += 1
                    pl = float(realized_step["pl"])
                    pl_pct = float(realized_step["pl_pct"])
                    by_symbol[symbol]["wins"] += 1 if pl > 0 else 0
                    by_symbol[symbol]["losses"] += 1 if pl < 0 else 0
                    by_symbol[symbol]["total_pl"] += pl
                    by_symbol[symbol]["avg_pl_pct"] += pl_pct

                for metrics in by_symbol.values():
                    evaluated = metrics["evaluated"]
                    if evaluated > 0:
                        metrics["avg_pl"] = metrics["total_pl"] / evaluated
                        metrics["avg_pl_pct"] = metrics["avg_pl_pct"] / evaluated
                        metrics["win_rate"] = (metrics["wins"] / evaluated) * 100
                    else:
                        metrics["win_rate"] = 0

                final_step_metrics = per_step[-1] if per_step else _empty_step_metrics(n_steps)
                return {
                    "pl_basis": exit_basis,
                    "exit_price_basis": exit_basis,
                    "final_horizon": final_label,
                    "total_entries": len(rows),
                    "capital": capital_cfg,
                    "final": final_step_metrics,
                    "per_step": per_step,
                    "by_symbol": sorted(by_symbol.values(), key=lambda item: item["total_pl"], reverse=True)
                }

            def _rule_warmup_start(start_dt: datetime, rule_def: Dict[str, Any], timeframe: str) -> datetime:
                warmup_bars = RuleEngine.estimate_rule_warmup(rule_def)

                if timeframe == "1d":
                    warmup_days = (warmup_bars * 2) + 10
                elif timeframe in {"1h", "4h"}:
                    warmup_days = max(14, warmup_bars // 4 + 7)
                else:
                    warmup_days = max(7, warmup_bars // 20 + 3)

                return start_dt - timedelta(days=warmup_days)

            # Create data source
            if request.data_source == 'ibkr':
                data_source = IBKRDataSource()
            else:
                data_source = CachedDataSource(
                    YahooDataSource(),
                    backtest_service.repository,
                    data_source_name='yahoo'
                )

            # Resolve symbols (rule mode requires explicit tickers; no fallback to the
            # live-trading active watchlist, since backtests must stay independent of it)
            symbols = [s.upper().strip() for s in (request.symbols or []) if s and s.strip()]
            if request.mode == "rule" and not symbols:
                raise ValueError("Rule mode requires at least one ticker symbol")

            entries = []
            candle_cache: Dict[str, List[Dict[str, Any]]] = {}

            async def _fetch_candles(symbol: str, start_dt: datetime, end_dt: datetime) -> List[Dict[str, Any]]:
                key = f"{symbol}|{start_dt.isoformat()}|{end_dt.isoformat()}|{request.timeframe}|{request.data_source}"
                if key in candle_cache:
                    return candle_cache[key]
                candles = await data_source.fetch_historical_data(
                    symbol=symbol,
                    start_date=start_dt,
                    end_date=end_dt,
                    timeframe=request.timeframe
                )
                candle_cache[key] = candles or []
                return candle_cache[key]

            # Build entries from rule mode
            if request.mode == "rule":
                if not request.rule_id:
                    raise ValueError("rule_id is required for rule mode")
                if not request.start_at or not request.end_at:
                    raise ValueError("start_at and end_at are required for rule mode")

                start_at = _normalize_dt(_parse_dt(request.start_at, "start_at"))
                end_at = _normalize_dt(_parse_dt(request.end_at, "end_at"))
                if end_at <= start_at:
                    raise ValueError("end_at must be later than start_at")

                rule = backtest_service.get_rule_for_user(request.rule_id, user_id)
                rule_to_evaluate = {**rule, **rule['definition']}
                rule_engine = RuleEngine()
                required_operands = _required_rule_operands(rule_to_evaluate)
                warmup_start_at = _rule_warmup_start(start_at, rule_to_evaluate, request.timeframe)

                for symbol in symbols:
                    candles = await _fetch_candles(symbol, warmup_start_at, end_at)
                    if not candles:
                        continue

                    indicator_engine = IndicatorEngine(timeframe=request.timeframe)
                    indicator_engine.set_required_operands(rule_to_evaluate)
                    cooldown_seconds = rule_to_evaluate.get('cooldown_sec', 60)
                    last_signal_ts = None

                    for candle in candles:
                        raw_ts = candle['timestamp']
                        ts = _normalize_dt(raw_ts)
                        ts_unix = ts.timestamp() if isinstance(ts, datetime) else float(ts)

                        candle_completed = indicator_engine.update_candle_data(
                            symbol=symbol,
                            open_price=candle['open'],
                            high=candle['high'],
                            low=candle['low'],
                            close=candle['close'],
                            timestamp=ts_unix,
                            volume=candle.get('volume', 0),
                            suppress_warnings=True
                        )
                        if not candle_completed:
                            continue
                        if not indicator_engine.is_symbol_ready(symbol):
                            continue
                        if ts < start_at:
                            continue
                        if last_signal_ts is not None and (ts_unix - last_signal_ts) < cooldown_seconds:
                            continue

                        indicators = indicator_engine.get_indicators(symbol)
                        if not indicators:
                            continue
                        if not _has_required_indicators(indicators, required_operands):
                            continue

                        if rule_engine.evaluate(rule_to_evaluate, indicators):
                            entries.append({
                                "symbol": symbol,
                                "entry_time": ts if isinstance(ts, datetime) else datetime.fromtimestamp(ts_unix),
                                "display_time": _wall_clock_iso(raw_ts) if isinstance(raw_ts, datetime) else None,
                                "entry_price": _basis_price(candle, entry_price_basis),
                                "entry_price_basis": entry_price_basis,
                                "signal_type": str(rule_to_evaluate.get('signal_type', 'BUY')).upper(),
                                "source": "rule"
                            })
                            last_signal_ts = ts_unix

            # Build entries from manual mode
            else:
                if not request.manual_entries or len(request.manual_entries) == 0:
                    raise ValueError("manual_entries is required for manual mode")

                for item in request.manual_entries:
                    entry_time = _normalize_dt(_parse_dt(item.entry_time, "manual_entries.entry_time"))
                    entries.append({
                        "symbol": item.symbol.upper().strip(),
                        "entry_time": entry_time,
                        "display_time": None,
                        "entry_price": float(item.entry_price) if item.entry_price is not None else None,
                        "entry_price_basis": "manual" if item.entry_price is not None else entry_price_basis,
                        "signal_type": (item.signal_type or "BUY").upper(),
                        "source": "manual"
                    })

            # --- Exit strategy setup (item #6) ---
            exit_strategy = request.exit_strategy
            exit_rule_to_evaluate = None
            exit_required_operands: set = set()
            exit_rule_engine = None
            if exit_strategy == 'exit_signal':
                if not request.exit_rule_id:
                    raise ValueError("exit_rule_id is required when exit_strategy is 'exit_signal'")
                exit_rule = backtest_service.get_rule_for_user(
                    request.exit_rule_id, user_id
                )
                exit_rule_to_evaluate = {**exit_rule, **exit_rule['definition']}
                exit_required_operands = _required_rule_operands(exit_rule_to_evaluate)
                exit_rule_engine = RuleEngine()
            elif exit_strategy == 'target_stop':
                if request.take_profit_pct is None and request.stop_loss_pct is None:
                    raise ValueError("target_stop requires take_profit_pct and/or stop_loss_pct")

            def _make_realized(c: Dict[str, Any], step: int, exit_price: float, reason: str,
                               entry_price: float, signal_type: str) -> Dict[str, Any]:
                trade_pl = _calculate_trade_pl(signal_type, float(entry_price), float(exit_price))
                return {
                    "time": _wall_clock_iso(c['timestamp']) if isinstance(c['timestamp'], datetime) else str(c['timestamp']),
                    "step": step,
                    "open": float(c['open']),
                    "high": float(c['high']),
                    "low": float(c['low']),
                    "close": float(c['close']),
                    "exit_price": float(exit_price),
                    "exit_reason": reason,
                    "basis": exit_price_basis,
                    "basis_price": float(exit_price),
                    "pl": trade_pl["pl"],
                    "pl_pct": trade_pl["pl_pct"],
                }

            def _time_exit(candles: List[Dict[str, Any]], idx: int, cap: int,
                           entry_price: float, signal_type: str) -> Optional[Dict[str, Any]]:
                ci = min(idx + cap, len(candles) - 1)
                if ci <= idx:
                    return None
                c = candles[ci]
                return _make_realized(c, ci - idx, _basis_price(c, exit_price_basis), 'time_exit',
                                      entry_price, signal_type)

            def _realized_target_stop(candles: List[Dict[str, Any]], idx: int,
                                      entry_price: float, signal_type: str) -> Optional[Dict[str, Any]]:
                sign = -1 if signal_type == 'SELL' else 1
                tp = request.take_profit_pct
                sl = request.stop_loss_pct
                cap = request.n_steps
                for step in range(1, cap + 1):
                    ci = idx + step
                    if ci >= len(candles):
                        break
                    c = candles[ci]
                    high = float(c['high'])
                    low = float(c['low'])
                    if sign == 1:  # long
                        sl_price = entry_price * (1 - sl / 100) if sl else None
                        tp_price = entry_price * (1 + tp / 100) if tp else None
                        hit_sl = sl_price is not None and low <= sl_price
                        hit_tp = tp_price is not None and high >= tp_price
                    else:  # short
                        sl_price = entry_price * (1 + sl / 100) if sl else None
                        tp_price = entry_price * (1 - tp / 100) if tp else None
                        hit_sl = sl_price is not None and high >= sl_price
                        hit_tp = tp_price is not None and low <= tp_price
                    # Conservative: if both touched in the same candle, assume stop first
                    if hit_sl:
                        return _make_realized(c, step, sl_price, 'stop_loss', entry_price, signal_type)
                    if hit_tp:
                        return _make_realized(c, step, tp_price, 'take_profit', entry_price, signal_type)
                return _time_exit(candles, idx, cap, entry_price, signal_type)

            async def _realized_exit_signal(symbol: str, entry_time: datetime, idx_time: datetime,
                                            entry_price: float, signal_type: str) -> Optional[Dict[str, Any]]:
                # Fetch a warmup-prefixed window so exit-rule indicators are valid
                warmup_start = _rule_warmup_start(entry_time, exit_rule_to_evaluate, request.timeframe)
                lookahead_days = 365 if request.timeframe in ('1d',) else 90
                wcandles = await _fetch_candles(
                    symbol,
                    warmup_start,
                    entry_time.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=lookahead_days)
                )
                if not wcandles:
                    return None
                ie = IndicatorEngine(timeframe=request.timeframe)
                ie.set_required_operands(exit_rule_to_evaluate)
                entry_idx = None
                steps_after = 0
                for j, c in enumerate(wcandles):
                    cts = _normalize_dt(c['timestamp'])
                    ts_unix = cts.timestamp() if isinstance(cts, datetime) else float(cts)
                    completed = ie.update_candle_data(
                        symbol=symbol, open_price=c['open'], high=c['high'], low=c['low'],
                        close=c['close'], timestamp=ts_unix, volume=c.get('volume', 0),
                        suppress_warnings=True
                    )
                    if entry_idx is None:
                        if cts >= entry_time:
                            entry_idx = j
                        continue
                    # candles strictly after entry
                    steps_after += 1
                    if steps_after > request.n_steps:
                        break
                    if not completed or not ie.is_symbol_ready(symbol):
                        continue
                    indicators = ie.get_indicators(symbol)
                    if not indicators or not _has_required_indicators(indicators, exit_required_operands):
                        continue
                    if exit_rule_engine.evaluate(exit_rule_to_evaluate, indicators):
                        return _make_realized(c, steps_after, _basis_price(c, exit_price_basis),
                                              'exit_signal', entry_price, signal_type)
                # No exit signal within cap -> force time exit at cap using the same warmup window
                if entry_idx is not None:
                    return _time_exit(wcandles, entry_idx, request.n_steps, entry_price, signal_type)
                return None

            # Enrich entries with T+1 ... T+n OHLC
            rows = []
            for entry in entries:
                symbol = entry["symbol"]
                entry_time = _normalize_dt(entry["entry_time"])

                # pull wider range so we can include next n candles
                lookahead_days = 365 if request.timeframe in ('1d',) else 90
                candles = await _fetch_candles(
                    symbol,
                    entry_time.replace(hour=0, minute=0, second=0, microsecond=0),
                    entry_time.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=lookahead_days)
                )
                if not candles:
                    continue

                # find first candle >= entry_time
                idx = None
                for i, c in enumerate(candles):
                    cts = _normalize_dt(c['timestamp'])
                    if cts >= entry_time:
                        idx = i
                        break
                if idx is None:
                    continue

                entry_candle = candles[idx]
                entry_basis = entry.get("entry_price_basis") or entry_price_basis
                entry_price = entry["entry_price"] if entry["entry_price"] is not None else _basis_price(entry_candle, entry_price_basis)

                step_values = {}
                signal_type = str(entry.get("signal_type", "BUY")).upper()
                for step in range(1, request.n_steps + 1):
                    ci = idx + step
                    if ci >= len(candles):
                        step_values[f"T+{step}"] = None
                        continue
                    c = candles[ci]
                    basis_price = _basis_price(c, exit_price_basis)
                    trade_pl = _calculate_trade_pl(signal_type, float(entry_price), basis_price)
                    step_values[f"T+{step}"] = {
                        "time": _wall_clock_iso(c['timestamp']) if isinstance(c['timestamp'], datetime) else str(c['timestamp']),
                        "open": float(c['open']),
                        "high": float(c['high']),
                        "low": float(c['low']),
                        "close": float(c['close']),
                        "basis": exit_price_basis,
                        "exit_price_basis": exit_price_basis,
                        "basis_price": basis_price,
                        "exit_price": basis_price,
                        "pl": trade_pl["pl"],
                        "pl_pct": trade_pl["pl_pct"]
                    }

                # Realized exit (item #6): resolve the single actual exit per chosen strategy
                if exit_strategy == 'target_stop':
                    realized = _realized_target_stop(candles, idx, float(entry_price), signal_type)
                elif exit_strategy == 'exit_signal':
                    realized = await _realized_exit_signal(symbol, entry_time, entry_time,
                                                           float(entry_price), signal_type)
                else:  # holding_period
                    realized = _time_exit(candles, idx, request.n_steps, float(entry_price), signal_type)
                if realized is not None:
                    step_values["REALIZED"] = realized

                rows.append({
                    "symbol": symbol,
                    "signal_type": signal_type,
                    "entry_time": entry.get("display_time") or _utc_iso(entry_time),
                    "entry_price": float(entry_price),
                    "entry_price_basis": entry_basis,
                    "source": entry["source"],
                    "steps": step_values
                })

            metrics = _calculate_metrics(rows, request.n_steps, exit_price_basis)
            # Realized-exit aggregate (used as headline when exit_strategy != holding_period)
            metrics["realized"] = _aggregate_label(rows, "REALIZED", request.n_steps)
            metrics["exit_strategy"] = exit_strategy

            # Persist run for reproducibility (item #3). Best-effort; never blocks the response.
            try:
                def _lean(step: Dict[str, Any]) -> Dict[str, Any]:
                    return {k: v for k, v in step.items() if k != "equity_curve"}

                screen_config = {
                    "mode": request.mode,
                    "timeframe": request.timeframe,
                    "n_steps": request.n_steps,
                    "data_source": request.data_source,
                    "entry_price_basis": entry_price_basis,
                    "exit_price_basis": exit_price_basis,
                    "rule_id": request.rule_id,
                    "start_at": request.start_at,
                    "end_at": request.end_at,
                    "symbols": symbols if request.mode == "rule" else None,
                    "capital": capital_cfg,
                    "exit_strategy": exit_strategy,
                    "exit_rule_id": request.exit_rule_id,
                    "take_profit_pct": request.take_profit_pct,
                    "stop_loss_pct": request.stop_loss_pct,
                }
                screen_summary = {
                    "total_entries": metrics.get("total_entries"),
                    "final": _lean(metrics.get("final", {})),
                    "realized": _lean(metrics.get("realized", {})),
                    "per_step": [_lean(s) for s in metrics.get("per_step", [])],
                }
                backtest_service.create_screen_run(
                    user_id=user_id,
                    mode=request.mode,
                    timeframe=request.timeframe,
                    exit_strategy=exit_strategy,
                    row_count=len(rows),
                    config=screen_config,
                    summary=screen_summary,
                )
            except Exception as persist_err:
                logger.warning(f"Failed to persist backtest screen run: {persist_err}")

            return {
                "mode": request.mode,
                "timeframe": request.timeframe,
                "n_steps": request.n_steps,
                "entry_price_basis": entry_price_basis,
                "exit_price_basis": exit_price_basis,
                "pl_basis": exit_price_basis,
                "capital": capital_cfg,
                "exit_strategy": exit_strategy,
                "exit_config": {
                    "exit_rule_id": request.exit_rule_id,
                    "take_profit_pct": request.take_profit_pct,
                    "stop_loss_pct": request.stop_loss_pct,
                },
                "row_count": len(rows),
                "metrics": metrics,
                "rows": rows
            }

        except BacktestNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Backtest rule not found",
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )
        except Exception as e:
            logger.error(f"Backtest screen error: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Backtest screen failed: {str(e)}"
            )

    @router.get("/api/backtest/screen/runs")
    async def list_backtest_screen_runs(
        limit: int = 50,
        current_user=Depends(get_current_user),
    ):
        """List recent backtest screen runs (config + summary) for reproducibility."""
        try:
            return backtest_service.list_screen_runs(str(current_user.id), limit)
        except Exception as e:
            logger.error(f"Error listing backtest screen runs: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal server error"
            )

    @router.get("/api/data/summary")
    def get_data_summary(current_user=Depends(get_current_user)):
        """Cache coverage summary for the Dashboard (symbols, range, last refresh)."""
        try:
            return backtest_service.repository.get_price_cache_summary()
        except Exception as e:
            logger.error(f"Error getting data summary: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to get data summary"
            )

    @router.get("/api/backtest/screen/runs/{run_id}")
    async def get_backtest_screen_run(
        run_id: int,
        current_user=Depends(get_current_user),
    ):
        """Fetch a single persisted backtest screen run by ID."""
        try:
            return backtest_service.get_screen_run(run_id, str(current_user.id))
        except BacktestNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Backtest screen run {run_id} not found"
            )

    @router.delete("/api/backtest/screen/runs")
    def delete_all_backtest_screen_runs(current_user=Depends(get_current_user)):
        """Delete all persisted backtest screen runs (clear history)."""
        try:
            deleted = backtest_service.delete_all_screen_runs(str(current_user.id))
            return {"message": "All backtest runs cleared", "deleted": deleted}
        except Exception as e:
            logger.error(f"Error clearing backtest screen runs: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal server error"
            )

    @router.delete("/api/backtest/screen/runs/{run_id}")
    def delete_backtest_screen_run(
        run_id: int,
        current_user=Depends(get_current_user),
    ):
        """Delete a persisted backtest screen run."""
        try:
            backtest_service.delete_screen_run(run_id, str(current_user.id))
            return {"message": "Backtest run deleted successfully"}
        except BacktestNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Backtest screen run {run_id} not found",
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error deleting backtest screen run {run_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal server error"
            )

    @router.post("/api/backtest/export-csv")
    async def export_backtest_csv(
        request: Request,
        current_user=Depends(get_current_user),
    ):
        """Return client-supplied CSV as a file download.

        Triggered via a form POST so the WebView2/PyWebView runtime saves the
        file through its native download manager (blob/`download`-attribute
        downloads are unreliable inside the embedded webview).
        """
        from urllib.parse import parse_qs
        import re as _re

        raw = (await request.body()).decode("utf-8", errors="replace")
        fields = parse_qs(raw, keep_blank_values=True)
        csv_text = (fields.get("csv") or [""])[0]
        filename = (fields.get("filename") or ["backtest.csv"])[0]
        safe = _re.sub(r'[^A-Za-z0-9._-]', '_', filename)[:80] or "backtest.csv"
        if not safe.lower().endswith(".csv"):
            safe += ".csv"
        return Response(
            content=csv_text,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{safe}"'}
        )

    @router.post("/api/backtest/run")
    async def run_backtest(
        request: BacktestRequest,
        current_user=Depends(get_current_user),
    ):
        """
        Run a backtest with historical data.

        Request body:
            name: Backtest run name
            mode: 'scalping' or 'swing'
            rule_id: Rule ID to test
            symbols: List of symbols
            timeframe: Candle timeframe
            start_date: ISO date string
            end_date: ISO date string
            data_source: 'ibkr' or 'yahoo'
        """
        try:
            logger.info(f"Starting backtest: {request.name}")
            results = await backtest_service.run(request, str(current_user.id))

            return {
                "message": "Backtest completed successfully",
                "backtest_run_id": results['backtest_run_id'],
                "total_signals": results['metrics']['total_signals'],
                "metrics": results['metrics']
            }

        except BacktestNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Backtest rule not found",
            )
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )
        except Exception as e:
            logger.error(f"Backtest error: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Backtest failed: {str(e)}"
            )

    @router.get("/api/backtest/runs")
    def get_backtest_runs(current_user=Depends(get_current_user)):
        """Get all backtest runs."""
        try:
            runs = backtest_service.list_runs(str(current_user.id))
            return {"runs": runs}
        except Exception as e:
            logger.error(f"Error getting backtest runs: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal server error"
            )

    @router.get("/api/backtest/runs/{run_id}")
    def get_backtest_run(
        run_id: int,
        current_user=Depends(get_current_user),
    ):
        """Get specific backtest run with signals."""
        try:
            return backtest_service.get_run(run_id, str(current_user.id))
        except BacktestNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Backtest run {run_id} not found",
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error getting backtest run {run_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal server error"
            )

    @router.delete("/api/backtest/runs/{run_id}")
    def delete_backtest_run(
        run_id: int,
        current_user=Depends(get_current_user),
    ):
        """Delete a backtest run."""
        try:
            backtest_service.delete_run(run_id, str(current_user.id))
            return {"message": "Backtest run deleted successfully"}
        except BacktestNotFoundError:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Backtest run {run_id} not found",
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error deleting backtest run {run_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal server error"
            )

    return router
