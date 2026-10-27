#!/usr/bin/env python3
"""Export explicit, reviewable golden data from the archived Claudio engine.

Run with the baseline's Python environment (ta, pandas, numpy, TA-Lib installed).
Never import the application, its configuration, storage, network or credentials.
"""
import ast
import hashlib
import importlib.metadata
import json
import math
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LEGACY = ROOT / "legacy/python/app/core"


def baseline():
    namespace = {"__name__": "claudio_fixture"}
    for filename in ("rule_engine.py", "indicator_engine.py"):
        tree = ast.parse((LEGACY / filename).read_text())
        tree.body = [n for n in tree.body if not isinstance(n, ast.ImportFrom) or n.level == 0]
        exec(compile(tree, filename, "exec"), namespace)
    namespace["CandleBuilder"] = lambda **_: None
    return namespace["RuleEngine"], namespace["IndicatorEngine"], namespace


def export():
    rule, indicator, ns = baseline()
    catalog = {
        "version": "claudio-indicators-1",
        "source_sha256": hashlib.sha256((LEGACY / "indicator_engine.py").read_text().encode()).hexdigest(),
        "operands": sorted(rule.SUPPORTED_OPERANDS),
        "crossable": rule.get_crossable_operands(),
        "max_period": rule.MAX_DYNAMIC_PERIOD,
        "patterns": rule.CANDLE_PATTERN_DEFINITIONS,
    }
    (ROOT / "backend/core/indicator_catalog.json").write_text(json.dumps(catalog, indent=2) + "\n")
    (ROOT / "frontend/web/src/lib/indicator-catalog.ts").write_text("// Generated from the archived Claudio RuleEngine; do not edit by hand.\nexport const claudioOperands: string[] = " + json.dumps(catalog["operands"], indent=2) + ";\n")
    extra = ["MA7", "EMA12", "RSI7", "ADX14", "SMA_VOLUME_7", "REL_VOLUME_7", "EMA250", "ADX250",
             "PRICE_PREV_250", "EMA20_PREV_3", "MACD_PREV_5", "RSI14_PREV_3", "ADX5_PREV_3",
             "ICHIMOKU_B_PREV_2", "REL_VOLUME_20_PREV_2", "PATTERN_CDLDOJI_PREV_2", "EMA250_PREV_250", "ADX250_PREV_250", "MA1", "EMA1", "RSI1", "ADX1", "SMA_VOLUME_1", "REL_VOLUME_1", "MA250", "RSI250", "SMA_VOLUME_250", "REL_VOLUME_250"]
    operands = sorted(set(catalog["operands"] + extra))
    rng = random.Random(73021)
    candles = []
    for i in range(780):
        mid = 100 + math.sin(i * .17) * 15 + i * .015
        op, close = mid + rng.uniform(-5, 5), mid + rng.uniform(-5, 5)
        if i % 13 == 0:
            close = op + .005
        candles.append({"timestamp": (datetime(2020, 1, 1, tzinfo=timezone.utc) + timedelta(days=i)).isoformat().replace("+00:00", "Z"),
                        "open": op, "high": max(op, close) + rng.uniform(.01, 4),
                        "low": min(op, close) - rng.uniform(.01, 4), "close": close,
                        "volume": 0 if i < 23 else rng.randrange(100, 10000)})
    # Deliberately include every pattern's positive case, with enough averaging history.
    patterns = {
        70: [(100, 101, 90, 91), (89, 90, 87, 88), (89, 99, 88, 98)],
        100: [(90, 101, 89, 100), (102, 104, 101, 103), (102, 103, 92, 93)],
        140: [(100, 101, 90, 91), (89, 102, 88, 101)],
        170: [(90, 101, 89, 100), (102, 103, 90, 91)],
        200: [(110, 112, 98, 100), (102, 104, 101, 103)],
        230: [(110, 112, 98, 100), (97, 108, 96, 107)],
        260: [(100, 112, 99, 110), (113, 114, 102, 103)],
        290: [(100, 102, 99, 101), (103, 113, 102.99, 103.1)],
        320: [(100, 102, 99, 101), (99, 99.11, 89, 99.1)],
    }
    for start, bars in patterns.items():
        for offset, (op, hi, lo, close) in enumerate(bars):
            candles[start + offset].update(open=op, high=hi, low=lo, close=close)
    engine = indicator(max_history=2000)
    engine.set_required_operands(operands)
    points = set([19, 20, 22, 23, 25, 26, 33, 34, 35, 50, 51, 52, 198, 199, 249, 250, 498, 499, 500, 749, 750, 779])
    points.update(i for start, bars in patterns.items() for i in range(start, start + len(bars) + 1))
    expected = []
    for i in range(len(candles)):
        engine.candle_data["TEST"] = candles[:i + 1]
        if "TEST" in engine.indicators:
            engine.prev_indicators["TEST"] = engine.indicators["TEST"].copy()
        engine._calculate_indicators_for_symbol("TEST", suppress_warnings=True)
        if i in points:
            values = engine.get_indicators("TEST")
            expected.append({"index": i, "values": {k: values.get(k) for k in operands}})
    # Flat/zero volume is a separate fixture: no epsilon or invented values.
    edge = [{**c, "open": 100., "high": 100., "low": 100., "close": 100., "volume": 0} for c in candles[:65]]
    flat = indicator(max_history=2000)
    flat.set_required_operands(operands)
    for i in range(len(edge)):
        flat.candle_data["TEST"] = edge[:i + 1]
        if "TEST" in flat.indicators:
            flat.prev_indicators["TEST"] = flat.indicators["TEST"].copy()
        flat._calculate_indicators_for_symbol("TEST", suppress_warnings=True)
    result = {"source": catalog["source_sha256"], "ta_version": importlib.metadata.version("ta"),
              "talib_version": ns["talib"].__version__, "request": {"purpose": "screen", "symbol": "TEST", "candles": candles},
              "operands": operands, "expected": expected, "flat_candles": edge,
              "flat_values": {k: flat.get_indicators("TEST").get(k) for k in operands}}
    (ROOT / "backend/core/testdata/claudio_indicators_v1.json").write_text(json.dumps(result, separators=(",", ":"), allow_nan=False) + "\n")
    print(f"Exported {len(catalog['operands'])} operands, {len(expected)} checkpoints; TA-Lib {ns['talib'].__version__}")


if __name__ == "__main__":
    export()
