// prettier-ignore
async (page) => {
  // Isolated synthetic data only. Block every external request.
  const origin = new URL(page.url()).origin;
  const user = {id:"11111111-1111-4111-8111-111111111115",full_name:"Usability QA",email:"usability@example.test",role:"user",status:"active"};
  const now = new Date().toISOString(), day = now.slice(0,10);
  const rule = {id:"qa-rule",name:"QA momentum",owner_type:"user",read_only:false,version:1,definition_hash:"qa",engine_version:"core-0.5.0",definition:{name:"QA momentum",logic:"AND",signal_type:"BUY",cooldown_sec:0,conditions:[{left:"RSI14",op:">",right:50}]}};
  const universe = {id:"qa-universe",name:"QA universe",symbols:["BBCA.JK","BBRI.JK","TLKM.JK"],version:1};
  const rows = universe.symbols.map((symbol,index)=>({decision:{symbol,timestamp:now,matched:index<2,signal_type:"BUY",reason_codes:[index<2?"RULE_MATCHED":"CONDITIONS_NOT_MET"]},features:{price:100,ema9:99,ema20:98,rsi14:60},latestOpen:95,latestClose:100}));
  const run = {rows,latestDecision:rows[0].decision,features:rows[0].features,latestOpen:95,latestClose:100,result:{type:"screener.result",protocol:"screener-private-1",request_id:"qa-run",decision_version:"qa",results:rows.map(r=>r.decision)},manifest:{dataset_id:"qa-data",version:"1",schema_version:"ohlcv-multi-1",provider:"yahoo_finance",purpose:"screen",market:"IDX",currency:"IDR",symbols:universe.symbols,timeframe:"1d",timezone:"UTC",requested_range:{from:day,to:day},available_range:{from:day,to:day},warmup_candles:20,adjustment:"none",candle_count:100,decoded_bytes:1000,checksum:"qa-checksum",quality:{status:"complete",warnings:[]}},execution:"client_wasm+server_private_scoring"};
  const history = [{rule:rule.name,recordedAt:now,context:{ruleId:rule.id,universeId:universe.id,universeName:universe.name,ruleSnapshot:rule},run}];
  const items=Array.from({length:30},(_,i)=>({id:`77777777-7777-4777-8777-${String(i+1).padStart(12,"0")}`,version:1,bytes:1000,data:{symbol:`QA${String(i).padStart(2,"0")}`,market:"IDX",currency:"IDR",side:"BUY",quantity:100,entry_price:100,exit_price:101,entry_fee:0,exit_fee:0,entry_date:day,exit_date:day,book:"QA journal",note:`Fixture note ${i}`,net_pl:100,return_pct:1}}));
  let rulesMode="normal",journalMode="normal",rulesReads=0,releaseRules,releaseJournal;
  const writes=[],errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.addInitScript(({user,history})=>{
    sessionStorage.setItem("signalgen.access-token","synthetic-not-real");
    sessionStorage.setItem("signalgen.app-session","synthetic-session");
    sessionStorage.setItem("signalgen.app-session-origin","same-origin");
    localStorage.setItem(`signalgen:workspace:v1:${user.id}:monitor-history`,JSON.stringify({version:1,savedAt:Date.now(),data:history}));
  },{user,history});
  await page.route("**/*",async route=>{
    const req=route.request(),url=new URL(req.url()),p=url.pathname;
    if(url.origin!==origin)return route.abort();
    if(p!=="/api"&&!p.startsWith("/api/")&&p!=="/ready")return route.continue();
    if(p==="/api/v1/rules"){
      rulesReads++;
      if(rulesMode==="hold")await new Promise(resolve=>releaseRules=resolve);
      if(rulesMode==="fail")return route.fulfill({status:503,json:{error:{code:"SERVICE_UNAVAILABLE",message:"Synthetic rules outage"}}});
      return route.fulfill({json:{items:[rule]}});
    }
    if(p.startsWith("/api/v1/journal/trades")){
      if(req.method()==="GET"){
        if(journalMode==="hold")await new Promise(resolve=>releaseJournal=resolve);
        if(journalMode==="fail")return route.fulfill({status:503,json:{error:{code:"SERVICE_UNAVAILABLE",message:"Synthetic journal read outage"}}});
        return route.fulfill({json:{items}});
      }
      const body=req.postDataJSON(),id=p.split("/").at(-1);
      writes.push({id,body});
      const record={id,version:1,bytes:1000,data:{...body.data,net_pl:null,return_pct:null}};
      items.push(record);
      return route.fulfill({json:record});
    }
    let payload;
    if(p==="/api"||p==="/ready")payload={status:"ready",name:"Synthetic API"};
    else if(p==="/api/auth/me")payload=user;
    else if(p==="/api/v1/account/me")payload={user,features:["screener","backtest"],session:{id:"qa",expires_at:new Date(Date.now()+86400000).toISOString()},device:{installation_id:"qa",current:true}};
    else if(p==="/api/v1/stock-universes")payload={items:[universe]};
    else if(p==="/api/v1/workspace")payload={items:[{kind:"monitor-history",data:history,version:1,updated_at:now}]};
    else if(p.startsWith("/api/v1/workspace/")){const body=req.postDataJSON();payload={kind:p.split("/").at(-1),data:body.data,version:(body.version??0)+1,updated_at:now};}
    else if(p==="/api/v1/subscription")payload={subscription:null};
    else if(p==="/api/v1/subscription/plans")payload={items:[]};
    else payload={items:[]};
    return route.fulfill({json:payload});
  });
  const wait=async predicate=>{for(let n=0;n<80;n++){if(predicate())return;await page.waitForTimeout(50);}throw Error("Fixture did not reach expected request state");};
  await page.goto(`${origin}/#app/analysis`);await page.reload();
  await page.getByRole("button",{name:"Refresh selections",exact:true}).waitFor();
  const stock=page.getByRole("button",{name:"BBCA",exact:true});
  const initialReads=rulesReads;
  rulesMode="hold";
  await page.getByRole("button",{name:"Refresh selections",exact:true}).click();
  await wait(()=>Boolean(releaseRules));
  if(!await stock.isVisible())throw Error("Refresh hid the previous screening result");
  if(await page.locator(".screener-resource-loading").count())throw Error("Refresh replaced selections with skeletons");
  if(!await page.getByRole("button",{name:"Refresh selections",exact:true}).isDisabled())throw Error("Duplicate resource refresh allowed");
  rulesMode="normal";releaseRules();
  await page.getByText("Refreshing selections. Your current settings and results stay visible.",{exact:true}).waitFor({state:"detached"});
  if(rulesReads!==initialReads+1)throw Error("Refresh was duplicated");
  rulesMode="fail";
  await page.getByRole("button",{name:"Refresh selections",exact:true}).click();
  const errorDialog=page.getByRole("dialog",{name:"Service temporarily unavailable",exact:true});
  await errorDialog.waitFor();
  await errorDialog.getByRole("button",{name:"Close",exact:true}).click();
  if(!await stock.isVisible())throw Error("Read outage lost the previous result");
  rulesMode="normal";
  await page.getByRole("button",{name:"Refresh selections",exact:true}).click();
  await page.getByRole("button",{name:"Refresh selections",exact:true}).waitFor();
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    const all=page.getByRole("checkbox",{name:"Select visible matched stocks",exact:true});
    await all.check();
    if(!await page.getByRole("checkbox",{name:"Select TLKM for journal",exact:true}).isDisabled())throw Error("Rejected stock is selectable");
    // Search must not silently drop selections hidden by filters.
    const search=page.locator("#screen-search");
    await search.fill("BBCA");if(!await page.getByRole("button",{name:"Review 2 in journal",exact:true}).isEnabled())throw Error("Filtering discarded selected stocks");await search.fill("");
    await page.locator(".screener-results").screenshot({path:`output/playwright/usability-screening-${width}.png`,animations:"disabled"});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error(`Document overflow at ${width}`);
    await page.getByRole("button",{name:"Clear selection",exact:true}).click();
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole("checkbox",{name:"Select visible matched stocks",exact:true}).check();
  await page.getByRole("button",{name:"Review 2 in journal",exact:true}).click();
  await page.getByRole("heading",{name:"Record a trade",exact:true}).waitFor();
  if(writes.length)throw Error("Selecting stocks saved trades before confirmation");
  if(await page.locator("#trade-symbol").inputValue()!=="BBCA")throw Error("First selected draft missing");
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    await page.locator(".journal-capture").screenshot({path:`output/playwright/usability-review-${width}.png`,animations:"disabled"});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error(`Review overflow at ${width}`);
  }
  await page.locator("#trade-entry").fill("105");
  await page.getByRole("button",{name:"Save trade",exact:true}).evaluate(button=>{button.click();button.click();});
  await wait(()=>writes.length===1);
  await page.waitForFunction(()=>document.querySelector("#trade-symbol")?.value==="BBRI");
  if(writes[0].body.data.entry_price!==105)throw Error("Review edits were not saved");
  if(writes.length!==1)throw Error("Double click duplicated a save or saved the second draft automatically");
  await page.getByRole("button",{name:"Skip current draft",exact:true}).click();
  if(writes.length!==1)throw Error("Skipping a draft created a trade");
  await page.getByRole("button",{name:"Open journal form",exact:true}).waitFor();
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    const body=page.locator(".journal-ledger tbody");
    if(await body.locator("tr").count()>25)throw Error("Journal page is unbounded");
    await page.getByRole("button",{name:"Next trades",exact:true}).click();
    if(await body.locator("tr").count()!==6)throw Error("Journal pagination count mismatch");
    await page.getByLabel("Search recorded trades",{exact:true}).fill("QA29");
    if(await body.locator("tr").count()!==1)throw Error("Journal search did not reset pagination");
    if(!await page.getByRole("region",{name:"Trading performance",exact:true}).isVisible())throw Error("Filtered performance disappeared");
    await page.getByLabel("Search recorded trades",{exact:true}).fill("");
    await page.locator(".journal-ledger").screenshot({path:`output/playwright/usability-journal-${width}.png`,animations:"disabled"});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error(`Journal overflow at ${width}`);
  }
  journalMode="hold";
  await page.getByRole("button",{name:"Refresh journal",exact:true}).click();
  await wait(()=>Boolean(releaseJournal));
  if(!await page.locator(".journal-ledger").isVisible())throw Error("Journal refresh hid records");
  journalMode="normal";releaseJournal();
  await page.getByText("Refreshing journal. Previous records remain visible.",{exact:true}).waitFor({state:"detached"});
  journalMode="fail";
  await page.getByRole("button",{name:"Refresh journal",exact:true}).click();
  await page.getByText("Journal unavailable",{exact:true}).waitFor();
  if(!await page.locator(".journal-ledger").isVisible())throw Error("Journal outage lost previous records");
  if(!await page.evaluate(()=>sessionStorage.getItem("signalgen.access-token")==="synthetic-not-real"))throw Error("Transient outage cleared login");
  if(errors.length)throw Error(errors.join("; "));
  await page.evaluate(()=>document.body.setAttribute("data-signalgen-usability-tests","complete"));
  return {synthetic:true,individualWrites:writes.length,refreshRetained:true,widths:[1440,390]};
}
