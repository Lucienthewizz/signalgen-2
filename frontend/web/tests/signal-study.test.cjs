const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {webcrypto:crypto,createHash}=require('node:crypto');
function load(file,dependencies={},clock={}){
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>dependencies[n]??{},AbortController,DOMException,TextEncoder,crypto,performance,setTimeout,clearTimeout,...clock});return exports;
}
const types=load('analysis/signal-study-types.ts');
function harness({failure,quota,version=false}={}){
 const calls={prepare:[],preparedStocks:[],features:[],save:[],release:[],workers:0,disposed:0};let revision=1;
 const config={from:'2026-01-20',to:'2026-01-23',n_steps:3};
 const context={id:'study',schema_version:types.STUDY_SCHEMA,policy_version:types.STUDY_POLICY,engine_version:'core-0.5.0',rule_schema_version:'signal-baseline-1',market:'US',currency:'USD',definition_hash:'hash',batch_size:10,batches:3,total:23,config};
 const contents=new Map();let broken=failure;
 class ApiError extends Error {constructor(message,status){super(message);this.status=status}}
 const session={getIdentityRevision:()=>revision,getToken:()=> 'fixture'};
 const api={ensureAppSession:async()=>{},account:async()=>({user:{id:'owner'},features:['backtest']}),createStudy:async()=>context,
  prepareStudyBatch:async(_,batch,_signal,subset)=>{
   calls.prepare.push(batch);const manifests=[],failures=[],stocks=[];
   for(let i=batch*10;i<Math.min(23,(batch+1)*10);i++){
    const symbol='STOCK'+i;if(subset&&!subset.includes(symbol))continue;stocks.push(symbol);calls.preparedStocks.push(symbol);if(broken===i){failures.push({symbol,code:'PROVIDER_UNAVAILABLE',retryable:true});continue}
    const candles=Array.from({length:25},(_,i)=>({timestamp:new Date(Date.UTC(2026,0,1+i)).toISOString(),open:100,high:110,low:90,close:100,volume:100}));
    const backtest={study_id:context.id,definition_hash:context.definition_hash,...config};
    const data={purpose:'backtest',timeframe:'1d',market:'US',currency:'USD',backtest,series:[{symbol,timezone:'UTC',candles}]},raw=JSON.stringify(data);
    contents.set(symbol,raw);manifests.push({purpose:'backtest',timeframe:'1d',dataset_id:symbol,symbols:[symbol],market:'US',currency:'USD',backtest,decoded_bytes:Buffer.byteLength(raw),checksum:'sha256:'+createHash('sha256').update(raw).digest('hex')});
   }return {index:batch,stocks,manifests,failures};
  },getDatasetContentText:async id=>contents.get(id),createStudyGrant:async manifest=>({id:manifest.symbols[0]}),backtestSignals:async(id,candidates)=>({policy_version:types.STUDY_POLICY,entries:[{symbol:id,timestamp:candidates[0].timestamp,signal_type:'BUY'}]}),releaseStudyBatch:async(_,batch)=>calls.release.push(batch)};
 class Engine {
  constructor(){calls.workers++}dispose(){calls.disposed++}
  async initialize(){return {schema_version:types.STUDY_SCHEMA,policy_version:types.STUDY_POLICY}}
  async features(series){calls.features.push(series[0].symbol);return [{engine_version:version?'old':context.engine_version,feature_schema_version:'screener-features-1',candidates:series[0].candles.slice(19).map(c=>({symbol:series[0].symbol,timestamp:c.timestamp,features:{}}))}]}
  async study(request){const metrics={signals:1,evaluated:1,missing:0,wins:1,losses:0,flats:0,sum_return_pct:5,mean_return_pct:5,win_rate:100};return {schema_version:types.STUDY_SCHEMA,policy_version:types.STUDY_POLICY,events:[],horizons:[{step:1,basis:'close',...metrics}],swing:metrics,by_symbol:[{key:request.series[0].symbol,...metrics}],by_day:[{key:'2026-01-20',...metrics}]}}
 }
 const {runSignalStudy}=load('analysis/signal-study.ts',{'@/api/client':{api,session,ApiError},'./signal-study-engine':{SignalStudyEngine:Engine},'./signal-study-types':types,'./signal-study-storage':{storeStudySymbol:async(_owner,_id,symbol)=>{if(quota===symbol)throw new DOMException('Temporary storage quota reached','QuotaExceededError');calls.save.push(symbol)}}});
 return {runSignalStudy,calls,config,fix:()=>broken=undefined,changeIdentity:()=>revision++};
}
test('23 frozen stocks use three sequential batches and one reused worker; failed ticker retry never duplicates counts',async()=>{
 const h=harness({failure:4}),abort=new AbortController();let latest;
 const first=await h.runSignalStudy({},'owner',abort.signal,p=>latest=p);
 assert.equal(first.completed,22);assert.equal(first.failures.length,1);assert.equal(first.remaining,0);assert.equal(first.swing.signals,22);assert.deepEqual(h.calls.prepare,[0,1,2]);assert.equal(h.calls.workers,1);assert.equal(h.calls.disposed,1);
 h.fix();const retry=await h.runSignalStudy({},'owner',abort.signal,p=>latest=p,first);
 assert.equal(retry.completed,23);assert.equal(retry.failures.length,0);assert.equal(retry.swing.signals,23);assert.equal(retry.swing.mean_return_pct,5);assert.equal(new Set(h.calls.save).size,23);assert.equal(h.calls.save.length,23);assert.deepEqual(h.calls.prepare,[0,1,2,0]);assert.equal(latest.remaining,0);
 assert.equal(h.calls.preparedStocks.length,24);assert.equal(h.calls.preparedStocks.at(-1),'STOCK4');
});
test('quota failure preserves previous rows and pending batches, releases handles and stops',async()=>{
 const h=harness({quota:'STOCK2'});let latest;
 await assert.rejects(h.runSignalStudy({},'owner',new AbortController().signal,p=>latest=p),/quota/);
 assert.equal(latest.completed,2);assert.equal(h.calls.save.length,2);assert.equal(latest.pendingBatches.length,3);assert.equal(latest.failedBatches[0],0);assert.deepEqual(h.calls.release,[0]);assert.equal(h.calls.disposed,1);
});
test('account switch or cancellation stops before any additional stock work',async()=>{
 for(const action of ['abort','identity']){
  const h=harness(),controller=new AbortController();
  await assert.rejects(h.runSignalStudy({},'owner',controller.signal,p=>{if(p.completed===1){if(action==='abort')controller.abort();else h.changeIdentity()}}));
  assert.equal(h.calls.save.length,1);assert.equal(h.calls.disposed,1);
 }
});
test('mismatched WASM engine rejects instead of silently scoring',async()=>{
 const h=harness({version:true});await assert.rejects(h.runSignalStudy({},'owner',new AbortController().signal,()=>{}),/incompatible/);assert.equal(h.calls.save.length,0);assert.equal(h.calls.disposed,1);
});
test('weighted summary counts flats and missing without averaging batch win rates',()=>{
 const a={...types.emptyStudyMetrics(),signals:2,evaluated:2,wins:1,flats:1,sum_return_pct:4};
 const b={...types.emptyStudyMetrics(),signals:10,evaluated:5,missing:5,wins:5,sum_return_pct:20};
 const out=types.mergeStudyMetrics(a,b);assert.equal(out.signals,12);assert.equal(out.evaluated,7);assert.equal(out.missing,5);assert.equal(out.win_rate,6/7*100);assert.equal(out.mean_return_pct,24/7);
});
test('rate limits honor Retry-After with at most two retries; permission and Stop never retry',async()=>{
 class ApiError extends Error{constructor(status,delay){super('admission');this.status=status;this.retryAfterMs=delay}}
 const delays=[];
 const {studyRateLimited}=load('analysis/signal-study.ts',{'@/api/client':{ApiError}},{setTimeout:(fn,ms)=>{delays.push(ms);queueMicrotask(fn);return 0},clearTimeout:()=>{}});
 let calls=0;assert.equal(await studyRateLimited(async()=>{if(++calls<3)throw new ApiError(429,7000);return 'ok'},new AbortController().signal,()=>{}),'ok');assert.deepEqual(delays,[7000,7000]);
 calls=0;await assert.rejects(studyRateLimited(async()=>{calls++;throw new ApiError(429,999999)},new AbortController().signal,()=>{}));assert.equal(calls,3);assert.deepEqual(delays.slice(-2),[120000,120000]);
 for(const status of [401,403,409,503]){calls=0;await assert.rejects(studyRateLimited(async()=>{calls++;throw new ApiError(status)},new AbortController().signal,()=>{}));assert.equal(calls,1)}
 const stop=new AbortController();calls=0;await assert.rejects(studyRateLimited(async()=>{calls++;throw new ApiError(429)},stop.signal,()=>stop.abort()),e=>e.name==='AbortError');assert.equal(calls,1);
});
