"""Baseline 4b2173c only: reproduce skipped cleanup with mocked Docker calls.
Run in bounded offline Python Docker with the original repo at /target; no Docker socket.
"""
import ast,json,subprocess,types
from pathlib import Path
source=Path('/target/backend/scripts/verify_local_api_stack.py').read_text()
module=ast.parse(source)
run=next(n for n in module.body if isinstance(n,ast.FunctionDef) and n.name=='run')
final=next(n for n in run.body if isinstance(n,ast.Try)).finalbody
assert len(final)==1 and isinstance(final[0],ast.For)
wrapper=ast.FunctionDef(name='cleanup',args=ast.arguments(posonlyargs=[],args=[],kwonlyargs=[],kw_defaults=[],defaults=[]),body=final,decorator_list=[])
code=compile(ast.fix_missing_locations(ast.Module(body=[wrapper],type_ignores=[])),'existing-cleanup-finally','exec')
calls=[]
def fake_run(args,**kwargs):
 calls.append(args[-1])
 raise subprocess.TimeoutExpired(args,kwargs['timeout'])
namespace={'names':['own-pg','own-api','own-verify'],'DOCKER':['docker','--context','orbstack'],'subprocess':types.SimpleNamespace(run=fake_run,DEVNULL=subprocess.DEVNULL)}
exec(code,namespace)
try: namespace['cleanup']()
except subprocess.TimeoutExpired: pass
else: raise AssertionError('expected existing timeout to propagate')
assert calls==['own-verify'],calls
print(json.dumps({'probe':'exact existing finally AST; Docker calls mocked','fault':'first exact-name removal raises TimeoutExpired','attempted':calls,'remaining_not_attempted':['own-api','own-pg'],'actual_docker_calls':0,'finding_reproduced':True}))
