"""Build authorized candle and indicator data for swing charts."""

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from app.core.rule_engine import RuleEngine
from app.services.rule_service import RuleService
from app.storage.sqlite_repo import SQLiteRepository


class SwingChartService:
    """Calculate chart payloads after resolving a rule for the current user."""

    def __init__(
        self,
        repository: SQLiteRepository,
        rule_service: RuleService,
    ):
        self.repository = repository
        self.rule_service = rule_service
        self.logger = logging.getLogger(__name__)

    async def build(
        self,
        symbol: str,
        timeframe: str,
        timestamp: str,
        rule_id: int,
        user_id: str,
        before: int = 80,
        after: int = 40,
    ) -> Dict[str, Any]:
        import math
        import pandas as pd
        import ta
        import talib
        from datetime import timezone
        from app.data_sources import CachedDataSource, YahooDataSource

        if timeframe not in {"1h", "4h", "1d"}:
            raise ValueError("timeframe must be one of: 1h, 4h, 1d")
        before = min(250, max(10, before))
        after = min(120, max(0, after))
        symbol = symbol.upper().strip()
        if not symbol:
            raise ValueError("symbol is required")

        rule = self.rule_service.get_for_user(
            rule_id,
            user_id,
        )

        signal_dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        if signal_dt.tzinfo is not None:
            signal_dt = signal_dt.astimezone(timezone.utc).replace(tzinfo=None)

        rule_to_evaluate = {**rule, **rule['definition']}
        operands = RuleEngine.extract_required_operands(rule_to_evaluate)
        base_operands = set()
        for operand in operands:
            if not isinstance(operand, str) or RuleEngine._is_numeric_literal(operand):
                continue
            prev_n = RuleEngine.parse_prev_n_operand(operand)
            if prev_n:
                base_operands.add(prev_n["base"])
            elif operand.endswith("_PREV"):
                base_operands.add(operand[:-5])
            else:
                base_operands.add(operand)
        base_operands = sorted(base_operands)

        total_bars = before + after + RuleEngine.estimate_rule_warmup(rule_to_evaluate, default=80)
        if timeframe == "1d":
            fetch_days = (total_bars * 2) + 10
        elif timeframe == "4h":
            fetch_days = max(60, total_bars // 2 + 20)
        else:
            fetch_days = max(30, total_bars // 4 + 14)

        data_source = CachedDataSource(
            YahooDataSource(),
            self.repository,
            data_source_name='yahoo'
        )
        candles = await data_source.fetch_historical_data(
            symbol=symbol,
            start_date=signal_dt - timedelta(days=fetch_days),
            end_date=signal_dt + timedelta(days=fetch_days),
            timeframe=timeframe
        )
        if not candles:
            raise ValueError("No chart data available")

        def _normalize_dt(value: Any) -> datetime:
            if isinstance(value, datetime):
                if value.tzinfo is not None:
                    return value.astimezone(timezone.utc).replace(tzinfo=None)
                return value
            return datetime.fromtimestamp(float(value))

        indexed = [(idx, _normalize_dt(candle['timestamp']), candle) for idx, candle in enumerate(candles)]
        nearest_idx, _, _ = min(
            indexed,
            key=lambda item: abs((item[1] - signal_dt).total_seconds())
        )
        start_idx = max(0, nearest_idx - before)
        end_idx = min(len(candles), nearest_idx + after + 1)
        visible_candles = candles[start_idx:end_idx]

        df = pd.DataFrame({
            'timestamp': [_normalize_dt(c['timestamp']) for c in candles],
            'open': [float(c['open']) for c in candles],
            'high': [float(c['high']) for c in candles],
            'low': [float(c['low']) for c in candles],
            'close': [float(c['close']) for c in candles],
            'volume': [float(c.get('volume', 0) or 0) for c in candles],
        })

        def _chart_time(value: datetime) -> int:
            return int(value.replace(tzinfo=timezone.utc).timestamp())

        def _series_points(values) -> List[Dict[str, Any]]:
            points = []
            for idx in range(start_idx, end_idx):
                value = values.iloc[idx] if hasattr(values, "iloc") else values[idx]
                if value is None or pd.isna(value):
                    continue
                numeric = float(value)
                if not math.isfinite(numeric):
                    continue
                points.append({
                    "time": _chart_time(df['timestamp'].iloc[idx]),
                    "value": numeric
                })
            return points

        def _candle_pattern_values(operand: str) -> Optional[pd.Series]:
            definition = RuleEngine.CANDLE_PATTERN_DEFINITIONS.get(operand)
            if not definition:
                return None
            pattern_func = getattr(talib, definition["talib"], None)
            if pattern_func is None:
                return None
            raw = pd.Series(
                pattern_func(
                    df['open'].astype(float).to_numpy(),
                    df['high'].astype(float).to_numpy(),
                    df['low'].astype(float).to_numpy(),
                    df['close'].astype(float).to_numpy(),
                ),
                index=df.index,
            )
            direction = definition.get("direction")
            if direction == "bullish":
                return (raw > 0).astype(float)
            if direction == "bearish":
                return (raw < 0).astype(float)
            return (raw != 0).astype(float)

        def _pattern_markers_from_operand(operand: str) -> Optional[Dict[str, Any]]:
            definition = RuleEngine.CANDLE_PATTERN_DEFINITIONS.get(operand)
            values = _candle_pattern_values(operand)
            if definition is None or values is None:
                return None

            direction = definition.get("direction", "neutral")
            bullish = direction == "bullish"
            bearish = direction == "bearish"
            markers = []
            for idx in range(start_idx, end_idx):
                value = values.iloc[idx]
                if value is None or pd.isna(value) or float(value) <= 0:
                    continue
                markers.append({
                    "time": _chart_time(df['timestamp'].iloc[idx]),
                    "position": "aboveBar" if bearish else "belowBar",
                    "color": "#dc2626" if bearish else ("#16a34a" if bullish else "#7c3aed"),
                    "shape": "arrowDown" if bearish else ("arrowUp" if bullish else "circle"),
                    "text": definition["label"],
                })

            if not markers:
                return None
            return {
                "id": operand,
                "label": definition["label"],
                "panel": "pattern",
                "type": "marker",
                "enabled": True,
                "direction": direction,
                "markers": markers,
            }

        def _series_from_operand(operand: str) -> Optional[Dict[str, Any]]:
            base = operand[:-5] if operand.endswith("_PREV") else operand
            parsed = RuleEngine.parse_dynamic_operand(base)
            panel = "overlay"
            series_type = "line"
            values = None

            if base in RuleEngine.CANDLE_PATTERN_OPERANDS:
                return _pattern_markers_from_operand(base)
            if base in {"PRICE", "PREV_CLOSE", "PREV_OPEN"} or base.startswith("PRICE_PREV_"):
                return None
            if parsed:
                period = parsed["period"]
                operand_type = parsed["type"]
                if operand_type == "MA_N":
                    values = ta.trend.sma_indicator(df['close'], window=period)
                elif operand_type == "EMA_N":
                    values = ta.trend.ema_indicator(df['close'], window=period)
                elif operand_type == "RSI_N":
                    values = ta.momentum.rsi(df['close'], window=period)
                    panel = "oscillator"
                elif operand_type == "ADX_N":
                    values = ta.trend.adx(df['high'], df['low'], df['close'], window=period)
                    panel = "oscillator"
                elif operand_type == "SMA_VOLUME_N":
                    values = ta.trend.sma_indicator(df['volume'], window=period)
                    panel = "volume"
                elif operand_type == "REL_VOLUME_N":
                    sma_volume = ta.trend.sma_indicator(df['volume'], window=period)
                    values = df['volume'] / sma_volume.where(sma_volume != 0)
                    panel = "volume"
                else:
                    return None
            elif base.startswith("MA") and base[2:].isdigit():
                values = ta.trend.sma_indicator(df['close'], window=int(base[2:]))
            elif base.startswith("EMA") and base[3:].isdigit():
                values = ta.trend.ema_indicator(df['close'], window=int(base[3:]))
            elif base.startswith("RSI") and base[3:].isdigit():
                values = ta.momentum.rsi(df['close'], window=int(base[3:]))
                panel = "oscillator"
            elif base.startswith("ADX") and base[3:].isdigit():
                values = ta.trend.adx(df['high'], df['low'], df['close'], window=int(base[3:]))
                panel = "oscillator"
            elif base == "MACD":
                values = ta.trend.macd(df['close'])
                panel = "macd"
            elif base == "MACD_SIGNAL":
                values = ta.trend.macd_signal(df['close'])
                panel = "macd"
            elif base == "MACD_HIST":
                values = ta.trend.macd_diff(df['close'])
                panel = "macd"
                series_type = "histogram"
            elif base in {"BB_UPPER", "BB_MIDDLE", "BB_LOWER"}:
                if base == "BB_UPPER":
                    values = ta.volatility.bollinger_hband(df['close'])
                elif base == "BB_MIDDLE":
                    values = ta.volatility.bollinger_mavg(df['close'])
                else:
                    values = ta.volatility.bollinger_lband(df['close'])
            elif base == "STOCH_K":
                values = ta.momentum.stoch(df['high'], df['low'], df['close'])
                panel = "oscillator"
            elif base == "STOCH_D":
                values = ta.momentum.stoch_signal(df['high'], df['low'], df['close'])
                panel = "oscillator"
            elif base == "VOLUME":
                values = df['volume']
                panel = "volume"
                series_type = "histogram"
            elif base == "SMA_VOLUME_20":
                values = ta.trend.sma_indicator(df['volume'], window=20)
                panel = "volume"
            elif base == "REL_VOLUME_20":
                sma_volume = ta.trend.sma_indicator(df['volume'], window=20)
                values = df['volume'] / sma_volume.where(sma_volume != 0)
                panel = "volume"
            else:
                return None

            points = _series_points(values)
            if not points:
                return None
            return {
                "id": base,
                "label": base,
                "panel": panel,
                "type": series_type,
                "enabled": True,
                "points": points
            }

        indicator_series = []
        seen = set()
        for operand in base_operands:
            try:
                series = _series_from_operand(operand)
            except Exception as ex:
                self.logger.debug(f"Skipping chart indicator {operand}: {ex}")
                series = None
            if series and series["id"] not in seen:
                indicator_series.append(series)
                seen.add(series["id"])

        response_candles = []
        for candle in visible_candles:
            candle_dt = _normalize_dt(candle['timestamp'])
            response_candles.append({
                "time": _chart_time(candle_dt),
                "timestamp": candle_dt.isoformat(),
                "open": float(candle['open']),
                "high": float(candle['high']),
                "low": float(candle['low']),
                "close": float(candle['close']),
                "volume": int(candle.get('volume', 0) or 0)
            })

        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "rule_id": rule_id,
            "rule_name": rule.get("name"),
            "signal_timestamp": signal_dt.isoformat(),
            "signal_time": _chart_time(signal_dt),
            "before": before,
            "after": after,
            "candles": response_candles,
            "indicators": indicator_series,
            "rule_operands": base_operands,
            "rule": {
                "id": rule_id,
                "name": rule.get("name"),
                "type": rule.get("type"),
                "is_system": bool(rule.get("is_system")),
                "logic": rule_to_evaluate.get("logic", "AND"),
                "signal_type": rule_to_evaluate.get("signal_type", "BUY"),
                "conditions": rule_to_evaluate.get("conditions", []),
                "cooldown_sec": rule_to_evaluate.get("cooldown_sec")
            }
        }
