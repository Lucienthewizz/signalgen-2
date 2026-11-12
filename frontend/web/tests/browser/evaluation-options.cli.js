// Real application, worker, Go/WASM, SHA checking and native IndexedDB;
// synthetic account/catalog/provider/private decisions. No cloud traffic.
// prettier-ignore
async(page)=>{
 const origin=new URL(page.url()).origin,user={id:"11111111-1111-4111-8111-111111111119",email:"study@example.test",full_name:"Signal study QA",role:"user",status:"active"};
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
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
   if(createError)return respond({error:{code:"FIXTURE_ERROR",message:"Synthetic study unavailable. Try again."}},503);const b=request.postDataJSON();frozen={id:"study-qa",engine_version:"core-0.5.0",rule_schema_version:"signal-baseline-1",schema_version:"signal-study-1",policy_version:"signal-close-independent-1",market:b.market,currency:b.market==="US"?"USD":"IDR",config:b.config,rule_id:b.rule_id,definition_hash:"sha256:rule",catalog_hash:"sha256:qa-frozen-catalog",total:3,batch_size:10,batches:1,expires_at:"2027-11-01T00:00:00Z"};return respond(frozen,201);
  }
  if(p.endsWith("/prepare")&&p.includes("/studies/")){
   if(method==="DELETE")return route.fulfill({status:204});
   const index=Number(p.split("/").at(-2));
   if(hold){entered?.();await new Promise(r=>release=r)}
   const stocks=[],manifests=[],failures=[];
   for(let i=index*10;i<Math.min((index+1)*10,3);i++){
    const symbol="TEST"+String(i).padStart(2,"0");stocks.push(symbol);
    const candles=Array.from({length:i===2?20:24},(_,j)=>({timestamp:new Date(Date.UTC(2026,0,1+j)).toISOString(),open:j<20?100:(j===22?92:90),high:j<20?101:(i===0&&j===20?106:99),low:j<20?99:88,close:j<20?100:90,volume:1000}));
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
   return respond({policy_version:b.policy_version,entries:b.candidates.filter(c=>!noSignals&&c.timestamp.slice(0,10)==="2026-01-20").map(c=>({symbol:c.symbol,timestamp:c.timestamp,signal_type:"BUY"}))});
  }
  return respond({error:{code:"UNMOCKED",message:p}},404);
 });

 const assert=(value,message)=>{if(!value)throw Error(message)};
 const table=()=>page.getByRole("region",{name:"Evaluation comparison"});
 const details=()=>page.locator("table").filter({has:page.locator("caption",{hasText:"Signal details"})});
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
  if(!noSignals)await page.waitForFunction(()=>Array.from(document.querySelectorAll("table")).find(t=>t.caption?.textContent.includes("Signal details"))?.tBodies[0].rows.length===3);
 };
 for(const width of [1440,390])for(const theme of ["dark","light"]){
  await page.setViewportSize({width,height:1000});await page.goto(origin+"/#app/backtest");await page.reload();await configure();
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await page.getByLabel("Evaluation method",{exact:true}).selectOption("target");await page.getByLabel("Evaluation method",{exact:true}).focus();await page.keyboard.press("Tab");
  assert(await page.getByLabel(/^Take profit %/).evaluate(el=>el===document.activeElement),"Evaluation keyboard path");
  for(const mode of ["exact","target","tpsl"]){
   await run(mode);
   assert(frozen.config.from==="2026-01-01"&&frozen.config.to==="2026-01-31"&&frozen.config.n_steps===3,"Search range differs from trading horizon");
   assert(await table().locator("tbody tr").count()===(mode==="exact"?2:3),"Comparison modes");
   const exact=table().getByRole("row").filter({hasText:"Exact T+3 Close"});
   assert((await exact.innerText()).includes("-10.00%"),"Exact negative return hidden");
   assert((await table().getByRole("row").filter({hasText:"Exact T+3 Open"}).innerText()).includes("-8.00%"),"Exact Open differs from Close: "+await table().innerText());
   assert((await exact.locator("td").allTextContents()).slice(0,3).join(",")==="3,2,1","Incomplete denominator");
   assert((await details().innerText()).replaceAll("\n", " · ").includes("Incomplete · excluded"),"Incomplete details");
   if(mode==="target"){
    assert(frozen.config.take_profit_pct===5&&frozen.config.stop_loss_pct===undefined,"Target must not apply SL");
    assert((await details().innerText()).replaceAll("\n", " · ").includes("Target hit · T+1 · 2026-01-21T00:00:00.000Z · price 105 · 5.00%"),"First target hit time");
    assert((await table().innerText()).includes("-2.50%"),"Target comparison includes negative unhit window");
   }
   if(mode==="tpsl")assert((await details().innerText()).replaceAll("\n", " · ").includes("Stop loss hit · T+1 · 2026-01-21T00:00:00.000Z · price 97 · -3.00%"),"Same candle SL-first");
   await page.getByLabel("Compare exact horizon",{exact:true}).selectOption("1");
   assert((await table().innerText()).includes("Exact T+1 Open"),"Exact horizon control");
   if(mode!=="exact")assert((await table().innerText()).includes("within T+3"),"Frozen window changed with exact horizon");
   await page.getByLabel("Compare exact horizon",{exact:true}).selectOption("3");
   const download=page.waitForEvent("download");await page.getByRole("button",{name:"Export signal details CSV",exact:true}).click();
   const file=await download;let csv="";for await(const chunk of await file.createReadStream())csv+=chunk.toString("utf8");
   assert(file.suggestedFilename()==="signal-study-events.csv"&&csv.trim().split("\r\n").length===31,"CSV preserves all outcomes");
   await table().focus();assert(await table().evaluate(el=>el===document.activeElement),"Comparison keyboard focus");
   if(width===390){await page.keyboard.press("ArrowRight");await page.waitForFunction(()=>document.activeElement.scrollLeft>0);await table().evaluate(el=>el.scrollLeft=0);}
   assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),"Page horizontal overflow");
   await page.screenshot({path:`output/playwright/evaluation-options-${width}-${theme}-${mode}.png`,fullPage:true});
   if(mode==="target")await table().screenshot({path:`output/playwright/evaluation-options-comparison-${width}-${theme}.png`});
  }
 }
 // Empty, backend error, and loading/cancellation use synthetic API states.
 noSignals=true;await run("exact");await page.getByText("No matching signals were found in the processed stocks. Review the rule and signal search dates.",{exact:true}).waitFor();
 noSignals=false;createError=true;await page.getByRole("button",{name:"Start signal study",exact:true}).click();await page.getByRole("alert").filter({hasText:"Synthetic study unavailable"}).waitFor();createError=false;
 hold=true;const enteredPrepare=new Promise(r=>entered=r);await page.getByRole("button",{name:"Start signal study",exact:true}).click();await enteredPrepare;
 assert(await page.getByLabel("Evaluation method",{exact:true}).isDisabled(),"Loading allows config edits");
 await page.getByLabel("Estimated study completion",{exact:true}).waitFor();
 await page.getByRole("button",{name:"Stop study",exact:true}).click();release?.();hold=false;
 await page.getByText("Stopped. Completed results remain available; this is not a complete-market result.",{exact:true}).waitFor();
 assert(errors.length===0,errors.join("; "));
 await page.evaluate(()=>document.body.setAttribute("data-evaluation-options-tests","complete"));
 return {synthetic:true,realWasm:true,widths:[1440,390],themes:["dark","light"],modes:["exact","target","tpsl"],signals:3,exactEvaluated:2,exactIncomplete:1,exactOpenMean:-8,exactCloseMean:-10,targetMean:-2.5,sameCandlePolicy:"SL-first",csvRows:31,empty:true,error:true,loading:true,keyboard:true};
}
