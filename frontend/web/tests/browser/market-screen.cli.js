// Real application, worker, Go/WASM, SHA checking and native IndexedDB;
// synthetic account/catalog/provider/private decisions. No cloud traffic.
// prettier-ignore
async(page)=>{
 const origin=new URL(page.url()).origin,user={id:"11111111-1111-4111-8111-111111111119",email:"study@example.test",full_name:"Signal study QA",role:"user",status:"active"};
 const errors=[],reports=[];page.on("pageerror",e=>errors.push(e.message));
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.addInitScript(()=>{sessionStorage.setItem("signalgen.access-token","synthetic-study-only");sessionStorage.setItem("signalgen.app-session","synthetic-session");sessionStorage.setItem("signalgen.app-session-origin","same-origin")});
 let noSignals=false,denied=false;let scanCounter=0;let frozen,partial=true,prepares=[],scored=[],counter=0,hold=false,release,entered,etaProbe=false;
 const snapshots=new Map();
 await page.route("**/*",async route=>{
  const request=route.request(),url=new URL(request.url()),p=url.pathname,method=request.method();
  if(url.origin!==origin)return route.abort();
  if(!p.startsWith("/api/")&&p!=="/api"&&p!=="/ready")return route.continue();
  const respond=(json,status=200)=>route.fulfill({json,status,headers:{"X-Request-ID":"qa-study-"+(++counter)}});
  if(p==="/api"||p==="/ready")return respond({status:"ready",name:"Synthetic study API"});
  if(p==="/api/auth/me")return respond(user);
  if(p==="/api/v1/account/me")return respond({user,features:["screener"],session:{id:"qa",expires_at:"2027-11-01T00:00:00Z"},device:{installation_id:"qa",current:true}});
  if(p==="/api/v1/rules")return respond({items:[{id:"qa-rule",name:"QA every signal",version:1,owner_type:"user",definition_hash:"sha256:rule",definition:{name:"QA every signal",logic:"AND",signal_type:"BUY",cooldown_sec:0,conditions:[{left:"PRICE",op:">",right:0}]}}]});
  if(p==="/api/v1/stock-universes")return respond({items:[{id:"qa-universe",name:"QA owned stocks",symbols:["TEST"],version:1}]});
  if(p==="/api/v1/subscription")return respond({subscription:null});
  if(p==="/api/v1/workspace")return respond({items:[]});
  if(p.startsWith("/api/v1/workspace/")){const b=request.postDataJSON();return respond({...b,version:b.version+1})}
  if(p==="/api/v1/screener/scans"){
   if(denied)return respond({error:{code:"ENTITLEMENT_REQUIRED",message:"Screener access expired."}},403);const b=request.postDataJSON();frozen={purpose:"screen",source:b.source,universe_id:b.universe_id,id:"scan-qa-"+(++scanCounter),engine_version:"core-0.5.0",rule_schema_version:"signal-baseline-1",schema_version:"signal-study-1",policy_version:"signal-close-independent-1",market:b.market,currency:b.market==="US"?"USD":"IDR",config:b.config,rule_id:b.rule_id,definition_hash:"sha256:rule",catalog_hash:"sha256:qa-frozen-catalog",total:23,batch_size:10,batches:3,expires_at:"2027-11-01T00:00:00Z"};return respond(frozen,201);
  }
  if(p.endsWith("/prepare")&&p.includes("/scans/")){
   if(method==="DELETE")return route.fulfill({status:204});
   const index=Number(p.split("/").at(-2));prepares.push(index);
   if(etaProbe&&index===0)await new Promise(r=>setTimeout(r,3000));
   if(hold&&(!etaProbe||index>0)){entered?.();await new Promise(r=>release=r)}
   const stocks=[],manifests=[],failures=[];
   for(let i=index*10;i<Math.min((index+1)*10,23);i++){
    const symbol="TEST"+String(i).padStart(2,"0");if(request.postDataJSON().retry_symbols&&!request.postDataJSON().retry_symbols.includes(symbol))continue;stocks.push(symbol);
    if(partial&&i===3){failures.push({symbol,code:"PROVIDER_UNAVAILABLE",retryable:true});continue}
    const candles=Array.from({length:50},(_,i)=>({timestamp:new Date(Date.UTC(2026,0,1+i)).toISOString(),open:100+i,high:110+i,low:90+i,close:101+i,volume:1000}));
    const backtest={...frozen.config,mode:"rule",rule_id:frozen.rule_id,study_id:frozen.id,definition_hash:frozen.definition_hash},data={schema_version:"ohlcv-multi-1",purpose:"screen",market:frozen.market,currency:frozen.currency,timeframe:"1d",timezone:"UTC",backtest,series:[{symbol,timezone:"UTC",candles}]};
    const raw=JSON.stringify(data),bytes=new TextEncoder().encode(raw),hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),x=>x.toString(16).padStart(2,"0")).join("");
    const manifest={dataset_id:symbol,version:"v1",purpose:"screen",market:frozen.market,currency:frozen.currency,timeframe:"1d",symbols:[symbol],backtest,decoded_bytes:bytes.length,checksum:"sha256:"+hash,required_operands:["PRICE"]};snapshots.set(symbol,{raw,manifest});manifests.push(manifest);
   }return respond({index,stocks,manifests,failures});
  }
  if(p.startsWith("/api/v1/screener/scans/")&&!p.endsWith("/prepare")&&method==="DELETE")return route.fulfill({status:204});
  if(p.startsWith("/api/v1/datasets/")&&p.endsWith("/content"))return route.fulfill({body:snapshots.get(p.split("/")[4]).raw,contentType:"application/json"});
  if(p==="/api/v1/compute-grants"){const b=request.postDataJSON();if(b.definition_hash!==frozen.definition_hash||b.rule_id!==frozen.rule_id)throw Error("Unbound study grant");return respond({id:b.dataset_id},201)}
  if(p==="/api/v1/screener/signals"){
   const b=request.postDataJSON();if(b.policy_version!=="signal-close-independent-1")throw Error("Wrong policy");scored.push(b.compute_grant_id);
   return respond({policy_version:b.policy_version,entries:noSignals?[]:b.candidates.filter(c=>c.timestamp.slice(0,10)>=frozen.config.from&&c.timestamp.slice(0,10)<=frozen.config.to).map(c=>({symbol:c.symbol,timestamp:c.timestamp,signal_type:"BUY"}))});
  }
  return respond({error:{code:"UNMOCKED",message:p}},404);
 });

 for(const width of [1440,390]) for(const theme of ["dark","light"]){
  partial=true;prepares=[];scored=[];
  await page.setViewportSize({width,height:1000});await page.goto(origin+"/#app/analysis");await page.reload();
  await page.getByRole("button",{name:"Market & historical screening",exact:true}).click();
  const source=page.getByLabel("Stock source",{exact:true});await source.waitFor();
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  const heading=await page.locator('.study-config-heading > div').boundingBox();
  if(!heading||heading.width<180)throw Error("Heading copy is squeezed into an icon column");
  await source.selectOption("IDX");await source.focus();await page.keyboard.press("Tab");
  if(!await page.getByLabel("Screening rule",{exact:true}).evaluate(el=>el===document.activeElement))throw Error("Keyboard order incorrect");
  await page.getByLabel("Screening rule",{exact:true}).selectOption("qa-rule");
  await page.getByLabel("Signal date from",{exact:true}).fill("2026-01-20");await page.getByLabel("Signal date to (inclusive)",{exact:true}).fill("2026-01-23");
  await page.getByRole("button",{name:"Start screening",exact:true}).click();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.signal-study-panel [role="status"]')).some(el=>el.textContent.includes("22/23 stocks processed")&&el.textContent.includes("Partial results")),{},{timeout:30000});
  if(JSON.stringify(prepares)!=="[0,1,2]"||new Set(scored).size!==22)throw Error("Coverage exceeded/omitted batches");
  await page.getByText("Stocks with missing or failed data (1)",{exact:true}).click();
  await page.getByText("TEST03: PROVIDER_UNAVAILABLE",{exact:true}).waitFor();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('table')).find(t=>t.caption?.textContent==="Matching stocks and signal dates")?.tBodies[0].rows.length===50);
  await page.getByRole("button",{name:"Next signals",exact:true}).click();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('table')).find(t=>t.caption?.textContent==="Matching stocks and signal dates")?.tBodies[0].rows.length===38);
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error("Overflow at "+width);
  await page.screenshot({path:`output/playwright/market-screen-${width}-${theme}.png`,fullPage:true});
  partial=false;prepares=[];scored=[];
  await page.getByRole("button",{name:"Start screening",exact:true}).click();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('.signal-study-panel [role="status"]')).some(el=>el.textContent.includes("23/23 stocks processed")&&el.textContent.includes("Selection complete")),{},{timeout:30000});
  if(scored.length!==23)throw Error("Restart lost stocks");reports.push({width,theme,stocks:23,signals:92});
 }
 hold=true;prepares=[];scored=[];const started=new Promise(r=>entered=r);
 await page.getByRole("button",{name:"Start screening",exact:true}).click();await started;
 await page.getByRole("button",{name:"Stop screening",exact:true}).click();release?.();hold=false;
 await page.waitForTimeout(300);if(scored.length)throw Error("Stopped response was scored");

 noSignals=true;
 await page.getByLabel("Stock source",{exact:true}).selectOption("qa-universe");
 await page.getByRole("button",{name:"Start screening",exact:true}).click();
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('.signal-study-panel [role="status"]')).some(el=>el.textContent.includes("Selection complete")),{},{timeout:30000});
 await page.getByText("No matches in the processed stocks for this rule and date range.",{exact:true}).waitFor();
 if(frozen.source!=="universe"||frozen.universe_id!=="qa-universe")throw Error("Owned universe scope was lost");
 denied=true;await page.getByRole("button",{name:"Start screening",exact:true}).click();
 await page.getByRole("alert").filter({hasText:"Your account does not have screener access."}).waitFor();
 if(!await page.getByRole("button",{name:"Start screening",exact:true}).isEnabled())throw Error("Denied request left run stuck");
 if(errors.length)throw Error(errors.join("; "));
 console.log("MARKET_SCREEN_EVIDENCE",JSON.stringify({synthetic:true,realWasm:true,indexedDB:true,reports,cancellation:true,partialCoverage:true,pagination:true,emptyState:true,deniedAccess:true,ownedUniverse:true}));
 await page.evaluate(()=>document.body.setAttribute("data-signalgen-market-screen-tests","complete"));
 return {synthetic:true,realWasm:true,indexedDB:true,reports,cancellation:true,partialCoverage:true,pagination:true,emptyState:true,deniedAccess:true,ownedUniverse:true};
}
