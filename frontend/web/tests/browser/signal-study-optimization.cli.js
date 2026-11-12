// Real Go/WASM engine benchmark, with frozen synthetic inputs and complete-result hashes.
// Playwright CLI expects an expression without a final semicolon.
// prettier-ignore
async (page) => {
  const initial = new URL(page.url()), origin = initial.origin;
  const selected = initial.searchParams.get("case");
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin + "/wasm/signalgen_core.manifest.json");
  const result = await page.evaluate(async (selected) => {
    const fixtures = await (await fetch("/study-perf-fixtures.json")).json();
    const source = `import {loadEngine} from '${location.origin}/src/workers/wasm-runtime.ts';
      const engine = await loadEngine();
      self.postMessage({ready:true});
      self.onmessage = async ({data}) => {
        try {
          const start=performance.now();
          const raw=engine.signalgenRunSignalStudy(data.request);
          const ms=performance.now()-start;
          const decoded=JSON.parse(raw);
          if(!decoded.ok){self.postMessage({error:decoded.error.message,ms});return;}
          const prefix='{"ok":true,"result":';
          if(!raw.startsWith(prefix)||!raw.endsWith('}'))throw Error('Unexpected response envelope');
          const canonical=raw.slice(prefix.length,-1);
          const bytes=new TextEncoder().encode(canonical);
          const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
          self.postMessage({ms,hash,bytes:bytes.length,events:decoded.result.events.length});
        }catch(error){self.postMessage({unexpected:String(error)})}
      };`;
    const blob=URL.createObjectURL(new Blob([source],{type:"text/javascript"}));
    const worker=new Worker(blob,{type:"module"});
    const call=job=>new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error("WASM benchmark timeout")),60000);
      worker.onmessage=({data})=>{clearTimeout(timer);data.unexpected?reject(Error(data.unexpected)):resolve(data)};
      worker.onerror=event=>{clearTimeout(timer);reject(Error(event.message))};
      if(job)worker.postMessage(job);
    });
    try {
      await call();
      const rows=[];
      const cases=selected===null?fixtures.cases:fixtures.cases.filter(c=>c.id===selected);
      if(!cases.length)throw Error("Unknown benchmark case");
      for(const c of cases){
        const expected=fixtures.golden.find(g=>g.id===c.id);
        const request=JSON.stringify(c.request);
        const check=sample=>{
          if(expected.error ? sample.error!==expected.error : sample.error||sample.hash!==expected.output_sha256)throw Error("Full canonical output/error differs: "+c.id+" "+JSON.stringify(sample));
        };
        const first=await call({request});check(first);
        const samples=[];
        if(!expected.error && fixtures.cases.indexOf(c)<4){
          for(let i=0;i<2;i++)check(await call({request}));
          for(let i=0;i<9;i++){const sample=await call({request});check(sample);samples.push(sample.ms)}
        }
        const sorted=[...samples].sort((a,b)=>a-b);
        rows.push({id:c.id,first_ms:first.ms,warmups:samples.length?2:0,samples:samples.length,raw_ms:samples,median_ms:sorted.length?sorted[Math.ceil(sorted.length*.5)-1]:null,p95_ms:sorted.length?sorted[Math.ceil(sorted.length*.95)-1]:null,output_sha256:first.hash??null,error:first.error??null,result_bytes:first.bytes??null,events:first.events??null});
      }
      return {schema:"signal-study-wasm-optimization-1",user_agent:navigator.userAgent,hardware_concurrency:navigator.hardwareConcurrency,worker_policy:"one warmed worker, same context; engine call only; input generation/outer messaging/hash excluded",measurement:"Go/WASM decode, engine and Go response encoding; excludes fixture/network/UI",browser_memory:null,cases:rows};
    }finally{worker.terminate();URL.revokeObjectURL(blob)}
  }, selected);
  await page.evaluate(result=>{document.body.dataset.studyOptimization=JSON.stringify(result)},result);
  return result;
}
