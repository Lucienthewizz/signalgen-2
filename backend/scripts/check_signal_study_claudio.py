"""Frozen legacy price/TP/SL comparison; no provider, auth, TA dependency or legacy edit."""
import ast
import hashlib
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, List, Optional
from datetime import datetime

root=Path(__file__).resolve().parents[2]
f=json.loads((root/'backend/core/testdata/signal_study_claudio_v1.json').read_text())
source=root/f['legacy_source'];raw=source.read_bytes()
assert hashlib.sha256(raw).hexdigest()==f['source_sha256'],'Review changed legacy source before comparing'
base_raw=(root/'backend/core/testdata'/f['base_fixture']).read_bytes()
assert hashlib.sha256(base_raw).hexdigest()==f['base_sha256'],'Frozen input changed'
base=json.loads(base_raw)
names={'_calculate_trade_pl','_basis_price','_make_realized','_time_exit','_realized_target_stop'}
functions=[n for n in ast.walk(ast.parse(raw)) if isinstance(n,ast.FunctionDef) and n.name in names]
assert len(functions)==len(names)
request=SimpleNamespace(n_steps=1,take_profit_pct=5,stop_loss_pct=3)
scope=dict(Any=Any,Dict=Dict,List=List,Optional=Optional,datetime=datetime,exit_price_basis='close',request=request)
exec(compile(ast.Module(body=functions,type_ignores=[]),str(source),'exec'),scope)

def native(side='BUY',swing=False,horizon=1):
    config=dict(f['config'])
    config['n_steps']=horizon
    if swing: config.update(n_steps=3,take_profit_pct=5,stop_loss_pct=3)
    data=dict(schema_version='signal-study-1',config=config,series=base['series'],entries=[dict(e,signal_type=side) for e in base['entries']])
    return json.loads(subprocess.check_output(['go','run','./cmd/signalstudy'],cwd=root/'backend',input=json.dumps(data).encode()))

compared=0
for side in ('BUY','SELL'):
    result=native(side)
    assert result['swing']['signals']==4 and result['swing']['missing']==1
    for event in result['events']:
        candles=base['series'][0]['candles'];idx=next(i for i,c in enumerate(candles) if c['timestamp']==event['timestamp'])
        for outcome in event['outcomes']:
            if idx+1>=len(candles): assert outcome['status']=='incomplete';continue
            price=scope['_basis_price'](candles[idx+1],outcome['basis'])
            expected=scope['_calculate_trade_pl'](side,candles[idx]['close'],price)['pl_pct']
            assert abs(expected-outcome['return_pct'])<1e-9
            compared+=1
    swing=native(side,True)
    for event in swing['events'][:-1]:
        candles=base['series'][0]['candles'];idx=next(i for i,c in enumerate(candles) if c['timestamp']==event['timestamp'])
        old=scope['_realized_target_stop'](candles,idx,event['reference_price'],side)
        assert old['exit_reason']==event['swing']['status']
        assert abs(old['pl_pct']-event['swing']['return_pct'])<1e-9
        compared+=1
    assert swing['events'][-1]['swing']['status']=='incomplete'
shortened=scope['_time_exit'](base['series'][0]['candles'],24,3,110,'BUY')
assert shortened['step']==1
assert native('BUY',False,3)['events'][2]['swing']['status']=='incomplete'
print(json.dumps(dict(comparisons=compared,source_sha256=f['source_sha256'],base_sha256=f['base_sha256'],parity_scope='price basis, directional returns and completed TP/SL cases',differences=f['policy_differences']),indent=2))
