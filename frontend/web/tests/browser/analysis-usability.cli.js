// prettier-ignore
async (page) => {
  // Isolated synthetic data only. Block every external request.
  const origin = new URL(page.url()).origin;
  const user = {id:"11111111-1111-4111-8111-111111111115",full_name:"Usability QA",email:"usability@example.test",role:"user",status:"active"};
  const now = new Date().toISOString(), day = now.slice(0,10);
  const rule = {id:"qa-rule",name:"QA momentum",owner_type:"user",read_only:false,version:1,definition_hash:"qa",engine_version:"core-0.5.0",definition:{name:"QA momentum",logic:"AND",signal_type:"BUY",cooldown_sec:0,conditions:[{left:"RSI14",op:">",right:50}]}};
  const universe = {id:"qa-universe",name:"QA universe",symbols:["BBCA.JK","BBRI.JK","TLKM.JK"],version:1};
  const rows = universe.symbols.map((symbol,index)=>({decision:{symbol,timestamp:now,matched:index<2,journal_receipt:index<2?`fixture-${index}`:undefined,signal_type:"BUY",reason_codes:[index<2?"RULE_MATCHED":"CONDITIONS_NOT_MET"]},features:{price:100,ema9:99,ema20:98,rsi14:60},latestOpen:95,latestClose:100}));
  const run = {rows,latestDecision:rows[0].decision,features:rows[0].features,latestOpen:95,latestClose:100,result:{type:"screener.result",protocol:"screener-private-1",request_id:"qa-run",decision_version:"qa",results:rows.map(r=>r.decision)},manifest:{dataset_id:"qa-data",version:"1",schema_version:"ohlcv-multi-1",provider:"yahoo_finance",purpose:"screen",market:"IDX",currency:"IDR",symbols:universe.symbols,timeframe:"1d",timezone:"UTC",requested_range:{from:day,to:day},available_range:{from:day,to:day},warmup_candles:20,adjustment:"none",candle_count:100,decoded_bytes:1000,checksum:"qa-checksum",quality:{status:"complete",warnings:[]}},execution:"client_wasm+server_private_scoring"};
  const history = [{rule:rule.name,recordedAt:now,context:{ruleId:rule.id,universeId:universe.id,universeName:universe.name,ruleSnapshot:rule},run}];
  const snapshot=(symbol)=>({schema_version:"screening-journal-1",source:"screening",symbol,market:"IDX",currency:"IDR",rule_id:rule.id,rule_name:rule.name,definition_hash:rule.definition_hash,timeframe:"1d",candle_at:now,screened_at:now,matched:true,signal_type:"BUY",price:100,features:{price:100,ema9:99,ema20:98,rsi14:60},reason_codes:["RULE_MATCHED"],dataset_checksum:"qa-checksum"});
  const items=Array.from({length:30},(_,i)=>({id:`77777777-7777-4777-8777-${String(i+1).padStart(12,"0")}`,version:1,bytes:1000,data:snapshot(`QA${String(i).padStart(2,"0")}`)}));
  let failSecond = true;
  let invalidReceipt = false;

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
      if(invalidReceipt)return route.fulfill({status:422,json:{error:{code:'SCREENING_RECEIPT_INVALID',message:'Run screening again and select a matched result from this session.'}}});
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
  await page.getByRole('button',{name:'Start screening',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('input[aria-label="Select BBCA for journal"]')?.disabled===false);
  await page.getByRole('button',{name:'Stop',exact:true}).click();
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
  await page.locator(".screener-error-summary").waitFor();
  if(await errorDialog.isVisible())throw Error("Resource refresh opened an automatic error modal");
  await page.getByRole("button",{name:"View error",exact:true}).click();
  await errorDialog.waitFor();
  await errorDialog.getByRole("button",{name:"Close",exact:true}).click();
  if(!await stock.isVisible())throw Error("Read outage lost the previous result");
  rulesMode="normal";
  await page.getByRole("button",{name:"Refresh selections",exact:true}).click();
  await page.getByRole("button",{name:"Refresh selections",exact:true}).waitFor();
  for(const width of [1440,1218,390]){
    await page.setViewportSize({width,height:1000});
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
    const summary=page.locator('.screener-run-summary');
    if(await summary.locator('.workspace-glass-surface,.workspace-glass-action').count())throw Error('Rule summary still uses mismatched glass surfaces');
    const surfaces=await summary.locator('.screener-run-summary__title > *').evaluateAll(items=>items.map(el=>({background:getComputedStyle(el).backgroundImage,blur:getComputedStyle(el).backdropFilter})));
    if(surfaces.some(style=>style.background!=='none'||style.blur!=='none'))throw Error('Rule summary contains glossy gradients or blur');
    await summary.evaluate(el=>el.scrollIntoView({block:'center'}));
    await summary.screenshot({path:`output/playwright/usability-rule-summary-${width}.png`,animations:'disabled'});
    const statusbar=page.locator(".screener-result-statusbar");
    const statusFilters=statusbar.locator('[data-signal-status]');
    if(await statusFilters.count()!==6)throw Error('Status color mapping is incomplete');
    for(const status of ['all','matched','buy','sell','cooldown','rejected']){
      const filter=statusbar.locator(`[data-signal-status="${status}"]`);
      await filter.click();
      if(await filter.getAttribute('aria-pressed')!=='true')throw Error(`Status ${status} cannot be selected`);
      const contrast=await filter.evaluate(el=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
        const lum=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3).map(n=>{const s=n/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0)};
        const style=getComputedStyle(el),text=lum(style.color),background=lum(style.backgroundColor),count=getComputedStyle(el.querySelector('span'));
        return {ratio:(Math.max(text,background)+.05)/(Math.min(text,background)+.05),countRatio:(Math.max(text,lum(count.backgroundColor))+.05)/(Math.min(text,lum(count.backgroundColor))+.05),same:style.color===count.color};
      });
      if(contrast.ratio<4.5||contrast.countRatio<4.5||!contrast.same)throw Error(`Status ${status} lost readable label/count colors: ${JSON.stringify(contrast)}`);
    }
    await statusbar.locator('[data-signal-status="all"]').click();
    const colors=await statusFilters.evaluateAll(items=>Object.fromEntries(items.map(el=>[el.dataset.signalStatus,getComputedStyle(el).color])));
    if(colors.buy===colors.sell||colors.cooldown===colors.buy||colors.rejected===colors.all)throw Error('Status tones are indistinguishable');
    const filtersBox=await statusbar.locator(".screener-signal-filters").boundingBox();
    const actionsBox=await statusbar.locator(".screener-result-actions").boundingBox();
    if(width>=1218 && Math.abs(filtersBox.y+filtersBox.height/2-actionsBox.y-actionsBox.height/2)>1)throw Error(`Quality and export actions wrapped at ${width}: ${JSON.stringify({filtersBox,actionsBox,button:await statusbar.locator('[data-slot="toggle-group-item"]').first().evaluate(el=>({font:getComputedStyle(el).fontSize,height:getComputedStyle(el).height,minheight:getComputedStyle(el).minHeight,padding:getComputedStyle(el).padding}))})}`);
    const dividers=await statusbar.evaluate(el=>({top:getComputedStyle(el).borderTopWidth,bottom:getComputedStyle(el).borderBottomWidth,separator:getComputedStyle(el.querySelector('.screener-result-actions')).borderInlineStartWidth}));
    if(dividers.top!=="1px"||dividers.bottom!=="1px"||(width>=1218&&dividers.separator!=="1px"))throw Error("Screening toolbar dividers missing");
    const toolbar=page.locator(".analysis-results-toolbar");
    const spacing=await toolbar.evaluate(el=>({top:parseFloat(getComputedStyle(el).paddingTop),bottom:parseFloat(getComputedStyle(el).paddingBottom),count:parseFloat(getComputedStyle(el.nextElementSibling).paddingTop)}));
    if(spacing.top<24||spacing.bottom<24||spacing.count<16)throw Error("Performance toolbar or stock count spacing is cramped");
    const performance=toolbar.locator(".analysis-performance");
    const selection=toolbar.locator(".analysis-selection-bar");
    const performanceBox=await performance.boundingBox(),selectionBox=await selection.boundingBox();
    if(width>=1218 && (selectionBox.x<performanceBox.x+performanceBox.width-1 || Math.abs(selectionBox.y-performanceBox.y)>1))throw Error(`Journal controls are not beside performance details at ${width}: ${JSON.stringify({performanceBox,selectionBox})}`);
    if(width===390 && selectionBox.y<performanceBox.y+performanceBox.height)throw Error("Mobile journal controls overlap performance details");
    const textSize=await selection.locator('[role="status"]').evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
    if(textSize>12)throw Error("Journal selection count is not compact");
    await performance.locator("summary").click();
    if(!await performance.locator("dl").isVisible())throw Error("Performance details no longer expand");
    await performance.locator("summary").click();
    const ledger=page.locator(".screener-result-ledger");
    if(await ledger.locator("thead input[type=checkbox]").count())throw Error("Number heading still contains a select-all checkbox");
    if((await ledger.locator("thead th").first().innerText())!=="No." || (await ledger.locator("thead th").last().innerText())!=="Add to journal")throw Error("Number or journal heading is missing");
    if((await ledger.locator("tbody tr td:first-child").allTextContents()).join("|")!=="1|2|3")throw Error("Screening rows are not numbered in visible order");
    if(await ledger.locator("tbody tr td:not(:last-child) input[type=checkbox]").count())throw Error("Journal checkbox is outside the Add to journal column");
    const first=page.getByRole("checkbox",{name:"Select BBCA for journal",exact:true});
    await first.focus();await page.keyboard.press("Space");
    if(!await first.isChecked())throw Error("Journal checkbox is not keyboard operable");
    await page.keyboard.press("Space");
    if(await first.isChecked())throw Error("Journal checkbox cannot be deselected");
    await first.check();
    await page.getByRole("checkbox",{name:"Select BBRI for journal",exact:true}).check();
    if(!page.url().endsWith("#app/analysis") || writes.length)throw Error("Checking a journal selection navigated or saved a trade");
    if(!await page.getByRole("checkbox",{name:"Select TLKM for journal",exact:true}).isDisabled())throw Error("Rejected stock is selectable");
    // Search must not silently drop selections hidden by filters.
    const search=page.locator("#screen-search");
    await search.fill("BBCA");if(!await page.getByRole("button",{name:"Add 2 to journal",exact:true}).isEnabled())throw Error("Filtering discarded selected stocks");if((await ledger.locator("tbody tr td:first-child").allTextContents()).join("|")!=="1")throw Error("Filtered row numbering is incorrect");await search.fill("");
    await page.locator(".screener-results").screenshot({path:`output/playwright/usability-screening-${width}.png`,animations:"disabled"});
    await ledger.locator("tbody tr").first().locator("td").last().scrollIntoViewIfNeeded();
    await ledger.screenshot({path:`output/playwright/usability-journal-selection-${width}.png`,animations:"disabled"});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error(`Document overflow at ${width}`);
    await page.getByRole("button",{name:"Clear selection",exact:true}).click();
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole("checkbox",{name:"Select BBCA for journal",exact:true}).check();
  await page.getByRole("checkbox",{name:"Select BBRI for journal",exact:true}).check();
  await page.getByRole("button",{name:"Add 2 to journal",exact:true}).click();
  await page.getByRole("heading",{name:"Saved screening results",exact:true}).waitFor();
  const selection=page.getByRole("region",{name:"Selected screening results",exact:true});
  await selection.waitFor();
  if(writes.length)throw Error("Selection saved results before explicit confirmation");
  if(await page.locator('.journal-capture,.journal-pnl-chart,input[name="quantity"]').count())throw Error("Removed journal functions remain");
  const save=page.getByRole('button',{name:'Save 2 results to journal',exact:true});
  await save.waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Save 2 results to journal'&&!b.disabled));
  await save.evaluate(button=>{button.click();button.click();});
  await page.getByText('Some results could not be saved',{exact:true}).waitFor();
  if(writes.length!==2||items.length!==31)throw Error('Double save or incorrect partial write');
  if(!(await selection.innerText()).includes('Saved')||!(await selection.innerText()).includes('Ready to save'))throw Error('Per-row save status missing');
  failSecond=false;
  await page.getByRole('button',{name:'Retry unsaved results',exact:true}).click();
  await page.getByText('Selected results saved to your journal.',{exact:true}).waitFor();
  if(writes.length!==3||writes[2].body.receipt!=='fixture-1'||items.length!==32)throw Error('Retry did not target only the failed receipt');
  await page.getByRole('button',{name:'Done',exact:true}).click();
  for(const width of [1440,390])for(const theme of ['dark','light']){
    await page.setViewportSize({width,height:1000});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    for(const name of ['Open journal form','Save trade','Update trade','Delete trade'])if(await page.getByRole('button',{name,exact:true}).count())throw Error('Manual journal action remains');
    if(await page.locator('.journal-ledger tbody tr').count()!==25)throw Error('Journal list is not bounded to 25 rows');
    await page.getByRole('button',{name:'Next results',exact:true}).click();
    if(await page.locator('.journal-ledger tbody tr').count()!==7)throw Error('Journal paging skipped results');
    await page.getByRole('button',{name:'Previous results',exact:true}).click();
    await page.screenshot({path:`output/playwright/screening-only-journal-${width}-${theme}.png`,animations:'disabled',fullPage:true});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error(`Journal overflow at ${width}/${theme}`);
  }
  journalMode='fail';await page.goto(`${origin}/#app/news`);await page.locator('.news-feed').waitFor();await page.goto(`${origin}/#app/journal`);await page.getByRole('heading',{name:'Saved screening results',exact:true}).waitFor();
  await page.getByText('Journal unavailable',{exact:true}).waitFor();
  if(!await page.evaluate(()=>sessionStorage.getItem('signalgen.access-token')==='synthetic-not-real'))throw Error('Journal outage logged out the account');
  journalMode='normal';await page.getByRole('button',{name:'Retry journal',exact:true}).click();
  await page.getByText('Journal unavailable',{exact:true}).waitFor({state:'hidden'});
  if(await page.locator('.journal-ledger tbody tr').count()!==25)throw Error('Retry did not reload saved screenings');
  // A receipt invalidated by expiry/API restart is not a retryable storage outage.
  await page.goto(`${origin}/#app/analysis`);
  await page.getByRole('button',{name:'Start screening',exact:true}).click();
  await page.getByRole('checkbox',{name:'Select BBCA for journal',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('input[aria-label="Select BBCA for journal"]')?.disabled===false);
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await page.getByRole('checkbox',{name:'Select BBCA for journal',exact:true}).check();
  await page.getByRole('button',{name:'Add 1 to journal',exact:true}).click();
  invalidReceipt=true;
  await page.getByRole('button',{name:'Save 1 result to journal',exact:true}).click();
  await page.getByRole('button',{name:'Run screening again',exact:true}).waitFor();
  if(await page.getByRole('button',{name:'Retry unsaved results',exact:true}).count())throw Error('Expired receipt offered an impossible retry');
  const countBeforeRecovery=writes.length;
  await page.getByRole('button',{name:'Run screening again',exact:true}).click();
  await page.waitForURL('**/#app/analysis');
  if(writes.length!==countBeforeRecovery)throw Error('Recovery silently resubmitted the stale receipt');
  if(errors.length)throw Error(errors.join("; "));
  await page.evaluate(()=>document.body.setAttribute("data-signalgen-usability-tests","complete"));
  return {synthetic:true,receiptWrites:writes.length,retryOnlyFailed:true,widths:[1440,1218,390]};
}
