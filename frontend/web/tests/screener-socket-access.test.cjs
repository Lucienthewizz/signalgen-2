const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');

// A server policy rejection must reach monitoring as a non-retryable status,
// rather than being mistaken for a broken network connection (status zero).
for(const [code,status] of [['FEATURE_NOT_INCLUDED',403],['PLAN_LIMIT_EXCEEDED',403],['SESSION_EXPIRED',403],['GRANT_EXPIRED',403],['VERSION_MISMATCH',422],['SERVICE_UNAVAILABLE',503]]){
 test(`socket ${code} preserves its server error category`,async()=>{
  let socket;
  class Socket{static OPEN=1;static CONNECTING=0;readyState=1;constructor(){socket=this}close(){this.readyState=3}}
  class ApiError extends Error{constructor(message,status,code){super(message);this.status=status;this.code=code}}
  const result={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/analysis/screener-socket.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:result,require:()=>({ApiError,websocketURL:()=> 'ws://fixture.test'}),WebSocket:Socket,window:{setTimeout},clearTimeout,crypto:require('node:crypto')});
  const pending=result.evaluateOverSocket('/ws','synthetic-ticket','screener-private-1','screener-features-1',{candidates:[]},new AbortController().signal);
  socket.onmessage({data:JSON.stringify({type:'screener.error',code,message:'Synthetic policy result'})});
  await assert.rejects(pending,e=>e.status===status&&e.code===code);
  assert.equal(socket.readyState,3);
 });
}
