"""Check the frozen formula-only legacy fixture without loading FastAPI/providers."""
import ast
import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List

root = Path(__file__).resolve().parents[2]
source = root / 'legacy/python/app/api/routes/backtests.py'
fixture = json.loads((root / 'backend/core/testdata/claudio_backtest_formula_v1.json').read_text())
raw = source.read_bytes()
assert hashlib.sha256(raw).hexdigest() == fixture['source_sha256'], 'Legacy source changed; review and re-freeze intentionally'
tree = ast.parse(raw)
names = {'_calculate_trade_pl', '_simulate_horizon'}
functions = [node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and node.name in names]
assert len(functions) == 2
scope = dict(Any=Any, Dict=Dict, List=List, capital_cfg=dict(initial_capital=fixture['initial_capital'], position_sizing='percent_equity', position_size=100, commission_pct=0, slippage_pct=0))
exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), 'exec'), scope)
prices = scope['_calculate_trade_pl']('BUY', fixture['entry_price'], fixture['exit_price'])
metrics = scope['_simulate_horizon']([dict(symbol='TEST', signal_type='BUY', entry_time='2026-01-01', entry_price=fixture['entry_price'], steps={'T+1': dict(exit_price=fixture['exit_price'], time='2026-01-02')})], 'T+1')
for key, expected in fixture['expected'].items():
    actual = (prices if key in prices else metrics)[key]
    assert abs(actual - expected) <= 1e-9 + abs(expected) * 1e-12, (key, actual, expected)
print('Claudio frozen price/capital formula verified against exact legacy functions')
