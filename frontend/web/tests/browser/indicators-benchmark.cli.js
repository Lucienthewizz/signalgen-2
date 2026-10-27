// Run through scripts/benchmark-indicators.mjs, which supplies the shared cases.
async (page, cases) => {
  const origin = new URL(page.url()).origin;
  // Idle same-origin document: no landing animations, login or account APIs.
  await page.goto(`${origin}/wasm/signalgen_core.manifest.json`);
  await page.setContent('<title>SignalGen indicator benchmark</title><main>Measuring synthetic indicator workloads.</main>');
  const result = await page.evaluate(async (cases) => {
    const screener = await import('/src/analysis/screener-engine.ts');
    const backtest = await import('/src/analysis/backtest-engine.ts');
    const summarize = samples => {
      const sorted = [...samples].sort((a,b)=>a-b);
      const p = fraction => sorted[Math.max(0,Math.ceil(sorted.length*fraction)-1)];
      return {samples:samples.length,median_ms:p(.5),p95_ms:p(.95),min_ms:sorted[0],max_ms:sorted.at(-1),raw_ms:samples};
    };
    const makeSeries = (count, n) => Array.from({length:count}, (_,symbol) => ({
      symbol:`TEST${symbol}`,timezone:'UTC',candles:Array.from({length:n},(_,i)=>{
        const base=10000+(i*37)%601+(i%7)*10;
        const open=base+((i%5)-2)*5,close=base+((i%11)-5)*3;
        return {timestamp:new Date(Date.UTC(2016,0,1+i)).toISOString().replace('.000Z','Z'),open,close,high:Math.max(open,close)+10+i%7,low:Math.min(open,close)-10-i%5,volume:1000+(i*113)%10000};
      }),
    }));
    const measure = async (extract, series, operands) => {
      const started=performance.now();
      const groups=await extract(series,new AbortController().signal,operands);
      const elapsed=performance.now()-started;
      if (groups.length!==series.length || groups.some((g,i)=>g.candidates.length!==series[i].candles.length-19 || g.engine_version!=='core-0.5.0')) throw Error('Invalid benchmark output');
      return elapsed;
    };
    const first=cases[0];
    const firstSeries=makeSeries(first.symbols,first.candles);
    screener.disposeScreenerEngine();
    const firstCall=await measure(screener.extractDatasetFeatures,firstSeries,[]);
    const rows=[];
    for (const c of cases) {
      const series=makeSeries(c.symbols,c.candles);
      const extract=c.purpose==='backtest'?backtest.extractBacktestFeatures:screener.extractDatasetFeatures;
      // Screener retains a worker; backtest creates/terminates one per job.
      for(let i=0;i<3;i++) await measure(extract,series,c.operands);
      const samples=[];
      for(let i=0;i<15;i++) samples.push(await measure(extract,series,c.operands));
      rows.push({...c,worker_policy:c.purpose==='backtest'?'fresh worker per sample':'reused worker',...summarize(samples)});
    }
    screener.disposeScreenerEngine();
    // Measure the existing loader alone in fresh workers; HTTP/compiler caches
    // are intentionally left intact, matching repeated runs in this browser.
    const source=`import {loadEngine} from '${location.origin}/src/workers/wasm-runtime.ts'; const start=performance.now(); loadEngine().then(()=>postMessage({ms:performance.now()-start}),error=>postMessage({error:error.message}));`;
    const blobURL=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    const startup=[];
    try {
      for(let i=0;i<7;i++) {
        startup.push(await new Promise((resolve,reject)=>{
          const worker=new Worker(blobURL,{type:'module'});
          const timer=setTimeout(()=>{worker.terminate();reject(Error('Loader timeout'))},30000);
          worker.onmessage=({data})=>{clearTimeout(timer);worker.terminate();data.error?reject(Error(data.error)):resolve(data.ms)};
          worker.onerror=()=>{clearTimeout(timer);worker.terminate();reject(Error('Loader worker failed'))};
        }));
      }
    } finally {URL.revokeObjectURL(blobURL)}
    return {schema:'indicator-benchmark-1',user_agent:navigator.userAgent,hardware_concurrency:navigator.hardwareConcurrency,first_screener_call_ms:firstCall,loader:summarize(startup),cases:rows};
  }, cases);
  await page.evaluate(result=>{document.body.dataset.indicatorBenchmark=JSON.stringify(result);document.querySelector('main').textContent='Benchmark complete.'},result);
  return result;
}
