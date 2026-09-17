"""Print the frozen Python signal baseline for the Go parity fixture.

This script does not write files. Its output is reviewed and copied into the
fixture so the committed golden result cannot silently change with a library
upgrade.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import ta

from app.core.rule_engine import RuleEngine


BACKEND_DIR = Path(__file__).resolve().parents[1]
FIXTURE_PATH = BACKEND_DIR / "core" / "testdata" / "default_scalping_v1.json"


def main() -> None:
    fixture = json.loads(FIXTURE_PATH.read_text())
    request = fixture["request"]
    candles = request["candles"]
    rule = request["rule"]
    closes = pd.Series([float(candle["close"]) for candle in candles])

    ema9 = ta.trend.ema_indicator(closes, window=9)
    ema20 = ta.trend.ema_indicator(closes, window=20)
    rsi14 = ta.momentum.rsi(closes, window=14)
    evaluator = RuleEngine()
    signals = []

    for index, candle in enumerate(candles):
        # Match IndicatorEngine readiness: RSI14 requires period + 1 candles.
        if index + 1 < 15:
            continue
        values = {
            "PRICE": float(candle["close"]),
            "EMA9": float(ema9.iloc[index]),
            "EMA20": float(ema20.iloc[index]),
            "RSI14": float(rsi14.iloc[index]),
        }
        if any(pd.isna(value) for value in values.values()):
            continue
        if evaluator.evaluate(rule, values):
            signals.append(
                {
                    "timestamp": candle["timestamp"],
                    "price": float(candle["close"]),
                    "indicators": values,
                }
            )

    print(json.dumps({"signals": signals}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
