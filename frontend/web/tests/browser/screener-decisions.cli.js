// prettier-ignore
async (page) => {
  // Akun, harga, dan respons server berikut adalah fixture; tidak ada data akun asli.
  const origin = new URL(page.url()).origin;
  const renderErrors = [];
  page.on("pageerror", error => renderErrors.push(error.message));
  page.on("console", message => {
    if(message.type() === "error" && message.text().includes("two children with the same key")) renderErrors.push(message.text());
  });
  const user = { id: "11111111-1111-4111-8111-111111111113", full_name: "Synthetic decision QA", email: "fixture@example.test", role: "user", status: "active" };
  const now = new Date().toISOString(), day = now.slice(0, 10);
  const cases = [
    { name: "QA SELL OR crossover", signal: "SELL", logic: "OR", matched: true, label: "SELL", market: "US", conditions: [{left:"RSI14",op:"CROSS_DOWN",right:70},{left:"PRICE",op:">",right:200}], reason: "RULE_MATCHED" },
    { name: "QA BUY AND", signal: "BUY", logic: "AND", matched: true, label: "BUY", market: "IDX", conditions: [{left:"PRICE",op:"<",right:200},{left:"RSI14",op:"<",right:70}], reason: "RULE_MATCHED" },
    { name: "QA OR no match", signal: "SELL", logic: "OR", matched: false, label: "Not matched", market: "US", conditions: [{left:"RSI14",op:">",right:70},{left:"PRICE",op:">",right:200}], reason: "CONDITIONS_NOT_MET" },
    { name: "QA cooldown", signal: "BUY", logic: "AND", matched: false, label: "Cooldown", market: "IDX", conditions: [{left:"PRICE",op:"<",right:200}], reason: "COOLDOWN_ACTIVE" },
    { name: "QA legacy missing direction", signal: "SELL", logic: "OR", matched: true, label: "Matched", market: "US", legacy: true, conditions: [{left:"RSI14",op:"CROSS_DOWN",right:70}], reason: "RULE_MATCHED" },
  ];
  const rules = cases.map((item, index) => ({ id:`qa-rule-${index}`,name:item.name,owner_type:"user",read_only:false,version:1,definition_hash:`qa-hash-${index}`,schema_version:"rule-1",engine_version:"core-0.5.0",definition:{name:item.name,logic:item.logic,signal_type:item.signal,cooldown_sec:300,conditions:item.conditions} }));
  const history = cases.map((item, index) => {
    const symbol = item.market === "IDX" ? "BBCA.JK" : "AAPL";
    const decision = { symbol,timestamp:now,matched:item.matched,reason_codes:[item.reason],...(!item.legacy && item.matched ? {signal_type:item.signal} : {}) };
    const features = {price:100,ema9:99,ema20:101,rsi14:69};
    const row = {decision,features,latestOpen:101,latestClose:100,...(!item.legacy ? {prevFeatures:{price:103,ema9:102,ema20:100,rsi14:71}} : {})};
    const manifest = {dataset_id:`qa-dataset-${index}`,version:"1",schema_version:"ohlcv-multi-1",provider:"yahoo_finance",purpose:"screen",market:item.market,currency:item.market === "IDX" ? "IDR" : "USD",symbols:[symbol],exchanges:[item.market === "IDX" ? "XIDX" : "XNAS"],timeframe:"1d",timezone:"UTC",requested_range:{from:day,to:day},available_range:{from:day,to:day},warmup_candles:20,adjustment:"split",candle_count:100,decoded_bytes:1000,checksum:`qa-checksum-${index}`,quality:{status:"complete",warnings:index === 0 ? ["AAPL: excluded 1 unfinished or unconfirmed daily candle(s)", "AAPL: excluded 1 null OHLCV row(s); history may have gaps"] : []}};
    const run = {rows:[row],latestDecision:decision,features,latestOpen:101,latestClose:100,result:{type:"screener.result",protocol:"screener-private-1",request_id:`qa-request-${index}`,decision_version:"decision-1",results:[decision]},manifest,execution:"client_wasm+server_private_scoring"};
    return {rule:item.name,recordedAt:new Date(Date.now()-index*1000).toISOString(),run,context:{ruleId:rules[index].id,universeId:"qa-universe",universeName:`QA ${item.market}`,ruleSnapshot:{version:1,definition_hash:rules[index].definition_hash,definition:rules[index].definition}}};
  });
  await page.addInitScript(() => {
    sessionStorage.setItem("signalgen.access-token","fixture-not-a-real-token");
    sessionStorage.setItem("signalgen.app-session","fixture-not-a-real-session");
    sessionStorage.setItem("signalgen.app-session-origin","same-origin");
    const original = URL.createObjectURL;
    URL.createObjectURL = function(blob) {
      if(blob instanceof Blob && blob.type.startsWith("text/csv")) window.__signalgenDecisionCSV = blob.text();
      return original.call(this,blob);
    };
  });
  await page.route("**/*", async route => {
    const request=route.request(), url=new URL(request.url()), p=url.pathname;
    if(url.origin !== origin) return route.abort();
    if(p !== "/api" && !p.startsWith("/api/") && p !== "/ready") return route.continue();
    let payload;
    if(p === "/api" || p === "/ready") payload={status:"ready",name:"Synthetic API"};
    else if(p === "/api/auth/me") payload=user;
    else if(p === "/api/v1/account/me") payload={user,features:["screener"],session:{id:"qa-session",expires_at:new Date(Date.now()+86400000).toISOString()},device:{installation_id:"qa",current:true},capabilities_version:"capabilities-4"};
    else if(p === "/api/v1/rules") payload={items:rules};
    else if(p === "/api/v1/stock-universes") payload={items:[{id:"qa-universe",name:"QA US",symbols:["AAPL"],version:1}]};
    else if(p === "/api/v1/subscription") payload={subscription:{plan_code:"pro",plan_name:"Pro",status:"active",features:["screener"],source:"manual",current_period_end:new Date(Date.now()+86400000).toISOString()}};
    else if(p === "/api/v1/workspace") payload={items:[]};
    else if(p.startsWith("/api/v1/workspace/") && request.method() === "PUT") {
      const body=request.postDataJSON();
      payload={kind:p.split("/").at(-1),data:body.data,version:(body.version ?? 0)+1,updated_at:now};
    } else return route.fulfill({status:404,json:{error:{code:"UNMOCKED_TEST_ROUTE",message:p}}});
    return route.fulfill({json:payload});
  });
  await page.goto(`${origin}/#home`);
  await page.reload();
  // Simpan melalui kode produksi, bukan memasukkan riwayat yang melewati sanitasi.
  await page.evaluate(async ({user,history}) => {
    const monitor = await import("/src/lib/market-monitor.ts");
    for(const item of [...history].reverse()) monitor.recordMonitorRun(user.id,item.rule,item.run,item.context);
  }, {user,history});
  await page.goto(`${origin}/#app/analysis`);
  await page.getByRole("button",{name:"Export CSV",exact:true}).waitFor({timeout:15000});
  await page.reload();
  await page.getByRole("button",{name:"Export CSV",exact:true}).waitFor({timeout:15000});
  await page.emulateMedia({reducedMotion:"reduce"});
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    for(let theme=0; theme < 1; theme++) {
      const summary=page.locator(".screener-history > summary");
      if(!await page.locator(".screener-history").evaluate(el=>el.open)) await summary.click();
      for(const item of cases) {
        const past = page.locator('.screener-history li').filter({hasText:item.name});
        if (!(await past.locator('.screener-history-statuses').innerText()).includes(`${item.label} 1`)) throw Error('History decision counts changed the saved signal meaning');
        await page.locator(".screener-history li").filter({hasText:item.name}).getByRole("button",{name:"Review result",exact:true}).click();
        const row=page.locator(".screener-result-ledger tbody tr").first();
        await page.getByRole('button', {name:/View data quality/}).click();
        const quality = page.getByRole('dialog', { name:'Data quality', exact:true });
        await quality.waitFor();
        if (!(await quality.innerText()).includes(item.market === 'US' ? 'America/New_York' : 'Asia/Jakarta')) throw Error('Market timezone missing from snapshot provenance');
        if (!(await quality.innerText()).includes('does not guarantee gap-free')) throw Error('Complete was presented as guaranteed data quality');
        if (item.name === cases[0].name && await quality.locator('li').count() !== 2) throw Error('Provider warnings were lost after history reload');
        await quality.getByRole('button', {name:'Close', exact:true}).click();
        const label=(await row.getByRole("cell").nth(1).innerText()).trim();
        if(label !== item.label) throw Error(`Wrong direction after reload: ${item.name}: ${label}`);
        const currency=item.market === "IDX" ? "IDR" : "USD";
        await page.getByRole("columnheader",{name:`Open price (${currency})`,exact:true}).waitFor();
        await page.getByRole("columnheader",{name:`Close price (${currency})`,exact:true}).waitFor();
        const reason=await row.getByRole("cell").nth(6).innerText();
        if(item.reason === "RULE_MATCHED" && !reason.includes(item.logic === "OR" ? "At least one condition met." : "All conditions met.")) throw Error(`Incorrect logic explanation: ${item.name}`);
        if(item.reason === "CONDITIONS_NOT_MET" && !reason.includes("No conditions met.")) throw Error("OR failure reason is wrong");
        if(item.reason === "COOLDOWN_ACTIVE" && !reason.includes("conditions met, but")) throw Error("Cooldown was confused with a false condition");
        await row.getByRole("button",{name:item.market === "IDX" ? "BBCA" : "AAPL",exact:true}).click();
        const detail=page.locator(".stock-detail");
        const evidence=await detail.locator(".stock-detail__evidence").innerText();
        if(item.legacy) {
          if(!evidence.includes("this crossover cannot be verified") || /\nNot met\n/.test(evidence)) throw Error("Missing legacy evidence was shown as false");
          if(!(await detail.innerText()).includes("signal direction unavailable")) throw Error("Legacy signal was guessed");
        } else if(item.name === cases[0].name) {
          if(!/Previous candle\s+71/.test(evidence) || !/Current candle\s+69/.test(evidence) || !evidence.includes("\nMet\n") || !evidence.includes("\nNot met\n")) throw Error("SELL OR must preserve one true crossover plus one false condition");
          const comparison = detail.locator('.crossover-evidence[data-crossover="true"]');
          if (!await comparison.evaluate(el => el.children.length === 2 && getComputedStyle(el).gridTemplateColumns.split(' ').length === 2)) throw Error('Crossover is not a two-column comparison');
          await page.evaluate(() => window.scrollTo(0,0));
          await page.screenshot({path:`/private/tmp/signalgen-evidence-flow-${width}-${theme}.png`,fullPage:true,animations:'disabled'});
          await page.getByRole('button', {name:/View data quality/}).click();
          await quality.screenshot({path:`/private/tmp/signalgen-data-quality-${width}-${theme}.png`,animations:'disabled'});
          await quality.getByRole('button', {name:'Close', exact:true}).click();
          await detail.locator('.stock-detail__evidence').screenshot({path:`/private/tmp/signalgen-crossover-${width}-${theme}.png`,animations:'disabled'});
          await page.locator('.screener-history').screenshot({path:`/private/tmp/signalgen-history-status-${width}-${theme}.png`,animations:'disabled'});
          if(!(await detail.innerText()).includes("SELL signal (not an order)")) throw Error("Detail lost SELL direction");
        }
        await page.getByRole("button",{name:"Close details",exact:true}).click();
        if(width === 1440 && theme === 0) {
          const download=page.waitForEvent("download");
          await page.getByRole("button",{name:"Export CSV",exact:true}).click();
          await download;
          const csv=await page.evaluate(()=>window.__signalgenDecisionCSV);
          const symbol=item.market === "IDX" ? "BBCA.JK" : "AAPL";
          if(!csv.includes(`"${symbol}","${item.label}"`) || !csv.includes(`"Open ${currency}"`) || !csv.includes(`"Close ${currency}"`)) throw Error(`CSV changed meaning or currency: ${item.name}`);
        }
        if(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth+1)) throw Error(`Horizontal overflow ${width}: ${item.name}`);
      }
      if (await page.getByRole("button", { name: /Switch to .* mode/ }).count()) throw Error("Theme toggle must remain hidden while dark-only mode is active");
    }
  }
  if(renderErrors.length) throw Error(renderErrors.join("; "));
  await page.evaluate(()=>document.body.setAttribute("data-signalgen-decision-tests","complete"));
  return {synthetic:true,cases:cases.length,widths:[1440,390],themes:2,reload:true,csv:true,history:true};
}
