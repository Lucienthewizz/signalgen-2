// Real application, worker, Go/WASM, SHA checking and native IndexedDB;
// synthetic account/catalog/provider/private decisions. No cloud traffic.
// prettier-ignore
async(page)=>{
 const origin=new URL(page.url()).origin,user={id:"11111111-1111-4111-8111-111111111119",email:"study@example.test",full_name:"Signal study QA",role:"user",status:"active"};
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 // Simulate a legacy engine response by removing only the new optional counter.
 await page.addInitScript(()=>{
   const descriptor=Object.getOwnPropertyDescriptor(Worker.prototype,"onmessage");
   Object.defineProperty(Worker.prototype,"onmessage",{...descriptor,set(fn){
     descriptor.set.call(this,fn ? function(event){
       if(window.__legacyTargetMetrics&&event.data.result?.swing){
         delete event.data.result.swing.target_hits;
         for(const group of [...event.data.result.by_symbol,...event.data.result.by_day])delete group.target_hits;
       }
       return fn.call(this,event);
     } : fn);
   }});
 });
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.addInitScript(()=>{sessionStorage.setItem("signalgen.access-token","synthetic-study-only");sessionStorage.setItem("signalgen.app-session","synthetic-session");sessionStorage.setItem("signalgen.app-session-origin","same-origin")});
 let noSignals=false,createError=false,frozen,counter=0,hold=false,release,entered;
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
   if(createError)return respond({error:{code:"FIXTURE_ERROR",message:"Synthetic study unavailable. Try again."}},503);const b=request.postDataJSON();frozen={id:"study-qa",engine_version:"core-0.5.0",rule_schema_version:"signal-baseline-1",schema_version:"signal-study-1",policy_version:"signal-close-independent-1",market:b.market,currency:b.market==="US"?"USD":"IDR",config:b.config,rule_id:b.rule_id,definition_hash:"sha256:rule",catalog_hash:"sha256:qa-frozen-catalog",total:23,batch_size:10,batches:3,expires_at:"2027-11-01T00:00:00Z"};return respond(frozen,201);
  }
  if(p.endsWith("/prepare")&&p.includes("/studies/")){
   if(method==="DELETE")return route.fulfill({status:204});
   const index=Number(p.split("/").at(-2));
   if(hold){entered?.();await new Promise(r=>release=r)}
   const stocks=[],manifests=[],failures=[];
   for(let i=index*10;i<Math.min((index+1)*10,23);i++){
    const symbol="TEST"+String(i).padStart(2,"0");stocks.push(symbol);
    const candles=Array.from({length:i===22?20:30},(_,j)=>{
      const close=100+Math.max(0,j-19);
      return {timestamp:new Date(Date.UTC(2026,0,1+j)).toISOString(),open:close,high:i===0&&j===20?120:close+0.5,low:i===0&&j===20?95:close-0.5,close,volume:1000};
    });
    const backtest={...frozen.config,mode:"rule",rule_id:frozen.rule_id,study_id:frozen.id,definition_hash:frozen.definition_hash},data={schema_version:"ohlcv-multi-1",purpose:"backtest",market:frozen.market,currency:frozen.currency,timeframe:"1d",timezone:"UTC",backtest,series:[{symbol,timezone:"UTC",candles}]};
    const raw=JSON.stringify(data),bytes=new TextEncoder().encode(raw),hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),x=>x.toString(16).padStart(2,"0")).join("");
    const manifest={dataset_id:symbol,version:"v1",purpose:"backtest",market:frozen.market,currency:frozen.currency,timeframe:"1d",symbols:[symbol],backtest,decoded_bytes:bytes.length,checksum:"sha256:"+hash,required_operands:["PRICE"]};snapshots.set(symbol,{raw,manifest});manifests.push(manifest);
   }return respond({index,stocks,manifests,failures});
  }
  if(p==="/api/v1/backtests/studies/study-qa"&&method==="DELETE")return route.fulfill({status:204});
  if(p.startsWith("/api/v1/datasets/")&&p.endsWith("/content"))return route.fulfill({body:snapshots.get(p.split("/")[4]).raw,contentType:"application/json"});
  if(p==="/api/v1/compute-grants"){const b=request.postDataJSON();if(b.definition_hash!==frozen.definition_hash||b.rule_id!==frozen.rule_id)throw Error("Unbound study grant");return respond({id:b.dataset_id},201)}
  if(p==="/api/v1/backtests/signals"){
   const b=request.postDataJSON();if(b.policy_version!=="signal-close-independent-1")throw Error("Wrong policy");
   return respond({policy_version:b.policy_version,entries:b.candidates.filter(c=>!noSignals&&c.timestamp.slice(0,10)>="2026-01-20"&&c.timestamp.slice(0,10)<="2026-01-22").slice(0,b.compute_grant_id==="TEST00"?1:b.compute_grant_id==="TEST01"?2:3).map(c=>({symbol:c.symbol,timestamp:c.timestamp,signal_type:"BUY"}))});
  }
  return respond({error:{code:"UNMOCKED",message:p}},404);
 });


 const assert=(value,message)=>{if(!value)throw Error(message)};
 const stats=()=>page.getByLabel("Target-hit statistics",{exact:true});
 const table=()=>page.getByRole("region",{name:"Evaluation comparison"});
 const details=()=>page.getByRole("region",{name:"Individual signal outcomes"});
 const configure=async()=>{
  await page.getByLabel("Stock source",{exact:true}).waitFor({timeout:20000});
  await page.getByLabel("Screening rule",{exact:true}).selectOption("qa-rule");
  await page.getByLabel("From (daily session, SGT)",{exact:true}).fill("2026-01-01");
  await page.getByLabel("To (inclusive, SGT)",{exact:true}).fill("2026-01-31");
 };
 const run=async(mode)=>{
  await page.getByLabel("Evaluation method",{exact:true}).selectOption(mode);
  if(mode!=="exact")await page.getByLabel(/^Take profit %/).fill("5");
  if(mode==="tpsl")await page.getByLabel(/^Stop loss %/).fill("3");
  await page.getByRole("button",{name:"Start signal study",exact:true}).click();
  await page.getByText("Completed the frozen catalog. Review data-quality limits before interpreting results.",{exact:true}).waitFor({timeout:30000});
  if(!noSignals)await page.waitForFunction(()=>Array.from(document.querySelectorAll("table")).find(t=>t.caption?.textContent.includes("Signal details"))?.tBodies[0].rows.length===50);
 };
 const downloadText=async(name)=>{
  const next=page.waitForEvent("download");await page.getByRole("button",{name,exact:true}).click();
  const file=await next;let text="";for await(const chunk of await file.createReadStream())text+=chunk.toString("utf8");return {text,name:file.suggestedFilename()};
 };
 for(const width of [1440,390])for(const theme of ["dark","light"]){
  await page.setViewportSize({width,height:1000});await page.goto(origin+"/#app/backtest");await page.reload();await configure();
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await page.getByLabel("Evaluation method",{exact:true}).selectOption("target");await page.getByLabel("Evaluation method",{exact:true}).focus();await page.keyboard.press("Tab");
  assert(await page.getByLabel(/^Take profit %/).evaluate(el=>el===document.activeElement),"Evaluation keyboard path");
  await run("target");
  assert(await stats().innerText()==="Target reached rate: 1.59% · 1/63 evaluated · 1 incomplete","Full-run target denominator");
  const row=table().getByRole("row").filter({hasText:"Target within"});
  assert((await row.locator("td").allTextContents()).slice(0,3).join(",")==="64,63,1","Window coverage");
  assert((await row.innerText()).includes("100.00%"),"Positive time exits must keep 100% win rate");
  const before=await stats().innerText();
  await page.getByRole("button",{name:"Next signals",exact:true}).click();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll("table")).find(t=>t.caption?.textContent.includes("Signal details"))?.tBodies[0].rows.length===14);
  assert(await stats().innerText()===before,"Pagination changed full-run target rate");
  const csv=await downloadText("Export target-hit summary CSV"), columns=csv.text.trim().split("\r\n")[1].split(",").map(cell=>cell.slice(1,-1));
  assert(csv.name==="signal-study-target-hits.csv"&&columns.slice(2,6).join(",")==="1,63,1,64","Target CSV uses full run");
  assert(Math.abs(Number(columns[6])-100/63)<1e-9&&columns.slice(9,13).join(",")==="3,5,,signal-close-independent-1"&&columns.at(-1)==="complete","Target CSV rate or coverage");
  const events=await downloadText("Export signal details CSV");assert(events.text.trim().split("\r\n").length===641,"Existing event export lost outcomes");
  await page.getByRole("button",{name:"Previous signals",exact:true}).click();
  await page.getByLabel("Compare exact horizon",{exact:true}).selectOption("1");assert(await stats().innerText()===before,"Exact horizon changed target window");
  await table().focus();assert(await table().evaluate(el=>el===document.activeElement),"Table keyboard focus");
  if(width===390){await page.keyboard.press("ArrowRight");await page.waitForFunction(()=>document.activeElement.scrollLeft>0);await table().evaluate(el=>el.scrollLeft=0)}
  await page.screenshot({path:`output/playwright/target-hit-${width}-${theme}.png`,fullPage:true});
  await stats().screenshot({path:`output/playwright/target-hit-counter-${width}-${theme}.png`});
  await run("tpsl");
  assert(await stats().innerText()==="TP exit rate: 0.00% · 0/63 evaluated · 1 incomplete","SL-first collision counted as TP");
  const barriers=table().getByRole("row").filter({hasText:"TP / SL within"});assert((await barriers.innerText()).includes("98.41%"),"TP rate confused with win rate");
  await run("exact");assert((await stats().innerText()).includes("Unavailable · no target configured"),"No-target config implies zero rate");
  assert(await page.getByRole("button",{name:"Export target-hit summary CSV",exact:true}).isDisabled(),"No-target summary export enabled");
  assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),"Page horizontal overflow");
 }
 // Known-empty target run, legacy optional fields, synthetic error and pending state.
 noSignals=true;await run("target");assert(await stats().innerText()==="Target reached rate: — · 0/0 evaluated · 0 incomplete","Empty target denominator");
 await page.getByText("No matching signals were found in the processed stocks. Review the rule and signal search dates.",{exact:true}).waitFor();noSignals=false;
 await page.evaluate(()=>window.__legacyTargetMetrics=true);await run("target");
 assert((await stats().innerText()).includes("Unavailable · reload the updated engine and rerun this study"),"Legacy run silently became zero");
 assert(await page.getByRole("button",{name:"Export target-hit summary CSV",exact:true}).isDisabled(),"Legacy summary export enabled");
 await page.evaluate(()=>window.__legacyTargetMetrics=false);
 createError=true;await page.getByRole("button",{name:"Start signal study",exact:true}).click();await page.getByRole("alert").filter({hasText:"Synthetic study unavailable"}).waitFor();createError=false;
 hold=true;const pending=new Promise(r=>entered=r);await page.getByRole("button",{name:"Start signal study",exact:true}).click();await pending;
 assert(await page.getByRole("button",{name:"Export target-hit summary CSV",exact:true}).isDisabled(),"Pending result exported");
 await page.getByLabel("Estimated study completion",{exact:true}).waitFor();
 await page.getByRole("button",{name:"Stop study",exact:true}).click();release?.();hold=false;
 await page.getByText("Stopped. Completed results remain available; this is not a complete-market result.",{exact:true}).waitFor();
 assert(errors.length===0,errors.join("; "));
 await page.evaluate(()=>document.body.setAttribute("data-target-hit-tests","complete"));
 return {synthetic:true,realWasm:true,widths:[1440,390],themes:["dark","light"],stocks:23,batches:3,signals:64,evaluated:63,incomplete:1,targetHits:1,targetRate:100/63,winRate:100,slFirstTpExits:0,pagination:[50,14],summaryCSV:true,eventCSVRows:641,empty:true,legacyUnavailable:true,error:true,loading:true,keyboard:true};
}
