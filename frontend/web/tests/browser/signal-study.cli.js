// Real application, worker, Go/WASM, SHA checking and native IndexedDB;
// synthetic account/catalog/provider/private decisions. No cloud traffic.
// prettier-ignore
async(page)=>{
 const origin=new URL(page.url()).origin,user={id:"11111111-1111-4111-8111-111111111119",email:"study@example.test",full_name:"Signal study QA",role:"user",status:"active"};
 const errors=[],reports=[];page.on("pageerror",e=>errors.push(e.message));
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.addInitScript(()=>{sessionStorage.setItem("signalgen.access-token","synthetic-study-only");sessionStorage.setItem("signalgen.app-session","synthetic-session");sessionStorage.setItem("signalgen.app-session-origin","same-origin")});
 let frozen,partial=true,prepares=[],scored=[],counter=0,hold=false,release,entered,etaProbe=false;
 const snapshots=new Map();
 await page.route("**/*",async route=>{
  const request=route.request(),url=new URL(request.url()),p=url.pathname,method=request.method();
  if(url.origin!==origin)return route.abort();
  if(!p.startsWith("/api/")&&p!=="/api"&&p!=="/ready")return route.continue();
  const respond=(json,status=200)=>route.fulfill({json,status,headers:{"X-Request-ID":"qa-study-"+(++counter)}});
  if(p==="/api"||p==="/ready")return respond({status:"ready",name:"Synthetic study API"});
  if(p==="/api/auth/me")return respond(user);
  if(p==="/api/v1/account/me")return respond({user,features:["screener","backtest"],session:{id:"qa",expires_at:"2027-11-01T00:00:00Z"},device:{installation_id:"qa",current:true}});
  if(p==="/api/v1/rules")return respond({items:[{id:"qa-rule",name:"QA every signal",version:1,owner_type:"user",definition_hash:"sha256:rule",definition:{name:"QA every signal",logic:"AND",signal_type:"BUY",cooldown_sec:0,conditions:[{left:"PRICE",op:">",right:0}]}}]});
  if(p==="/api/v1/stock-universes")return respond({items:[{id:"qa-universe",name:"QA owned stocks",symbols:["TEST"],version:1}]});
  if(p==="/api/v1/subscription")return respond({subscription:null});
  if(p==="/api/v1/workspace")return respond({items:[]});
  if(p.startsWith("/api/v1/workspace/")){const b=request.postDataJSON();return respond({...b,version:b.version+1})}
  if(p==="/api/v1/backtests/studies"){
   const b=request.postDataJSON();frozen={id:"study-qa",engine_version:"core-0.5.0",rule_schema_version:"signal-baseline-1",schema_version:"signal-study-1",policy_version:"signal-close-independent-1",market:b.market,currency:b.market==="US"?"USD":"IDR",config:b.config,rule_id:b.rule_id,definition_hash:"sha256:rule",catalog_hash:"sha256:qa-frozen-catalog",total:23,batch_size:10,batches:3,expires_at:"2027-11-01T00:00:00Z"};return respond(frozen,201);
  }
  if(p.endsWith("/prepare")&&p.includes("/studies/")){
   if(method==="DELETE")return route.fulfill({status:204});
   const index=Number(p.split("/").at(-2));prepares.push(index);
   if(etaProbe&&index===0)await new Promise(r=>setTimeout(r,3000));
   if(hold&&(!etaProbe||index>0)){entered?.();await new Promise(r=>release=r)}
   const stocks=[],manifests=[],failures=[];
   for(let i=index*10;i<Math.min((index+1)*10,23);i++){
    const symbol="TEST"+String(i).padStart(2,"0");if(request.postDataJSON().retry_symbols&&!request.postDataJSON().retry_symbols.includes(symbol))continue;stocks.push(symbol);
    if(partial&&i===3){failures.push({symbol,code:"PROVIDER_UNAVAILABLE",retryable:true});continue}
    const candles=Array.from({length:50},(_,i)=>({timestamp:new Date(Date.UTC(2026,0,1+i)).toISOString(),open:100+i,high:110+i,low:90+i,close:101+i,volume:1000}));
    const backtest={...frozen.config,mode:"rule",rule_id:frozen.rule_id,study_id:frozen.id,definition_hash:frozen.definition_hash},data={schema_version:"ohlcv-multi-1",purpose:"backtest",market:frozen.market,currency:frozen.currency,timeframe:"1d",timezone:"UTC",backtest,series:[{symbol,timezone:"UTC",candles}]};
    const raw=JSON.stringify(data),bytes=new TextEncoder().encode(raw),hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),x=>x.toString(16).padStart(2,"0")).join("");
    const manifest={dataset_id:symbol,version:"v1",purpose:"backtest",market:frozen.market,currency:frozen.currency,timeframe:"1d",symbols:[symbol],backtest,decoded_bytes:bytes.length,checksum:"sha256:"+hash,required_operands:["PRICE"]};snapshots.set(symbol,{raw,manifest});manifests.push(manifest);
   }return respond({index,stocks,manifests,failures});
  }
  if(p==="/api/v1/backtests/studies/study-qa"&&method==="DELETE")return route.fulfill({status:204});
  if(p.startsWith("/api/v1/datasets/")&&p.endsWith("/content"))return route.fulfill({body:snapshots.get(p.split("/")[4]).raw,contentType:"application/json"});
  if(p==="/api/v1/compute-grants"){const b=request.postDataJSON();if(b.definition_hash!==frozen.definition_hash||b.rule_id!==frozen.rule_id)throw Error("Unbound study grant");return respond({id:b.dataset_id},201)}
  if(p==="/api/v1/backtests/signals"){
   const b=request.postDataJSON();if(b.policy_version!=="signal-close-independent-1")throw Error("Wrong policy");scored.push(b.compute_grant_id);
   return respond({policy_version:b.policy_version,entries:b.candidates.filter(c=>c.timestamp.slice(0,10)>=frozen.config.from&&c.timestamp.slice(0,10)<=frozen.config.to).map(c=>({symbol:c.symbol,timestamp:c.timestamp,signal_type:"BUY"}))});
  }
  return respond({error:{code:"UNMOCKED",message:p}},404);
 });
 // Empty configuration layout, keyboard order and conditional universe selection.
 for(const width of [1440,1218,390]){
  await page.setViewportSize({width,height:1000});await page.goto(origin+"/#app/backtest");await page.reload();
  const source=page.getByLabel("Stock source",{exact:true});await source.waitFor({timeout:20000});
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))});
  for(const name of ["Source & rule","Test period","Take profit & stop loss"])if(await page.getByRole("group",{name,exact:true}).count()!==1)throw Error("Missing settings group: "+name);
  const tp=await page.getByLabel("Take profit % (optional)",{exact:true}).boundingBox(),sl=await page.getByLabel("Stop loss % (optional)",{exact:true}).boundingBox();
  if(!tp||!sl||(width>480?(Math.abs(tp.y-sl.y)>1||Math.abs(tp.width-sl.width)>1):sl.y<=tp.y))throw Error("Target fields not aligned at "+width);
  const dateControl=(id)=>page.locator(".signalgen-date-control").filter({has:page.locator(id)});
  const from=await dateControl("#study-from").boundingBox(),to=await dateControl("#study-to").boundingBox();
  if(!from||!to||(width>480?Math.abs(from.y-to.y)>1:to.y<=from.y))throw Error("Period fields not aligned at "+width);
  if(width>480){
   const left=await source.boundingBox(),right=await page.getByLabel("Screening rule",{exact:true}).boundingBox();
   for(const [anchor,fields] of [[left,[from,tp]],[right,[to,sl]]]){
    if(!anchor||fields.some(field=>Math.abs(field.x-anchor.x)>1||Math.abs(field.width-anchor.width)>1))throw Error("Settings columns have different widths or edges at "+width);
   }
  }
  const targetColors=await page.locator('[data-study-target] [data-slot="field-label"]').evaluateAll(items=>items.map(item=>getComputedStyle(item).color.match(/\d+/g).map(Number)));
  if(targetColors.length!==2||targetColors[0][1]<=targetColors[0][0]||targetColors[1][0]<=targetColors[1][1])throw Error("Take profit/stop loss semantic colors missing");
  const arrow=await source.evaluate(el=>{const s=getComputedStyle(el);return{appearance:s.appearance,padding:parseFloat(s.paddingRight),image:s.backgroundImage}});
  if(arrow.appearance!=="none"||arrow.padding<40||arrow.image==="none")throw Error("Dropdown arrow spacing incorrect");
  await source.focus();await page.keyboard.press("Tab");if(!await page.getByLabel("Screening rule",{exact:true}).evaluate(el=>el===document.activeElement))throw Error("Source/rule keyboard order incorrect");
  await source.selectOption("universe");await page.getByLabel("Stock universe",{exact:true}).selectOption("qa-universe");
  await source.selectOption("IDX");if(await page.getByLabel("Stock universe",{exact:true}).count())throw Error("Universe field should be conditional");
  await source.selectOption("universe");if(await page.getByLabel("Stock universe",{exact:true}).inputValue()!=="qa-universe")throw Error("Universe selection lost");await source.selectOption("IDX");
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error("Configuration overflow "+width);
  await page.screenshot({path:`output/playwright/signal-study-layout-${width}.png`,fullPage:true});
 }
 for(const width of [1440,390]){
  for(const theme of ["dark","light"]){
   partial=true;prepares=[];scored=[];
   await page.setViewportSize({width,height:1000});await page.goto(origin+"/#app/backtest");await page.reload();
   await page.getByLabel("Stock source",{exact:true}).waitFor({timeout:20000});
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   const market=width===1440&&theme==="dark"?"IDX":"US";
   await page.getByLabel("Stock source",{exact:true}).selectOption(market);
   await page.getByLabel("Screening rule",{exact:true}).selectOption("qa-rule");
   await page.getByLabel("From (daily session, SGT)",{exact:true}).fill("2026-01-20");await page.getByLabel("To (inclusive, SGT)",{exact:true}).fill("2026-01-23");
   await page.getByRole("button",{name:"Start signal study",exact:true}).click();
   await page.getByText("Partial result. Failed or remaining stocks are not counted as successfully evaluated.",{exact:true}).waitFor({timeout:30000});
   if(frozen.market!==market)throw Error("Entire-catalog market selection incorrect");
   if(JSON.stringify(prepares)!=="[0,1,2]"||new Set(scored).size!==22)throw Error("Full market batch coverage incorrect");
   partial=false;await page.getByRole("button",{name:"Retry failed stocks",exact:true}).click();
   await page.getByText("Completed the frozen catalog. Review data-quality limits before interpreting results.",{exact:true}).waitFor({timeout:30000});
   if(scored.length!==23||new Set(scored).size!==23||JSON.stringify(prepares)!=="[0,1,2,0]")throw Error("Retry duplicated stocks");
   const details=page.locator("table").filter({has:page.locator("caption",{hasText:"Signal details"})});
   if(await details.locator("tbody tr").count()!==50)throw Error("Signal page is not bounded at 50");
   await page.getByRole("button",{name:"Next signals",exact:true}).click();
   await page.waitForFunction(()=>Array.from(document.querySelectorAll("table")).find(t=>t.caption?.textContent.includes("Signal details"))?.tBodies[0].rows.length===42);
   const download=page.waitForEvent("download");await page.getByRole("button",{name:"Export signal details CSV",exact:true}).click();const csvFile=await download;if(csvFile.suggestedFilename()!=="signal-study-events.csv")throw Error("CSV download failed");let csv="";for await(const chunk of await csvFile.createReadStream())csv+=chunk.toString("utf8");if(csv.trim().split("\r\n").length!==921)throw Error("CSV omitted individual signal horizons");
   await page.getByText("Measured stages for this run (milliseconds)",{exact:true}).click();const performanceFile=page.waitForEvent("download");await page.getByRole("button",{name:"Export measured stages JSON",exact:true}).click();let perf="";for await(const chunk of await(await performanceFile).createReadStream())perf+=chunk.toString("utf8");const measured=JSON.parse(perf);if(!measured.stages.startup_ms||!measured.stages.features_ms||!measured.stages.react_render_ms||!measured.traffic.decoded_candle_bytes)throw Error("Performance stages incomplete");reports.push({width,forcedTheme:theme,...measured});
   const quota=await page.evaluate(async owner=>{
    const s=await import("/src/analysis/signal-study-storage.ts"),before=await s.studyEventPage(owner,"study-qa"),encode=TextEncoder.prototype.encode;
    try{TextEncoder.prototype.encode=()=>({length:s.STUDY_STORAGE_LIMIT+1});await s.storeStudySymbol(owner,"study-qa","QUOTA",{events:[]},new AbortController().signal);return false}catch(e){if(!String(e).includes("128 MiB"))throw e}finally{TextEncoder.prototype.encode=encode}
    const after=await s.studyEventPage(owner,"study-qa");return before.total===92&&after.total===92;
   },user.id);if(!quota)throw Error("Quota destroyed completed rows");
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error(`Page overflow ${width}/${theme}`);
   await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`output/playwright/signal-study-${width}-${theme}.png`,fullPage:true});
  }
 }
 // Stop during provider preparation; a late response must never publish rows.
 hold=true;partial=false;await page.reload();await page.getByLabel("Stock source",{exact:true}).waitFor();
 const started=new Promise(r=>entered=r);await page.getByRole("button",{name:"Start signal study",exact:true}).click();await started;
 await page.getByLabel("Estimated study completion",{exact:true}).waitFor();
 if(!await page.getByLabel("Estimated study completion",{exact:true}).innerText().then(t=>t.includes("Estimating completion")))throw Error("Study ETA should wait for measured processing speed");
 await page.getByLabel("Estimated study completion",{exact:true}).screenshot({path:"output/playwright/study-estimate-processing.png"});
 const count=scored.length;await page.getByRole("button",{name:"Stop study",exact:true}).click();release?.();hold=false;
 await page.getByText("Stopped. Completed results remain available; this is not a complete-market result.",{exact:true}).waitFor();await page.waitForTimeout(300);if(scored.length!==count)throw Error("Late canceled response was scored");
 if(await page.getByLabel("Estimated study completion",{exact:true}).count())throw Error("Stopped study retained a running ETA");
 // Measured throughput produces an SGT completion time after the first batch.
 etaProbe=true;hold=true;
 const measured=new Promise(r=>entered=r);await page.getByRole("button",{name:"Start signal study",exact:true}).click();await measured;
 await page.waitForFunction(()=>document.querySelector('.study-estimate')?.textContent.includes('Estimated finish')&&document.querySelector('.study-estimate')?.textContent.includes('SGT'));
 await page.getByLabel("Estimated study completion",{exact:true}).screenshot({path:"output/playwright/study-estimate-measured.png"});
 await page.getByRole("button",{name:"Stop study",exact:true}).click();release?.();hold=false;etaProbe=false;
 await page.getByText("Stopped. Completed results remain available; this is not a complete-market result.",{exact:true}).waitFor();
 await page.goto(origin+"/#app/overview");
 const left=await page.evaluate(async owner=>(await(await import("/src/analysis/signal-study-storage.ts")).studyEventPage(owner,"study-qa")).total,user.id);if(left!==0)throw Error("Navigation retained temporary study details");
 if(errors.length)throw Error(errors.join("; "));
 await page.evaluate(()=>document.body.setAttribute("data-signalgen-study-tests","complete"));
 return {synthetic:true,stocks:23,batches:3,signalEvents:92,realWasm:true,indexedDB:true,quotaRollback:true,widths:[1440,390],forcedThemes:["dark","light"],reports};
}
