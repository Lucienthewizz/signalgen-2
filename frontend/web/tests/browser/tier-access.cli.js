// prettier-ignore
async (page) => {
  // Isolated synthetic data only. Block every external request.
  const origin = new URL(page.url()).origin;
  const user = {id:"11111111-1111-4111-8111-111111111115",full_name:"Usability QA",email:"usability@example.test",role:"user",status:"active"};
  const now = new Date().toISOString(), day = now.slice(0,10);
  const rule = {id:"default-scalping-v1",name:"System screening rule",owner_type:"system",read_only:true,version:1,definition_hash:"qa",engine_version:"core-0.5.0"};
  const universe = {id:"qa-universe",name:"QA universe",symbols:["BBCA.JK","BBRI.JK","TLKM.JK"],version:1};
  const rows = universe.symbols.map((symbol,index)=>({decision:{symbol,timestamp:now,matched:index<2,journal_receipt:index<2?`fixture-${index}`:undefined,signal_type:index<2?"BUY":undefined,reason_codes:[index<2?"RULE_MATCHED":"CONDITIONS_NOT_MET"]},features:{price:100,ema9:99,ema20:98,rsi14:60},latestOpen:95,latestClose:100}));
  const run = {rows,latestDecision:rows[0].decision,features:rows[0].features,latestOpen:95,latestClose:100,result:{type:"screener.result",protocol:"screener-private-1",request_id:"qa-run",decision_version:"qa",results:rows.map(r=>r.decision)},manifest:{dataset_id:"qa-data",version:"1",schema_version:"ohlcv-multi-1",provider:"yahoo_finance",purpose:"screen",market:"IDX",currency:"IDR",symbols:universe.symbols,timeframe:"1d",timezone:"UTC",requested_range:{from:day,to:day},available_range:{from:day,to:day},warmup_candles:20,adjustment:"none",candle_count:300,decoded_bytes:1000,checksum:"qa-checksum",quality:{status:"complete",warnings:[]}},execution:"client_wasm+server_private_scoring"};
  const history = [];
  const snapshot=(symbol)=>({schema_version:"screening-journal-1",source:"screening",symbol,market:"IDX",currency:"IDR",rule_id:rule.id,rule_name:rule.name,definition_hash:rule.definition_hash,timeframe:"1d",candle_at:now,screened_at:now,matched:true,signal_type:"BUY",price:100,features:{price:100,ema9:99,ema20:98,rsi14:60},reason_codes:["RULE_MATCHED"],dataset_checksum:"qa-checksum"});
  const items=[];
  let groups=[], tier="free", premiumCalls=0;
  const limits=()=>({custom_rules:tier==="free"?0:tier==="analyst"?10:50,stock_universes:tier==="free"?1:tier==="analyst"?5:20});
  const policy=()=>({plan_code:tier,source:tier==="free"?"free":"subscription",features:tier==="pro"?["screener","backtest"]:["screener"],limits:limits(),screening:{max_symbols:tier==="free"?3:10,timeframes:tier==="free"?["1d"]:["1m","5m","15m","1h","1d"],system_rules_only:tier==="free"}});
  let failSecond = false;

  let rulesMode="normal",journalMode="normal",rulesReads=0,releaseRules,releaseJournal;
  const writes=[],errors=[];
  page.on("pageerror",e=>{
    // Blocked third-party/about:blank frames cannot use storage. The active
    // page's login token is asserted separately below.
    if(e.message.includes("Access is denied for this document"))return;
    errors.push(e.message);
  });
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
    if(p==="/src/analysis/screener.ts")return route.fulfill({contentType:"application/javascript",body:`export async function runLiveScreener(){return ${JSON.stringify(run)};}`});
    if(p!=="/api"&&!p.startsWith("/api/")&&p!=="/ready")return route.continue();
    if(p.startsWith("/api/v1/backtests/studies") || p==="/api/v1/datasets/prepare" || p==="/api/v1/compute-grants") {premiumCalls++;return route.fulfill({status:403,json:{error:{code:"FEATURE_NOT_INCLUDED",message:"Pro required"}}});}
    if(p==="/api/v1/stock-universes" && req.method()==="POST") {
      const body=req.postDataJSON();if(groups.length || body.symbols.length>3) return route.fulfill({status:403,json:{error:{code:"PLAN_LIMIT_EXCEEDED",message:"Free capacity"}}});
      groups=[{...universe,name:body.name,symbols:body.symbols}];return route.fulfill({status:201,json:groups[0]});
    }
    if(p==="/api/v1/rules"){
      rulesReads++;
      if(rulesMode==="hold")await new Promise(resolve=>releaseRules=resolve);
      if(rulesMode==="fail")return route.fulfill({status:503,json:{error:{code:"SERVICE_UNAVAILABLE",message:"Synthetic rules outage"}}});
      return route.fulfill({json:{items:[rule]}});
    }
    if(p==="/api/v1/journal/screenings"){
      if(req.method()==="GET"){
        if(journalMode==="fail")return route.fulfill({status:503,json:{error:{code:"JOURNAL_UNAVAILABLE",message:"Synthetic journal read outage"}}});
        return route.fulfill({json:{schema_version:"screening-journal-1",items}});
      }
      const body=req.postDataJSON();writes.push({body});
      if(req.method()!=="POST"||Object.keys(body).length!==1||!["fixture-0","fixture-1"].includes(body.receipt))throw Error("Journal accepted a manual trade payload");
      if(body.receipt==="fixture-1"&&failSecond)return route.fulfill({status:503,json:{error:{code:"JOURNAL_UNAVAILABLE",message:"Synthetic one-row interruption"}}});
      await new Promise(resolve=>setTimeout(resolve,40));
      const index=Number(body.receipt.at(-1)),id=`88888888-8888-4888-8888-${String(index).padStart(12,"0")}`;
      let item=items.find(r=>r.id===id);if(!item){item={id,version:1,bytes:1000,data:snapshot(universe.symbols[index])};items.push(item);}return route.fulfill({json:item});
    }
    if(p.startsWith("/api/v1/journal/trades")&&req.method()!=="GET")throw Error("Removed journal action reached the API");
    let payload;
    if(p==="/api"||p==="/ready")payload={status:"ready",name:"Synthetic API"};
    else if(p==="/api/auth/me")payload=user;
    else if(p==="/api/v1/account/me")payload={user,features:policy().features,access:policy(),session:{id:"qa",expires_at:new Date(Date.now()+86400000).toISOString()},device:{installation_id:"qa",current:true}};
    else if(p==="/api/v1/stock-universes")payload={items:groups};
    else if(p==="/api/v1/workspace")payload={items:[]};
    else if(p.startsWith("/api/v1/workspace/")){const body=req.postDataJSON();payload={kind:p.split("/").at(-1),data:body.data,version:(body.version??0)+1,updated_at:now};}
    else if(p==="/api/v1/subscription")payload={subscription:tier==="free"?null:{id:"synthetic-plan",plan_code:tier,plan_name:tier==="analyst"?"Analyst":"Pro",status:"active",features:policy().features,current_period_start:"2026-11-01T00:00:00Z",current_period_end:"2027-01-01T00:00:00Z",cancel_at_period_end:false,source:"manual"},access:policy()};
    else if(p==="/api/v1/subscription/usage")payload={limits:limits(),used:{custom_rules:0,stock_universes:groups.length},access:policy()};
    else if(p==="/api/v1/stocks")payload={items:[...["BBCA.JK","BBRI.JK","TLKM.JK","ASII.JK"].map(symbol=>({symbol,name:symbol.split(".")[0],exchange:"XIDX",currency:"IDR",provider_symbol:symbol}))]};
    else if(p==="/api/v1/subscription/plans")payload={items:["free","analyst","pro"].map((code,index)=>({code,name:["Free","Analyst","Pro"][index],description:"Fixture plan",features:index===2?["screener","backtest"]:["screener"],limits:{custom_rules:[0,10,50][index],stock_universes:[1,5,20][index]},screening:{max_symbols:index?10:3,timeframes:index?["1m","5m","15m","1h","1d"]:["1d"],system_rules_only:!index},pricing:{amount:[0,49000,99000][index],currency:"IDR",period:"month",activation:"manual"}}))};
    else payload={items:[]};
    return route.fulfill({json:payload});
  });

  await page.goto(`${origin}/#app/analysis`);await page.reload();
  await page.getByText("Free plan",{exact:false}).first().waitFor();
  await page.getByRole("button",{name:"Start screening",exact:true}).waitFor();
  if(await page.getByRole("dialog",{name:/Screening|access|Plan|unavailable/i}).count())throw Error("Free onboarding opened a permission modal");
  if(groups.length)throw Error("Universe was auto-created");
  if(!await page.getByRole("button",{name:"Start screening",exact:true}).isDisabled())throw Error("Empty account could screen without stock selection");
  await page.goto(`${origin}/#app/universes`);
  await page.getByRole("heading",{name:"Build a stock universe",exact:true}).waitFor();
  for(const symbol of ["BBCA","BBRI","TLKM"]) await page.getByRole("button",{name:new RegExp("Add "+symbol)}).click();
  if(!await page.getByRole("button",{name:/Add ASII/}).isDisabled())throw Error("Free could choose a fourth stock");
  await page.getByLabel("Universe name",{exact:true}).fill("My first three stocks");
  await page.getByRole("button",{name:"Create universe",exact:true}).click();
  await page.getByText("Stock universe created and ready for screening.",{exact:true}).first().waitFor();
  await page.goto(`${origin}/#app/analysis`);
  await page.getByRole("button",{name:"Start screening",exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('button') && [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==="Start screening"&&!b.disabled));
  if(await page.getByRole("dialog",{name:/Screening|access|Plan|unavailable/i}).count())throw Error("Free screening opened permission modal");
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));
    await page.screenshot({path:`output/playwright/mvp-screener-${width}.png`,fullPage:true});
    await page.getByRole("region",{name:"Screening plan",exact:true}).screenshot({path:`output/playwright/mvp-free-info-${width}.png`});
    const summary=page.getByRole("region",{name:"Screening plan",exact:true});
    if(!await summary.isVisible() || await summary.locator("li").count()!==3)throw Error("Plan limits are not clearly grouped");
    if(width===1440){
      await page.getByRole("button",{name:"Close menu",exact:true}).click();
      const badge=page.getByRole("link",{name:"Free plan and limits",exact:true});
      const box=await badge.boundingBox();if(!box||box.width<44||box.width>50)throw Error("Collapsed plan control has incorrect width");
      await page.screenshot({path:"output/playwright/mvp-sidebar-collapsed.png"});
      await page.getByRole("button",{name:"Open workspace menu",exact:true}).click();
    }
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2))throw Error("Screener plan summary overflows");
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole("combobox",{name:"Candle interval",exact:true}).click();
  if(!await page.getByRole("option",{name:"5 minutes",exact:true}).isDisabled())throw Error("Free intraday control was not limited");
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"Start screening",exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('input[aria-label="Select BBCA for journal"]')?.disabled===false);
  await page.getByRole("button",{name:"Stop",exact:true}).click();
  await page.getByLabel("Select BBCA for journal",{exact:true}).check();
  await page.getByRole("button",{name:/Add 1 to journal/}).click();
  await page.getByRole("heading",{name:/1 matched result selected/}).waitFor();
  await page.getByRole("button",{name:/Save.*journal/i}).last().click();
  await page.getByText("BBCA",{exact:true}).first().waitFor();
  if(writes.length!==1||writes[0].body.receipt!=="fixture-0")throw Error("Free Match did not save only its attested receipt");
  for(const code of ["free","analyst"]){
    tier=code;
    await page.goto(`${origin}/#app/backtest`);await page.reload();
    await page.getByText("Historical analysis preview",{exact:true}).waitFor();
    await page.getByText(/Illustrative fixture data only/).waitFor();
    if(premiumCalls)throw Error("Preview called a premium computation endpoint");
  }
  await page.goto(`${origin}/#app/subscription`);
  await page.getByRole("button",{name:"Ajukan aktivasi",exact:true}).first().waitFor();
  await page.getByRole("button",{name:"Ajukan aktivasi",exact:true}).first().click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("dialog").getByRole("button",{name:"Close",exact:true}).click();
  for(const width of [1440,390])for(const theme of ["dark","light"]){
    await page.setViewportSize({width,height:1000});
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.classList.toggle("dark",theme==="dark");},theme);
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2))throw Error(`Tier page overflows ${width}/${theme}`);
    await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));
    await page.screenshot({path:`output/playwright/mvp-tier-${width}-${theme}.png`,fullPage:true});
  }
  await page.goto(`${origin}/#home`);
  await page.locator(".pricing-plan").nth(2).waitFor();
  const pricing=page.locator("#pricing");
  const prices=await pricing.locator(".pricing-plan__price").allInnerTexts();
  if(prices.length!==3||!prices.some(t=>t.includes("49.000"))||!prices.some(t=>t.includes("99.000")))throw Error("Public pricing did not use the API monthly prices");
  if(await pricing.getByRole("button",{name:/Annual|Yearly/i}).count())throw Error("Public pricing still offers an annual toggle");
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    await pricing.screenshot({path:`output/playwright/mvp-public-pricing-${width}.png`});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2))throw Error("Public pricing overflows");
  }
  if(errors.length)throw Error(errors.join("; "));
  await page.evaluate(()=>document.body.setAttribute("data-signalgen-tier-tests","complete"));
}
