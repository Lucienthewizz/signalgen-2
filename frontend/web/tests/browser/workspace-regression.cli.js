// prettier-ignore
async (page) => {
  const origin = new URL(page.url()).origin;
  // All API responses and account state are synthetic. Never call a real account.
  const user = { id: "11111111-1111-4111-8111-111111111111", full_name: "Akun pengujian", email: "fixture@example.test", role: "operator", status: "active" };
  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  const definition = { name: "Rule fixture", logic: "AND", signal_type: "BUY", cooldown_sec: 0, conditions: [{ left: "PRICE", op: ">", right: "EMA20" }, { left: "EMA9", op: ">", right: "EMA20" }] };
  const rule = { id: "fixture-rule", name: definition.name, owner_type: "user", read_only: false, version: 2, definition_hash: "fixture-hash", schema_version: "rule-1", engine_version: "core-0.4.0", definition };
  const universe = { id: "fixture-universe", name: "Bank pilihan", version: 1, symbols: ["BBCA.JK", "BBRI.JK"] };
  const rows = [true, false].map((matched, i) => ({ decision: { symbol: universe.symbols[i], timestamp: now, matched, reason_codes: [matched ? "RULE_MATCHED" : "CONDITIONS_NOT_MET"] }, features: { price: 100 + i, ema9: matched ? 99 : 95, ema20: 98, rsi14: 60 }, latestOpen: 95, latestClose: 100 + i }));
  const run = { rows, latestDecision: rows[0].decision, features: rows[0].features, latestOpen: 95, latestClose: 100, result: { type: "screener.result", protocol: "screener-private-1", request_id: "fixture-request", decision_version: "fixture-decision", results: rows.map(row => row.decision) }, manifest: { dataset_id: "fixture-dataset", version: "1", schema_version: "ohlcv-multi-1", provider: "yahoo_finance", purpose: "screen", market: "IDX", currency: "IDR", symbols: universe.symbols, timeframe: "1d", timezone: "UTC", requested_range: { from: day, to: day }, available_range: { from: day, to: day }, warmup_candles: 20, adjustment: "split", candle_count: 100, decoded_bytes: 1000, checksum: "fixture-checksum", quality: { status: "complete", warnings: [] } }, execution: "client_wasm+server_private_scoring" };
  const before = JSON.parse(JSON.stringify(run));
  before.rows.forEach(row => { row.decision.matched = !row.decision.matched; });
  const context = { ruleId: rule.id, universeId: universe.id, universeName: universe.name, ruleSnapshot: { version: rule.version, definition_hash: rule.definition_hash, definition } };
  const history = [ { rule: rule.name, recordedAt: now, context, run }, { rule: rule.name, recordedAt: new Date(Date.now() - 86400000).toISOString(), context, run: before } ];
  const plans = ["free", "analyst", "pro"].map((code, i) => ({ code, name: ["Free", "Analyst", "Pro"][i], features: i ? ["screener", "backtest"] : [], limits: { custom_rules: [0, 10, 50][i], stock_universes: [5, 5, 20][i] } }));
  const subscription = { plan_code: "pro", plan_name: "Pro", status: "active", features: ["screener", "backtest"], source: "manual", current_period_start: now, current_period_end: new Date(Date.now()+30*86400000).toISOString(), cancel_at_period_end: false };
  let unauthorized = false;
  let systemRule = false;
  let failUniverseDelete = false;
  let universeWrite = null;
  let ruleWrite = null;
  let ruleDeletes = 0;
  let largeUniverse = false;
  let savedCardFixture = false;
  let healthOffline = false;
  let sessionMutations = 0;
  let journalUnavailable = false;
  const journalWrites = [];
  const journalItems = [198600,90000,-32000,70000].map((pnl,i)=>({id:`77777777-7777-4777-8777-${String(i+1).padStart(12,"0")}`,version:1,bytes:1000,data:{symbol:["BBCA","TLKM","ASII","BMRI"][i],market:"IDX",currency:"IDR",side:"BUY",quantity:1000,entry_price:1000,exit_price:1000+pnl/1000,entry_fee:0,exit_fee:0,entry_date:`2026-09-${[16,15,12,10][i]}`,exit_date:`2026-09-${[16,15,12,10][i]}`,book:"Trading journal",note:"Synthetic user-recorded trade",net_pl:pnl,return_pct:pnl/10000}}));
  const sessionFixtures = [
    { id: "fixture-current", label: "Current browser", status: "active", current: true, last_seen_at: now },
    { id: "fixture-active", label: "Other active browser", status: "active", current: false, last_seen_at: now },
    { id: "fixture-ended", label: "Ended browser", status: "expired", current: false, last_seen_at: now },
  ];
  const errors = [];
  page.on("pageerror", (error) => {
    if (error.message.includes("Access is denied for this document")) return;
    errors.push(error.message);
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    ({ user, history }) => {
      try {
        sessionStorage.setItem(
          "signalgen.access-token",
          "fixture-not-a-real-token",
        );
        sessionStorage.setItem(
          "signalgen.app-session",
          "fixture-not-a-real-session",
        );
        sessionStorage.setItem("signalgen.app-session-origin", "same-origin");
        localStorage.setItem(
          `signalgen:workspace:v1:${user.id}:monitor-history`,
          JSON.stringify({ version: 1, savedAt: Date.now(), data: history }),
        );
      } catch {}
    },
    { user, history },
  );
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    const p = url.pathname;
    if(p.startsWith("/api/v1/journal/trades")){
      if(route.request().method()==="GET")return route.fulfill({json:{items:journalItems}});
      const id=p.split("/").at(-1),body=route.request().postDataJSON();journalWrites.push({id,body});
      if(journalUnavailable)return route.fulfill({status:503,json:{error:{code:"RECORDS_UNAVAILABLE",message:"Synthetic storage interruption. Nothing was reported as saved."}}});
      const index=journalItems.findIndex(r=>r.id===id);
      if(route.request().method()==="DELETE"){if(index>=0)journalItems.splice(index,1);return route.fulfill({status:204});}
      const d=body.data,net=d.exit_price===null?null:Math.round(((d.exit_price-d.entry_price)*(d.side==="BUY"?1:-1)*d.quantity-d.entry_fee-d.exit_fee)*100)/100;
      const row={id,version:(body.version??0)+1,bytes:1000,data:{...d,net_pl:net,return_pct:net===null?null:net/(d.quantity*d.entry_price+d.entry_fee)*100}};
      if(index>=0)journalItems[index]=row;else journalItems.push(row);return route.fulfill({json:row});
    }
    if (healthOffline && p === "/api") return route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "Fixture health interruption" } } });
    if (p === "/api/v1/rules" && route.request().method() === "POST") {
      ruleWrite = route.request().postDataJSON();
      return route.fulfill({ json: { ...rule, name: ruleWrite.definition.name, definition: ruleWrite.definition } });
    }
    if (p === "/api/v1/rules/fixture-rule" && route.request().method() === "DELETE") {
      ruleDeletes++;
      return route.fulfill({ status: 204 });
    }
    if (p.startsWith("/api/v1/account/sessions/") && route.request().method() !== "GET") sessionMutations++;
    if (p.startsWith("/api/v1/stock-universes") && ["POST", "PATCH"].includes(route.request().method())) {
      universeWrite = { method: route.request().method(), body: route.request().postDataJSON() };
      return route.fulfill({ json: { ...universe, ...universeWrite.body } });
    }
    if (failUniverseDelete && p.startsWith("/api/v1/stock-universes/") && route.request().method() === "DELETE") return route.fulfill({ status: 500, json: { error: { code: "TEST_FAILURE", message: "Penghapusan fixture gagal." } } });
    if (p !== "/api" && !p.startsWith("/api/") && p !== "/ready") return route.continue();
    if (unauthorized && p === "/api/v1/account/me") return route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED", message: "Fixture session expired" } } });
    let payload;
    if (p === "/api" || p === "/ready") payload = { status: "ready", name: "Fixture API", version: "test" };
    else if (p === "/api/auth/me") payload = user;
    else if (p === "/api/v1/account/me") payload = { user, features: ["screener", "backtest"], session: { id: "fixture", expires_at: subscription.current_period_end }, device: { installation_id: "fixture", label: "Fixture browser", current: true }, capabilities_version: "fixture" };
    else if (p === "/api/v1/account/sessions") payload = { items: sessionFixtures };
    else if (p === "/api/v1/rules") payload = { items: [systemRule ? { ...rule, name: "Default Scalping", owner_type: "system", definition: undefined } : rule], next_cursor: null };
    else if (p === "/api/v1/stock-universes") payload = { items: [largeUniverse ? { ...universe, symbols: ["BBCA.JK", "BBRI.JK", "AADI.JK", "AALI.JK", "ABBA.JK", "ABDA.JK", "ABMM.JK", "ACES.JK", "ACRO.JK", "ACST.JK"] } : universe, ...(savedCardFixture ? [{ ...universe, id: "fixture-second-universe", name: "Banking watchlist" }, { ...universe, id: "fixture-third-universe", name: "Third universe", symbols: ["BBRI.JK"] }] : [])] };
    else if (p === "/api/v1/stocks") payload = { items: [...universe.symbols.map(symbol => ({ symbol, name: symbol, exchange: "XIDX", currency: "IDR" })), ...["AAPL", "JPM", "XOM", "PG", "PLD", "AGRO", "BBSI", "GOOD"].map(symbol => ({ symbol, name: symbol, exchange: "XNAS", currency: "USD" }))] };
    else if (p === "/api/v1/subscription") payload = { subscription };
    else if (p === "/api/v1/subscription/plans") payload = { items: plans };
    else if (p === "/api/v1/subscription/usage") payload = { limits: plans[2].limits, used: { custom_rules: 1, stock_universes: 1 } };
    else if (p === "/api/v1/workspace") payload = { items: [{ kind: "monitor-history", data: history, version: 1, updated_at: now }] };
    else if (p.startsWith("/api/v1/workspace/")) { const body = route.request().postDataJSON(); payload = { kind: p.split("/").at(-1), data: body.data, version: body.version + 1, updated_at: now }; }
    else if (p === "/api/news") payload = { articles: [{ title: "BBCA: berita fixture", url: "https://example.test/news", published_at: now }] };
    else payload = { items: [] };
    return route.fulfill({ json: payload });
  });
  await page.goto(`${origin}/#app/analysis`);
  await page.reload();
  await page.getByRole("button", { name: "Export CSV" }).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "BBCA", exact: true }).click({ timeout: 5000 });
  await page.getByRole("heading", { name: /Condition evidence/ }).waitFor({ timeout: 5000 });
  if (!await page.getByText("rule version 2", { exact: false }).count()) throw Error("Frozen evidence version missing");
  await page.getByRole("button", { name: "Close details" }).click({ timeout: 5000 });
  await page.getByText("Screening history (2)", { exact: true }).click({ timeout: 5000 });
  await page.getByLabel("Compare screening history", { exact: true }).waitFor({ timeout: 5000 });
  const comparison = await page.locator(".screener-comparison").innerText();
  if (!comparison.includes("BBCA") || !comparison.includes("BBRI")) throw Error("Run comparison missing");
  const download = page.waitForEvent("download", { timeout: 5000 });
  await page.getByRole("button", { name: "Export CSV" }).click({ timeout: 5000 });
  if ((await download).suggestedFilename() !== "signalgen-screening.csv") throw Error("CSV download failed");
  const journalKey = `signalgen:journal-drafts:${user.id}`;
  await page.evaluate(key => localStorage.setItem(key, "preserve-existing-drafts"), journalKey);
  await page.getByRole("button", { name: "Add to journal", exact: true }).first().click({ timeout: 5000 });
  await page.waitForURL('**/#app/journal');
  const journalVerification = page.getByRole('dialog',{name:'Verify screening details',exact:true});
  await journalVerification.waitFor();
  if (!(await journalVerification.innerText()).includes('BBCA') || await journalVerification.locator('tbody tr').count() !== 2) throw Error('Journal verification omitted captured condition evidence');
  const verificationTheme = await page.evaluate(()=>document.documentElement.dataset.theme);
  for (const width of [1440,390]) for (const theme of ['dark','light']) {
    await page.setViewportSize({width,height:1000});
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const box=await journalVerification.boundingBox();
    if (!box || box.x<0 || box.x+box.width>width+1) throw Error('Journal verification popup exceeds viewport');
    await page.screenshot({path:`/private/tmp/signalgen-journal-verification-${width}-${theme}.png`,animations:'disabled'});
  }
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,verificationTheme);
  await journalVerification.getByRole('button',{name:'Use in journal form',exact:true}).click();
  await page.getByRole("heading", { name: "Record a trade", exact: true }).waitFor({ timeout: 5000 });
  if (await page.locator(".journal-capture input").first().inputValue() !== "BBCA") throw Error("Screener did not prefill journal symbol");
  await page.getByRole('button',{name:'Close journal form',exact:true}).waitFor();
  if (await page.getByLabel('Entry price (IDR)',{exact:true}).inputValue() !== '100') throw Error('Journal price differs from screening snapshot');
  await page.getByText('Screening verified',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Close journal form',exact:true}).click();
  await page.getByRole('button',{name:'Open journal form',exact:true}).waitFor();
  await page.getByLabel('Month',{exact:true}).fill('2026-10');
  await page.getByText('No closed trades in this period',{exact:true}).waitFor();
  await page.getByText(/No recorded trades match these filters/).waitFor();
  await page.getByRole('button',{name:'Clear month filter',exact:true}).click();
  await page.getByText(/No recorded trades match these filters/).waitFor({state:'hidden'});
  if (await page.locator('.journal-ledger tbody tr').count() !== 4) throw Error('Clearing month did not restore table');
  const summaryText = await page.locator('.journal-performance__summary').innerText();
  if (!summaryText.includes('326,600') || !summaryText.includes('4 closed trades') || summaryText.includes('sample')) throw Error('Journal total does not match server records');
  if (!(await page.locator('.journal-pnl-chart svg').textContent()).includes('Cumulative P&L (IDR)')) throw Error('Chart axis labels missing');
  await page.getByRole('button',{name:'Open journal form',exact:true}).click();
  const saveBox=await page.getByRole('button',{name:'Save trade',exact:true}).boundingBox();
  const closeBox=await page.getByRole('button',{name:'Close form',exact:true}).boundingBox();
  if (!saveBox || !closeBox || Math.abs(saveBox.width-closeBox.width)>1 || Math.abs(saveBox.height-closeBox.height)>1) throw Error('Journal form actions differ in size');
  await page.getByLabel('Symbol',{exact:true}).fill('TEST');
  await page.getByLabel('Lot',{exact:true}).fill('1');
  await page.getByLabel('Entry price (IDR)',{exact:true}).fill('100');
  await page.getByLabel('Exit price (IDR, optional)',{exact:true}).fill('110');
  await page.getByLabel('Entry date',{exact:true}).fill('2026-09-18');
  await page.getByLabel('Exit date',{exact:true}).fill('2026-09-19');
  await page.getByLabel('Entry fee (IDR)',{exact:true}).fill('1');
  await page.getByLabel('Exit fee (IDR)',{exact:true}).fill('1');
  journalUnavailable=true;
  await page.getByRole('button',{name:'Save trade',exact:true}).click();
  await page.getByText('Journal unavailable',{exact:true}).waitFor();
  if(journalItems.length!==4||await page.getByLabel('Symbol',{exact:true}).inputValue()!=='TEST')throw Error('Failed save lost input or created a record');
  const retryID=journalWrites.at(-1).id;
  journalUnavailable=false;
  await page.getByRole('button',{name:'Save trade',exact:true}).click();
  await page.getByRole('button',{name:'Edit trade TEST',exact:true}).waitFor();
  if(journalWrites.at(-1).id!==retryID||journalItems.length!==5)throw Error('Retry changed trade ID or duplicated a record');
  if(!(await page.locator('.journal-performance__summary').innerText()).includes('327,598'))throw Error('Recorded trade did not update P&L');
  await page.getByRole('button',{name:'Edit trade TEST',exact:true}).click();
  await page.getByLabel('Exit price (IDR, optional)',{exact:true}).fill('');
  await page.getByLabel('Exit date',{exact:true}).fill('');
  await page.getByLabel('Exit fee (IDR)',{exact:true}).fill('0');
  await page.getByRole('button',{name:'Update trade',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.journal-performance__summary')?.textContent?.includes('326,600'));
  if(journalWrites.at(-1).body.version!==1||'net_pl' in journalWrites.at(-1).body.data)throw Error('Journal update supplied a computed P&L or lost its version');
  if(!(await page.locator('.journal-performance__summary').innerText()).includes('326,600'))throw Error('Open position was counted in realized P&L');
  await page.getByRole('button',{name:'Delete trade TEST',exact:true}).click();
  await page.getByRole('alertdialog',{name:'Delete recorded trade?',exact:true}).getByRole('button',{name:'Cancel',exact:true}).click();
  if(journalItems.length!==5)throw Error('Cancel deleted a trade');
  await page.getByRole('button',{name:'Delete trade TEST',exact:true}).click();
  await page.getByRole('alertdialog',{name:'Delete recorded trade?',exact:true}).getByRole('button',{name:'Delete trade',exact:true}).click();
  await page.getByRole('button',{name:'Edit trade TEST',exact:true}).waitFor({state:'hidden'});
  if(journalItems.length!==4)throw Error('Confirmed trade delete failed');
  await page.getByLabel('Currency',{exact:true}).selectOption('USD');
  if((await page.locator('.journal-performance__summary').innerText()).includes('326,600'))throw Error('Journal mixed IDR and USD');
  await page.getByLabel('Currency',{exact:true}).selectOption('IDR');
  if (await page.locator(".journal-drafts").count()) throw Error("Local draft workflow still visible");
  await page.reload();
  if (await page.evaluate(key => localStorage.getItem(key), journalKey) !== "preserve-existing-drafts") throw Error("Old drafts were overwritten");
  if (await page.locator(".journal-capture").count()) throw Error("Journal form was persisted");
  await page.route("**/api/v1/stock-universes", route => route.fulfill({ json: { items: [universe, { ...universe, id: "fixture-energy", name: "Energy selection", symbols: ["PTBA.JK"] }] } }));
  await page.goto(`${origin}/#app/realtime`);
  await page.getByLabel("Stock universe", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector("#monitor-universe")?.textContent.includes("Bank pilihan"));
  if (await page.locator(".monitor-strip button").count() !== 2) throw Error("Monitor ignored saved universe");
  await page.getByRole("button", { name: "Hide stock cards", exact: true }).click();
  if (!await page.locator(".monitor-strip").isHidden()) throw Error("Hide cards did not hide the lineup");
  await page.getByRole("button", { name: "Show stock cards", exact: true }).click();
  if (!await page.getByRole("button", { name: "Previous stock", exact: true }).isDisabled()) throw Error("Previous stock boundary must be disabled");
  await page.getByRole("button", { name: "Next stock", exact: true }).click();
  if (await page.locator(".monitor-detail-card h4").innerText() !== "BBRI") throw Error("Next stock did not update detail card");
  if (!await page.getByRole("button", { name: "Next stock", exact: true }).isDisabled()) throw Error("Next stock boundary must be disabled");
  await page.getByRole("button", { name: "Previous stock", exact: true }).click();
  await page.getByRole("button", { name: "Compare stocks", exact: true }).click();
  if (!await page.locator(".monitor-ledger").evaluate(el => el === document.activeElement)) throw Error("Compare action did not focus the table");
  await page.getByRole("button", { name: "Analyze stock", exact: true }).click();
  if (!await page.locator(".monitor-board").evaluate(el => el === document.activeElement)) throw Error("Analyze action did not focus the board");
  await page.locator(".monitor-strip button").filter({ hasText: "BBRI" }).click();
  if (await page.locator(".monitor-chart h3").innerText() !== "BBRI") throw Error("Stock card did not switch chart");
  if (!await page.locator('.monitor-ledger tr[data-state="selected"]').innerText().then(text => text.includes("BBRI"))) throw Error("Stock card did not select table row");
  if (await page.locator(".monitor-window-dots i").count() !== 3 || !await page.locator(".monitor-chart .tradingview-chart").count()) throw Error("TradingView Mac layout missing");
  await page.getByLabel("Stock universe", { exact: true }).click();
  await page.getByRole("option", { name: "Energy selection", exact: true }).click();
  if (await page.locator(".monitor-strip button").count() !== 1 || await page.locator(".monitor-chart h3").innerText() !== "PTBA") throw Error("Universe switch retained unrelated stocks");
  if (!await page.getByText("Not evaluated", { exact: true }).count()) throw Error("Missing snapshot must remain unevaluated");
  await page.getByLabel("Stock universe", { exact: true }).click();
  await page.getByRole("option", { name: "Bank pilihan", exact: true }).click();
  await page.getByLabel("Sort table", { exact: true }).click({ timeout: 5000 });
  await page.getByRole("option", { name: "Highest open-to-close change", exact: true }).click({ timeout: 5000 });
  if (!((await page.locator(".monitor-ledger tbody tr").first().innerText()).includes("BBRI"))) throw Error("Monitor change sort failed");
  if (await page.locator(".monitor-chart h3").innerText() !== "BBCA") throw Error("Sort changed selected chart");
  if (!((await page.locator(".monitor-change").first().innerText()).includes("%"))) throw Error("Missing open-close percentage");
  await page.getByRole("columnheader", { name: "Change", exact: true }).waitFor();
  if (await page.locator(".monitor-ledger .monitor-change").first().innerText() !== "+6.32%") throw Error("Monitor percentages must show a sign and two decimals");
  await page.unroute("**/api/v1/stock-universes");
  await page.goto(`${origin}/#app/access`);
  const ended = page.locator(".account-session-ledger article").filter({ hasText: "Ended browser" });
  await ended.waitFor();
  await page.getByRole("button", { name: "Delete history for Ended browser", exact: true }).click();
  await ended.waitFor({ state: "hidden" });
  await page.reload();
  await page.getByRole("button", { name: "Restore history", exact: true }).waitFor();
  if (await ended.count()) throw Error("Hidden history did not persist on this device");
  for (const name of ["Current browser", "Other active browser"]) {
    const active = page.locator(".account-session-ledger article").filter({ hasText: name });
    if (!await active.isVisible() || await active.getByRole("button", { name: /^Delete/ }).count()) throw Error("Active session was hidden or made deletable");
  }
  if (!await page.getByRole("button", { name: "Delete history", exact: true }).isDisabled()) throw Error("Delete history should disable when no ended records remain");
  await page.getByRole("button", { name: "Restore history", exact: true }).click();
  await ended.waitFor();
  await page.getByRole("button", { name: "Delete history", exact: true }).click();
  await ended.waitFor({ state: "hidden" });
  if (sessionMutations) throw Error("Display-only history deletion mutated backend sessions");
  await page.getByRole("button", { name: "Restore history", exact: true }).click();
  const routes = ["overview", "analysis", "rules", "universes", "journal", "realtime", "news", "access", "subscription", "operator"];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (let theme = 0; theme < 2; theme++) {
      for (const view of routes) {
        await page.goto(`${origin}/#app/${view}`);
        await page.locator(".demo-workbench").waitFor({ timeout: 10000 });
        await page.locator(".route-loading").waitFor({ state: "hidden", timeout: 10000 });
        await page.evaluate(() => Promise.all([
          document.fonts.load('14px "Saira Variable"'),
          document.fonts.load('600 28px "Saira Condensed"'),
          document.fonts.load('500 14px "Saira Condensed"'),
          document.fonts.load('13px "Geist Mono Variable"'),
        ]));
        if (errors.length) throw Error(`Route ${view}: ${errors.join('; ')}`);
        const typography = await page.evaluate(() => ({
          body: getComputedStyle(document.body).fontFamily,
          nav: getComputedStyle(document.querySelector(".nav-group button")).fontFamily,
          heading: getComputedStyle(document.querySelector(".workspace h1, .workspace h2")).fontFamily,
          loaded: document.fonts.check('14px "Saira Variable"') && document.fonts.check('500 14px "Saira Condensed"') && document.fonts.check('600 28px "Saira Condensed"'),
        }));
        if (!typography.body.includes("Saira Variable") || !typography.nav.includes("Saira Condensed") || !typography.heading.includes("Saira Condensed") || !typography.loaded) throw Error(`Workspace fonts missing: ${view} ${JSON.stringify(typography)}`);
        const close = page.getByRole("button", { name: "Close menu" });
        const bounds = await close.boundingBox();
        if (bounds && bounds.x >= 0 && bounds.x + bounds.width <= width) await close.click({ timeout: 5000 });
        const surfaceSelector = {
          overview: ".overview-launch", analysis: ".screener-console", rules: ".rule-composer",
          universes: ".stock-catalog-picker__catalog", journal: ".journal-toolbar", realtime: ".monitor-chart",
          news: ".news-feed", access: ".panel", subscription: ".subscription-current", operator: ".admin-console, .admin-account, .workspace-empty-state",
        }[view];
        await page.locator(surfaceSelector).first().waitFor({ timeout: 10000 });
        if (!await page.locator(surfaceSelector).first().evaluate(el => getComputedStyle(el).backgroundImage.includes("gradient"))) throw Error(`Missing shared card gradient: ${view} ${width} ${theme}`);
        const surfaceContrast = await page.locator(".workspace").evaluate(host => {
          if (!getComputedStyle(host).backgroundImage.includes("gradient")) throw Error("Workspace background is not graded");
          const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
          const ctx = canvas.getContext("2d");
          const probe = document.createElement("span"); probe.style.transition = "none"; host.append(probe);
          const palette = [];
          const rgb = value => {
            probe.style.backgroundColor = value;
            ctx.fillStyle = getComputedStyle(probe).backgroundColor;
            ctx.fillRect(0, 0, 1, 1);
            const color = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
            palette.push([value, getComputedStyle(probe).backgroundColor, color]);
            return color;
          };
          const luminance = channels => channels.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
          const backgrounds = ["var(--canvas)", "var(--surface)", "color-mix(in srgb, var(--surface-3) 65%, var(--surface))", "color-mix(in srgb, var(--green-deep) 9%, var(--surface))"].map(value => luminance(rgb(value)));
          const contrasts = ["var(--text)", "var(--muted)"].flatMap(value => { const l = luminance(rgb(value)); return backgrounds.map(bg => (Math.max(l, bg) + .05) / (Math.min(l, bg) + .05)); });
          probe.remove();
          return { min: Math.min(...contrasts), palette };
        });
        if (surfaceContrast.min < 4.5) throw Error(`Shared surface text contrast below AA: ${JSON.stringify(surfaceContrast)}`);
        await page.screenshot({ path: `/private/tmp/signalgen-${view}-${width}-${theme}.png`, animations: "disabled", timeout: 10000 });
        if (view === "realtime") {
          if (!await page.locator('.monitor-ledger table th, .monitor-ledger table td').evaluateAll(items=>items.length>0 && items.every(el=>getComputedStyle(el).textAlign==='center'))) throw Error('Every monitor table header and cell must be centered');
          if (!await page.locator('.monitor-ledger .monitor-result').evaluateAll(items=>items.every(el=>getComputedStyle(el).justifyItems==='center'))) throw Error('Monitor result badges must be centered');
          if (!await page.locator(".monitor-change").first().evaluate(el => getComputedStyle(el).fontFamily.includes("Geist Mono Variable") && document.fonts.check('13px "Geist Mono Variable"'))) throw Error("Market numbers must use loaded Geist Mono");
          const geometry = await page.locator(".monitor-board-grid").evaluate(el => {
            const chart = el.querySelector(".monitor-chart").getBoundingClientRect();
            const detail = el.querySelector(".monitor-stock-detail").getBoundingClientRect();
            const card = el.querySelector(".monitor-detail-card").getBoundingClientRect();
            return { sideBySide: detail.x >= chart.right, below: detail.top >= chart.bottom, topOffset: Math.abs(chart.top - card.top), bottomOffset: Math.abs(chart.bottom - card.bottom) };
          });
          if (width === 1440 && (!geometry.sideBySide || geometry.topOffset > 1 || geometry.bottomOffset > 1)) throw Error(`Chart and detail card edges must align: ${JSON.stringify(geometry)}`);
          if (width === 390 && !geometry.below) throw Error("Stock card must stack below chart on mobile");
          await page.locator(".monitor-ledger").screenshot({ path: `/private/tmp/signalgen-monitor-table-${width}-${theme}.png`, animations: "disabled", timeout: 10000 });
          if (!await page.locator('.monitor-ledger time').evaluateAll(items => items.length > 0 && items.every(el => el.textContent.includes('Asia/Jakarta')))) throw Error('Monitor candle dates are not labeled with the snapshot market timezone');
          await page.locator(".market-monitor").screenshot({ path: `/private/tmp/signalgen-monitor-lineup-${width}-${theme}.png`, animations: "disabled", timeout: 10000 });
        }
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error(`Overflow: ${view} ${width}`);
        if (view === "analysis") {
          const matchMode = page.locator('.screener-run-summary__title .screener-match-mode');
          if (await matchMode.innerText() !== 'Match all 2 conditions' || !await matchMode.evaluate(el=>el.previousElementSibling.textContent==='BUY')) throw Error('Match mode must be a card next to the signal badge');
          if (await page.locator('.screener-criteria > p').count()) throw Error('Match mode remains below the signal badges');
          const operators = await page.locator('.screener-criteria .rule-operator-symbol').allTextContents();
          if (operators.join(',')!=='>,>') throw Error(`Screening conditions omit the Rules comparison symbols: ${operators}`);
          await page.locator('.screener-run-summary').screenshot({path:`/private/tmp/signalgen-criteria-${width}-${theme}.png`,animations:'disabled'});
          const controlGeometry = await page.locator('.screener-monitor-status').evaluate(el => {
            const start = el.querySelector('.screener-run-summary__action'), times = el.querySelector('.screener-monitor-status__times');
            return {left: el.querySelector('.screener-monitor-status__icon').getBoundingClientRect().left, expected: document.querySelector('.screener-pickers').getBoundingClientRect().left + parseFloat(getComputedStyle(document.querySelector('.screener-pickers')).paddingLeft), start: start.getBoundingClientRect().left, times: times.getBoundingClientRect().right};
          });
          if (Math.abs(controlGeometry.left - controlGeometry.expected) > 1) throw Error('Monitor status padding is not aligned');
          if (width === 1440 && controlGeometry.start < controlGeometry.times) throw Error('Start/Stop must be right of check times');
          const actions = await page.locator('.screener-result-actions > button').evaluateAll(items => items.map(el => el.getBoundingClientRect().height));
          if (actions.length !== 2 || Math.abs(actions[0] - actions[1]) > 1) throw Error('Quality and CSV buttons do not align');
          const offset = await page.evaluate(() => {
            const note = document.querySelector(".screener-result-count");
            const label = document.querySelector(".screener-result-filters label");
            if (!note || !label) return 0;
            const range = document.createRange(); range.selectNodeContents(note);
            return Math.abs(range.getBoundingClientRect().x - label.getBoundingClientRect().x);
          });
          if (offset > 2) throw Error(`Misaligned screener explanation: ${offset}px`);
          if (await page.locator(".screener-results .screener-technical").count()) throw Error("Technical card still nested in results");
          const technical = page.locator(".screener-workspace > .screener-technical");
          await technical.locator("summary").filter({hasText:"Data information"}).waitFor({ timeout: 5000 });
          if (!await technical.evaluate(el => el instanceof HTMLDetailsElement)) throw Error("Data information must be a dropdown");
          if (!await technical.evaluate(el => el.open)) await technical.locator("summary").click();
          const layout = await technical.evaluate(el => ({ radius: parseFloat(getComputedStyle(el).borderTopLeftRadius), text: parseFloat(getComputedStyle(el.querySelector(".dataset-provenance strong")).fontSize), left: el.getBoundingClientRect().left - document.querySelector(".screener-results").getBoundingClientRect().left }));
          if (layout.text > 14 || Math.abs(layout.left) > 1) throw Error(`Technical dropdown layout incorrect: ${JSON.stringify(layout)}`);
          await technical.screenshot({ path: `/private/tmp/signalgen-technical-${width}-${theme}.png`, animations: "disabled", timeout: 10000 });
          await technical.locator("summary").click();
          await page.getByRole("button", { name: "BBCA", exact: true }).click({ timeout: 5000 });
          const detail = page.locator(".stock-detail");
          await detail.getByRole("heading", { name: /Condition evidence/ }).waitFor({ timeout: 5000 });
          if (await detail.locator(".stock-detail__values > div").count() !== 5) throw Error("Indicator cards missing");
          if (/Perbandingan angka dihitung di browser|Numeric comparisons are calculated in the browser/.test(await detail.innerText())) throw Error("Server calculation explanation remains");
          const card = await detail.locator(".stock-detail__evidence li").first().evaluate(el => ({ radius: parseFloat(getComputedStyle(el).borderTopLeftRadius), padding: parseFloat(getComputedStyle(el).paddingLeft) }));
          if (card.radius < 12 || card.padding < 16) throw Error("Condition card styling missing");
          await detail.screenshot({ path: `/private/tmp/signalgen-stock-detail-${width}-${theme}.png`, animations: "disabled", timeout: 10000 });
          if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error("Stock detail overflows page");
          await page.getByRole("button", { name: "Close details", exact: true }).click({ timeout: 5000 });
        }
        if (view === "overview") {
          await page.getByRole("heading", { name: "Follow the market", exact: true }).waitFor({ timeout: 5000 });
          const box = await page.locator(".overview-launch").evaluate(el => ({ radius: parseFloat(getComputedStyle(el).borderTopLeftRadius), background: getComputedStyle(el).backgroundImage }));
          if (box.radius < 24 || !box.background.includes("linear-gradient")) throw Error("Dashboard rounded gradient box missing");
          await page.locator(".overview-launch").screenshot({ path: `/private/tmp/signalgen-dashboard-gradient-${width}-${theme}.png`, animations: "disabled", timeout: 10000 });
          const alignment = await page.evaluate(() => {
            const title = document.querySelector(".overview-next h3").getBoundingClientRect();
            const history = document.querySelector(".overview-activity header h3").getBoundingClientRect();
            const row = document.querySelector(".overview-activity li > div").getBoundingClientRect();
            return Math.max(Math.abs(title.x - history.x), Math.abs(history.x - row.x));
          });
          if (alignment > 2) throw Error(`Dashboard gutters inconsistent: ${alignment}px`);
          if (await page.locator('.overview-selection').count()) throw Error('Rule and universe selection must not clutter dashboard hero');
          const launchButton = await page.locator('.overview-next .overview-open-screener').evaluate(el => {
            const css=getComputedStyle(el); return {height:el.getBoundingClientRect().height,font:parseFloat(css.fontSize),glass:css.backdropFilter,background:css.backgroundImage};
          });
          if (launchButton.height<52 || launchButton.font<20 || !launchButton.glass.includes('blur') || !launchButton.background.includes('linear-gradient')) throw Error(`Large green glass screener action missing: ${JSON.stringify(launchButton)}`);
          const resources = page.getByRole('region', {name:'Workspace overview',exact:true});
          const icons = await resources.locator('.overview-resources__icon > svg').evaluateAll(items => items.map(el => el.getAttribute('class')));
          if (icons.length !== 4 || new Set(icons).size !== 4 || !['list-checks','boxes','crown','user-round'].every((name,i)=>icons[i].includes(`lucide-${name}`))) throw Error(`Dashboard icons must be distinct and match each resource: ${icons}`);
          const resourceSizes = await resources.locator('.feature-gallery__item').evaluateAll(items => items.map(el => ({height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width})));
          if (resourceSizes.some(size=>size.height>280 || size.height<200 || Math.abs(size.height-resourceSizes[0].height)>1)) throw Error(`Dashboard cards are not compact and equal: ${JSON.stringify(resourceSizes)}`);
          if (!await resources.locator('.feature-gallery__copy').evaluateAll(items=>items.every(el=>getComputedStyle(el).textAlign==='center' && getComputedStyle(el).justifyItems==='center'))) throw Error('Overview resource copy must be centered');
          if (width===390 && await resources.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)!==2) throw Error('Compact mobile resources must use two columns');
          const destinations = await resources.locator('a').evaluateAll(links => links.map(link=>link.getAttribute('href')));
          if (destinations.join(',') !== '#app/rules,#app/universes,#app/subscription,#app/access') throw Error('Dashboard resource navigation changed');
          const values = await resources.locator('.overview-resources__value').allTextContents();
          if (values.join(',') !== '1,1,Pro,Active') throw Error(`Dashboard resource values differ from account data: ${values}`);
          const chips = await page.locator('.overview-activity li').first().locator('.overview-run-chip').evaluateAll(items => items.map(el => {
            const rect=el.getBoundingClientRect(), style=getComputedStyle(el);
            return {width:rect.width,height:rect.height,radius:style.borderRadius,padding:style.padding,overflow:el.scrollWidth>el.clientWidth+1};
          }));
          if (chips.length !== 4 || chips.some(chip=>chip.width!==chips[0].width || chip.height!==chips[0].height || chip.radius!==chips[0].radius || chip.padding!==chips[0].padding || chip.overflow)) throw Error(`Recent screening pills must match: ${JSON.stringify(chips)}`);
          if (await page.locator('.overview-run-meta time[datetime]').count() !== 2) throw Error('Screening date semantics lost');
          await resources.screenshot({path:`/private/tmp/signalgen-overview-resources-${width}-${theme}.png`,animations:'disabled'});
          await page.locator('.overview-activity').screenshot({path:`/private/tmp/signalgen-overview-recent-${width}-${theme}.png`,animations:'disabled'});
          const overviewPanel = await resources.locator('.feature-gallery__item').first().evaluate(el => {
            const css=getComputedStyle(el);
            return {background:css.backgroundImage,size:css.backgroundSize,radius:css.borderRadius};
          });
          await page.goto(`${origin}/#home`);
          const landingCard=page.locator('#capabilities .feature-gallery__item').first();
          await landingCard.waitFor();
          const landingPanel = await landingCard.evaluate(el => {
            const css=getComputedStyle(el);
            return {background:css.backgroundImage,size:css.backgroundSize,radius:css.borderRadius};
          });
          if (JSON.stringify(overviewPanel)!==JSON.stringify(landingPanel)) throw Error(`Dashboard panel differs from landing: ${JSON.stringify({overviewPanel,landingPanel})}`);
          if (width===1440) await landingCard.screenshot({path:`/private/tmp/signalgen-landing-panel-${theme}.png`,animations:'disabled'});
          await page.goto(`${origin}/#app/overview`);
          await page.locator('.overview-resources').waitFor();
          await page.locator('.overview-activity').getByRole('button',{name:'Use selection',exact:true}).first().click();
          await page.waitForURL('**/#app/analysis');
          await page.goto(`${origin}/#app/overview`);
          await page.locator('.overview-resources').waitFor();
        }
        if (view === "rules") {
          const filters = await page.locator('.rule-library__filters').evaluate(el => {
            const search = el.querySelector('input').getBoundingClientRect();
            const buttons = [...el.querySelectorAll('[data-signal]')].map(item => item.getBoundingClientRect().height);
            return { height: search.height, buttons, misplacedCount: Boolean(el.querySelector('[role="status"]')) };
          });
          if (filters.buttons.some(height => Math.abs(height - filters.height) > 1) || filters.misplacedCount) throw Error(`Rule filters must match the search height with count moved beside Your rules: ${JSON.stringify(filters)}`);
          if (!(await page.locator('.rule-library__list-heading [role="status"]').innerText()).includes('[')) throw Error('Bracketed rule count missing');
          const refresh = page.locator(".rule-library").getByRole("button", { name: "Refresh", exact: true });
          if (!(await refresh.getAttribute("class")).split(" ").includes("bg-primary")) throw Error("Rules refresh not primary");
          if (await page.locator(".rule-library__rows").getByText("v2", { exact: true }).count()) throw Error("Rule version badge still visible");
          const offset = await page.evaluate(() => {
            const header = document.querySelector(".rule-composer__header"), form = document.querySelector(".rule-composer__form");
            return Math.abs(parseFloat(getComputedStyle(header).paddingLeft) - parseFloat(getComputedStyle(form).paddingLeft));
          });
          if (offset > 1) throw Error(`Rule header/form gutters differ: ${offset}px`);
        }
        if (view === "universes") {
          await page.getByRole("heading", { name: "Your stock universes", exact: true }).waitFor({ timeout: 5000 });
          await page.getByRole("table", { name: "Stock catalog", exact: true }).waitFor({ timeout: 5000 });
          const categories = page.getByRole("group", { name: "Stock categories", exact: true });
          for (const name of ["All stocks", "Blue chip", "Banks", "Energy", "Consumer", "Property", "Technology"]) {
            await categories.getByRole("button", { name, exact: true }).waitFor({ timeout: 5000 });
          }
          const layout = await page.locator(".universe-workspace").evaluate(el => {
            const editor = el.querySelector(".universe-editor"), library = el.querySelector(".universe-library");
            const a = editor.getBoundingClientRect(), b = library.getBoundingClientRect();
            const browse = editor.querySelector('.stock-catalog-picker__browse').getBoundingClientRect();
            const selected = editor.querySelector('.universe-selection').getBoundingClientRect();
            if (innerWidth > 1100 && Math.abs(editor.querySelector('.stock-catalog-picker__current').getBoundingClientRect().top - editor.querySelector('.universe-selection h4').getBoundingClientRect().top) > 1) throw Error('Search and selected card headings are not aligned');
            const catalog = editor.querySelector('.stock-catalog-picker__table').getBoundingClientRect();
            const catalogCard = editor.querySelector('.stock-catalog-picker__catalog').getBoundingClientRect();
            const title = editor.querySelector('h3').getBoundingClientRect();
            const savedTitle = library.querySelector('h3').getBoundingClientRect();
            const row = library.querySelector('article').getBoundingClientRect();
            const alignment = Math.max(Math.abs(savedTitle.left - row.left), Math.abs(savedTitle.left - title.left));
            const chips = library.querySelector(".universe-library__symbols");
            return { gap: b.top - a.bottom, left: Math.abs(a.left - b.left), right: Math.abs(a.right - b.right), alignment, belowGroups: Math.min(selected.top, browse.top) - catalogCard.bottom, sideBySide: Math.abs(selected.top - browse.top) < 1 && selected.left > browse.right, stacked: selected.top > browse.bottom, tableInset: browse.width - catalog.width, wrap: chips && getComputedStyle(chips).flexWrap };
          });
          if (layout.gap < 16 || layout.left > 1 || layout.right > 1) throw Error(`Universe cards are not stacked/aligned: ${JSON.stringify(layout)}`);
          if (layout.alignment > 1) throw Error(`Universe content edges differ: ${JSON.stringify(layout)}`);
          if (layout.belowGroups < 16 || layout.tableInset > 50 || !(width > 1100 ? layout.sideBySide : layout.stacked)) throw Error(`Universe groups/search/selection layout incorrect: ${JSON.stringify(layout)}`);
          await page.locator('.universe-selection').screenshot({ path: `/private/tmp/signalgen-selected-stacked-${width}-${theme}.png`, animations: "disabled" });
          const marketContained = await page.locator('.universe-market-field').evaluate(el => {
            const outer = el.closest('.stock-catalog-picker__catalog').getBoundingClientRect();
            return [...el.children].every(child => { const r = child.getBoundingClientRect(); return r.left >= outer.left + 15 && r.right <= outer.right - 15; });
          });
          if (!marketContained) throw Error('Market description escapes the category card padding');
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({ path: `/private/tmp/signalgen-universe-layout-${width}-${theme}.png`, fullPage: true, animations: "disabled" });
          if (layout.wrap !== "wrap") throw Error("Saved universe stocks cannot wrap");
          if (await page.locator('.universe-window-bar .news-window-dots i').count() !== 3) throw Error("Mac window controls missing");
          if (await categories.locator('button svg').count() !== 7) throw Error("Category icons missing");
          const selectionStyle = await page.locator('.universe-selection__card').evaluate(el=>({radius:parseFloat(getComputedStyle(el).borderTopLeftRadius),padding:parseFloat(getComputedStyle(el.querySelector('[data-slot="card-content"]')).paddingLeft)}));
          if(selectionStyle.radius < 12 || selectionStyle.padding < 16) throw Error("Selected stocks card missing inset spacing");
          if(!(await page.locator('.stock-catalog-picker__table').evaluate(el=>getComputedStyle(el).backgroundImage)).includes('linear-gradient')) throw Error("Stock table gradient missing");
          if(await page.locator('.stock-catalog-picker__table [data-slot="table-container"]').evaluate(el=>el.scrollHeight > el.clientHeight + 1)) throw Error("Catalog rows are vertically clipped");
          if(await page.locator('.universe-selection__empty').evaluate(el=>parseFloat(getComputedStyle(el).minHeight) > 0)) throw Error("Empty selection still reserves blank space");
          if (await page.locator(".universe-library").getByText(/^v\d+$/).count()) throw Error("Universe version badge still visible");
        }
        if (view === "journal") {
          if (await page.getByText("Static preview", { exact: true }).count()) throw Error("Journal preview label remains");
          const controlAlignment = await page.locator(".journal-toolbar").evaluate(el => {
            const controls = [...el.querySelectorAll("select, .journal-date, button")].map(control => control.getBoundingClientRect());
            return { sizes: controls.map(c => c.height), heights: Math.max(...controls.map(c => c.height)) - Math.min(...controls.map(c => c.height)), bottoms: Math.max(...controls.map(c => c.bottom)) - Math.min(...controls.map(c => c.bottom)) };
          });
          if (controlAlignment.heights > 2 || (width >= 1440 && controlAlignment.bottoms > 2)) throw Error(`Journal controls misaligned: ${JSON.stringify(controlAlignment)}`);
          await page.locator(".journal-toolbar").screenshot({ path: `/private/tmp/signalgen-journal-toolbar-${width}-${theme}.png`, animations: "disabled", timeout: 10000 });
          await page.locator(".journal-ledger").screenshot({ path: `/private/tmp/signalgen-journal-records-${width}-${theme}.png`, animations: "disabled", timeout: 10000 });
          if(await page.locator('.journal-ledger tbody tr').count()!==4)throw Error('Journal did not restore server records');
        }
        if (view === "realtime") {
          const offset = await page.evaluate(() => {
            const footer = document.querySelector(".monitor-ledger footer");
            const title = document.querySelector(".monitor-ledger header h3");
            const range = document.createRange(); range.selectNodeContents(footer);
            return Math.abs(range.getClientRects()[0].x - title.getBoundingClientRect().x);
          });
          if (offset > 2) throw Error(`Misaligned monitor explanation: ${offset}px`);
        }
        if (await page.getByText("This page could not be loaded", { exact: false }).count()) throw Error(`Route boundary: ${view}`);
        if (await page.getByText(/^(Tersimpan di akun|Saved to your account)$/).count()) throw Error("Saved-account status still visible");
      }
      await page.getByRole("button", { name: /Switch to .* mode/ }).click({ timeout: 5000 });
    }
    await page.getByRole("button", { name: "Open workspace menu", exact: true }).click({ timeout: 5000 });
    await page.getByRole("button", { name: "Rules", exact: true }).click({ timeout: 5000 });
    if (width <= 860) {
      await page.waitForFunction(()=>document.querySelector('.menu-button')?.getAttribute('aria-expanded')==='false');
      await page.getByRole("button", { name: "Open workspace menu", exact: true }).click({ timeout: 5000 });
    }
    const stillOpen = await page.getByRole("button", { name: "Close menu", exact: true }).boundingBox();
    if (!stillOpen || stillOpen.x < 0) throw Error(`Navigation collapsed sidebar at ${width}`);
    await page.getByRole("button", { name: "Close menu", exact: true }).click({ timeout: 5000 });
  }
  await page.goto(`${origin}/#account`);
  await page.locator("main").waitFor({ timeout: 10000 });
  await page.screenshot({ path: "/private/tmp/signalgen-account.png", animations: "disabled", timeout: 10000 });
  await page.goto(`${origin}/#app/universes`);
  await page.getByRole("button", { name: "Edit Bank pilihan", exact: true }).click({ timeout: 5000 });
  if(await page.locator('.universe-selection__stocks li').count() !== 2) throw Error("Selected stock cards missing");
  const stockCard = await page.locator('.universe-selection__stocks li').first().evaluate(el=>({radius:parseFloat(getComputedStyle(el).borderTopLeftRadius),padding:parseFloat(getComputedStyle(el).paddingLeft)}));
  if(stockCard.radius < 8 || stockCard.padding < 12) throw Error("Selected stock item card spacing missing");
  if (await page.getByLabel("Universe name", {exact:true}).inputValue() !== "Bank pilihan") throw Error("Universe edit did not preserve its name");
  await page.getByLabel("Universe name", {exact:true}).fill("Bank pilihan edited");
  await page.getByRole("button", { name: "Save changes", exact:true }).click({ timeout: 5000 });
  await page.getByRole("button", { name: "Create universe", exact:true }).waitFor({ timeout: 5000 });
  if (!universeWrite || universeWrite.method !== "PATCH" || universeWrite.body.version !== 1 || universeWrite.body.name !== "Bank pilihan edited" || universeWrite.body.symbols.join(",") !== "BBCA.JK,BBRI.JK") throw Error("Universe update payload changed");
  await page.getByRole("button", { name: /Add BBCA/ }).click({ timeout: 5000 });
  await page.getByLabel("Universe name", {exact:true}).fill("New fixture group");
  await page.getByRole("button", { name: "Create universe", exact:true }).click({ timeout: 5000 });
  await page.getByRole("button", { name: /Add BBCA/ }).waitFor({ timeout: 5000 });
  if (!universeWrite || universeWrite.method !== "POST" || universeWrite.body.name !== "New fixture group" || universeWrite.body.symbols.join(",") !== "BBCA.JK") throw Error("Universe create payload changed");
  // Start toast placement checks without lingering create/update notifications.
  await page.reload();
  await page.getByRole("button", { name: "Delete Bank pilihan", exact: true }).waitFor({ timeout: 5000 });
  await page.evaluate(() => { window.confirm = () => true; });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (let theme = 0; theme < 2; theme++) {
      for (const failure of [false, true]) {
        await page.mouse.move(1, 900);
        failUniverseDelete = failure;
        await page.getByRole("button", { name: "Delete Bank pilihan", exact: true }).click({ timeout: 5000 });
        const latestToast = page.locator(`.notification-toast[data-type=${failure ? "error" : "success"}]`).last();
        await latestToast.waitFor({ state: "visible", timeout: 5000 });
        // Pin this toast: after dismissal .last() can resolve an older save toast.
        const toastLabel = await latestToast.getAttribute("aria-labelledby");
        const toast = page.locator(`.notification-toast[aria-labelledby="${toastLabel}"]`);
        await toast.hover({ timeout: 5000 });
        const bounds = await page.locator(".notification-viewport").boundingBox();
        if (!bounds || bounds.y > 24 || Math.abs(width - bounds.x - bounds.width - 16) > 2) throw Error("Notification not top-right");
        // Reduced motion is already active; fast-forwarding transitions can dismiss Base UI toasts.
        await toast.screenshot({ path: `/private/tmp/signalgen-toast-${width}-${theme}-${failure}.png`, timeout: 10000 });
        // Base UI announces the toast through its live region and hides the
        // visual copy from AT until the viewport is keyboard-focused.
        const closeToast = toast.getByRole("button", { name: "Dismiss notification", exact: true, includeHidden: true });
        await closeToast.click({ timeout: 5000 });
        await toast.waitFor({ state: "detached", timeout: 5000 });
      }
      await page.getByRole("button", { name: /Switch to .* mode/ }).click({ timeout: 5000 });
    }
  }
  failUniverseDelete = false;
  systemRule = true;
  await page.goto(`${origin}/#app/analysis`);
  await page.getByText("System rule conditions are checked automatically.", { exact: true }).waitFor({ timeout: 10000 });
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (let theme = 0; theme < 2; theme++) {
      await page.locator(".screener-run-summary").screenshot({ path: `/private/tmp/signalgen-summary-${width}-${theme}.png`, animations: "disabled", timeout: 10000 });
      if (width >= 900) {
        const difference = await page.locator(".screener-run-summary").evaluate(el => { const title = el.querySelector("strong").getBoundingClientRect(), badge = el.querySelector('[data-slot="badge"]').getBoundingClientRect(); return Math.abs(title.y + title.height / 2 - badge.y - badge.height / 2); });
        if (difference > 2) throw Error(`Misaligned screener title/action: ${difference}px`);
      }
      await page.getByRole("button", { name: /Switch to .* mode/ }).click({ timeout: 5000 });
    }
  }
  await page.goto(`${origin}/#app/subscription`);
  await page.getByRole("heading", { name: "Quota usage", exact: true }).waitFor({ timeout: 10000 });
  const backtest = page.locator('.subscription-feature-grid [data-slot="card"]').filter({ hasText: "Backtest access" });
  if (!(await backtest.innerText()).includes("Active") || (await backtest.innerText()).includes("not available yet")) throw Error("Active backtest plan still presented as unavailable");
  const activePeriodEnd = subscription.current_period_end;
  subscription.current_period_end = "2000-01-01T00:00:00Z";
  await page.reload();
  await page.getByRole("heading", { name: "Quota usage", exact: true }).waitFor({ timeout: 10000 });
  if (!(await backtest.innerText()).includes("Not included")) throw Error("Expired plan presents backtest access as active");
  subscription.current_period_end = activePeriodEnd;
  await page.reload();
  await page.getByRole("heading", { name: "Quota usage", exact: true }).waitFor({ timeout: 10000 });
  if (!(await backtest.innerText()).includes("Active")) throw Error("Active plan did not recover after expiry test");
  const manage = page.locator(".subscription-manage--account");
  await manage.locator("summary").click({ timeout: 5000 });
  if (!await manage.getByRole("button", { name: "Cancel now", exact: true }).isVisible()) throw Error("Manage disclosure does not reveal controls");
  await manage.locator("summary").click({ timeout: 5000 });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (let theme = 0; theme < 2; theme++) {
      const question = page.getByRole("button", { name: "What happens when my plan changes?", exact: true });
      if (await question.getAttribute("aria-expanded") !== "false") throw Error("Package FAQ should start collapsed");
      await question.focus();
      const type = await question.evaluate(el => ({ tracking: parseFloat(getComputedStyle(el).letterSpacing) || 0, weight: Number(getComputedStyle(el).fontWeight), shadow: getComputedStyle(el).boxShadow, headerMargin: getComputedStyle(el.parentElement).marginBottom }));
      if (type.tracking !== 0 || type.weight > 600 || type.shadow !== "none" || type.headerMargin !== "0px") throw Error(`Package FAQ inherited display styling: ${JSON.stringify(type)}`);
      await page.locator(".subscription-faq").screenshot({ path: `/private/tmp/signalgen-package-faq-closed-${width}-${theme}.png`, animations: "disabled", timeout: 10000 });
      await question.click({ timeout: 5000 });
      await page.locator(".subscription-faq [data-slot=accordion-content]").waitFor({ state: "visible", timeout: 5000 });
      await page.locator(".subscription-faq").screenshot({ path: `/private/tmp/signalgen-package-faq-${width}-${theme}.png`, animations: "disabled", timeout: 10000 });
      await question.click({ timeout: 5000 });
      if (await page.getByText(/Analyst dan Pro memakai fitur screening|Analyst and Pro use the same screening features/).count()) throw Error("Removed package explanation remains");
      await page.locator(".subscription-current").screenshot({ path: `/private/tmp/signalgen-access-${width}-${theme}.png`, animations: "disabled", timeout: 10000 });
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error("Subscription overflow");
      const inset = await page.locator(".subscription-current").evaluate(el => {
        const outer = el.getBoundingClientRect(), inner = el.querySelector(".subscription-ledger__lead").getBoundingClientRect();
        return { left: inner.left - outer.left, right: outer.right - inner.right, radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) };
      });
      if (inset.left < 16 || inset.right < 16 || inset.radius < 12) throw Error("Subscription cards lack rounded inset container");
      const planAlignment = await page.locator('.plan-ledger').evaluate(el => {
        const outer = el.getBoundingClientRect();
        const header = el.querySelector(':scope > header').getBoundingClientRect();
        const title = el.querySelector('#plan-heading').getBoundingClientRect();
        const columns = el.querySelector('.plan-columns').getBoundingClientRect();
        const faq = el.querySelector('.subscription-faq').getBoundingClientRect();
        return { inset: columns.left - outer.left, edges: Math.max(Math.abs(header.left - columns.left), Math.abs(title.left - columns.left), Math.abs(columns.left - faq.left), Math.abs(columns.right - faq.right)) };
      });
      if (planAlignment.inset < 16 || planAlignment.edges > 1) throw Error(`Plan heading, cards and FAQ gutters differ: ${JSON.stringify(planAlignment)}`);
      await page.locator('.plan-ledger').screenshot({ path: `/private/tmp/signalgen-plan-alignment-${width}-${theme}.png`, animations: "disabled", timeout: 10000 });
      await page.getByRole("button", { name: /Switch to .* mode/ }).click({ timeout: 5000 });
    }
  }
  unauthorized = true;
  await page.goto(`${origin}/#app/analysis`);
  await page.waitForURL("**/#login", { timeout: 10000 });
  if (await page.evaluate(() => sessionStorage.getItem("signalgen.access-token"))) throw Error("401 retained auth");
  for (const route of ["home", "creators", "login", "register", "forgot-password", "reset-password"]) {
    await page.goto(`${origin}/#${route}`);
    await page.locator("main").waitFor({ timeout: 10000 });
    await page.locator(".route-loading").waitFor({ state: "hidden", timeout: 10000 });
    await page.waitForFunction(expected => document.documentElement.dataset.typography === expected, route === "home" ? "landing" : "workspace");
    const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    if (!family.includes(route === "home" ? "Manrope Variable" : "Saira Variable")) throw Error(`Public route font mismatch: ${route} ${family}`);
    if (await page.locator(".auth-layout").count() && !await page.locator(".auth-layout").evaluate(el => getComputedStyle(el).backgroundImage.includes("gradient"))) throw Error(`Auth surface gradient missing: ${route}`);
    await page.screenshot({ path: `/private/tmp/signalgen-public-${route}.png`, animations: "disabled", timeout: 10000 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error(`Public page overflow: ${route}`);
  }
  unauthorized = false;
  systemRule = false;
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/#app/rules`);
  await page.getByRole("button", { name: "New blank rule", exact: true }).click();
  await page.getByRole("button", { name: /Add the first condition/ }).click();
  if (await page.getByRole("group", { name: "Condition 1", exact: true }).count() !== 1 || ruleWrite) throw Error("First condition did not start a blank draft without saving");
  await page.getByRole("button", { name: "New blank rule", exact: true }).click();
  await page.getByRole("button", { name: "Bullish EMA cross", exact: true }).click();
  const draftInput = page.getByLabel("Rule name", { exact: true });
  const restoreDraftButton = page.getByRole("button", { name: "Restore draft", exact: true });
  if (!await restoreDraftButton.isDisabled()) throw Error("Restore enabled without a saved draft");
  await draftInput.fill("Draft recovery fixture");
  await page.reload();
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Restore draft');
    return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  });
  if (await page.getByText("Rule draft available", { exact: true }).count()) throw Error("Old draft banner is still rendered");
  for (const width of [1456, 390]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: 853 });
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole("button", { name: /Switch to .* mode/ }).click();
    const newBounds = await page.getByRole("button", { name: "New blank rule", exact: true }).boundingBox();
    const restoreBounds = await restoreDraftButton.boundingBox();
    if (!newBounds || !restoreBounds || restoreBounds.y < newBounds.y + newBounds.height || Math.abs(restoreBounds.x - newBounds.x) > 1) throw Error("Restore is not aligned below New blank rule");
    await page.screenshot({ path: `/private/tmp/signalgen-draft-action-${width}-${theme}.png`, animations: "disabled" });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error("Draft action overflows");
    const firstCondition = page.getByRole("button", { name: /Add the first condition/ });
    if (!await firstCondition.isEnabled() || !await draftInput.isDisabled()) throw Error("Pending draft locks the first-condition action or unlocks protected fields");
    if (width === 390) {
      await firstCondition.focus();
      await firstCondition.press("Enter");
    } else await firstCondition.click();
    if (await page.getByRole("group", { name: "Condition 1", exact: true }).count() !== 1 || await draftInput.inputValue() !== "" || !await restoreDraftButton.isDisabled() || ruleWrite) throw Error("First condition did not initialize an editable blank rule");
    await draftInput.fill("Draft recovery fixture");
    await page.reload();
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === 'Restore draft');
      return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
    });
  }
  await restoreDraftButton.click();
  if (await draftInput.inputValue() !== "Draft recovery fixture" || !await restoreDraftButton.isDisabled()) throw Error("Draft restore failed or remained enabled without a pending draft");
  await draftInput.fill("Bullish EMA cross");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const bearishPreset = page.getByRole("button", { name: "Bearish EMA cross", exact: true });
  await bearishPreset.click();
  const presetDialog = page.getByRole("alertdialog", { name: "Replace current criteria?" });
  await presetDialog.waitFor();
  await page.waitForFunction(() => document.querySelector('[role="alertdialog"] button') === document.activeElement);
  if (await draftInput.inputValue() !== "Bullish EMA cross") throw Error("Preset changed before confirmation");
  if (!await presetDialog.getByRole("button", { name: "Cancel", exact: true }).evaluate(el => el === document.activeElement)) throw Error("Confirmation did not focus safe action");
  await page.keyboard.press("Escape");
  await presetDialog.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.textContent.includes('Bearish EMA cross'));
  if (await draftInput.inputValue() !== "Bullish EMA cross") throw Error("Escape replaced current criteria");
  if (!await bearishPreset.evaluate(el => el === document.activeElement)) throw Error("Confirmation did not restore focus");
  for (const width of [1440, 1218, 390]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: 853 });
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole("button", { name: /Switch to .* mode/ }).click();
    await bearishPreset.click();
    await presetDialog.waitFor();
    await page.screenshot({ path: `/private/tmp/signalgen-confirm-${width}-${theme}.png`, animations: "disabled" });
    const bounds = await presetDialog.boundingBox();
    if (!bounds || bounds.x < 0 || bounds.x + bounds.width > width) throw Error("Confirmation exceeds viewport");
    await presetDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  await bearishPreset.click();
  await presetDialog.getByRole("button", { name: "Replace criteria", exact: true }).click();
  await presetDialog.waitFor({ state: "hidden" });
  if (await draftInput.inputValue() !== "Bearish EMA cross" || ruleWrite) throw Error("Preset confirmation failed or saved without permission");
  await page.getByRole("button", { name: "Bullish EMA cross", exact: true }).click();
  await presetDialog.getByRole("button", { name: "Replace criteria", exact: true }).click();
  if (!await page.getByRole("button", { name: "Bullish EMA cross", exact: true }).getByLabel("Selected preset").count()) throw Error("Selected preset has no checkmark");
  await page.getByText("Draft saved on this device", { exact: true }).waitFor();
  const library = page.getByRole("region", { name: "Saved rules", exact: true });
  await page.getByLabel("Search saved rules", { exact: true }).fill("not-a-rule");
  await library.getByText("No matching rules", { exact: true }).waitFor();
  await page.getByLabel("Search saved rules", { exact: true }).fill("Rule fixture");
  const signalFilters = page.getByRole("group", { name: "Filter rules by signal", exact: true });
  await signalFilters.getByRole("button", { name: "SELL", exact: true }).click();
  await library.getByText("No matching rules", { exact: true }).waitFor();
  await signalFilters.getByRole("button", { name: "BUY", exact: true }).click();
  await library.getByRole("button", { name: "Edit Rule fixture", exact: true }).waitFor();
  await signalFilters.getByRole("button", { name: "All signals", exact: true }).click();
  await page.getByLabel("Search saved rules", { exact: true }).fill("");
  const previewButton = page.getByRole("button", { name: "Preview criteria", exact: true });
  const preview = page.getByRole("dialog", { name: "Preview criteria", exact: true });
  for (const width of [1456, 390]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: 853 });
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole("button", { name: /Switch to .* mode/ }).click();
    await previewButton.click();
    await preview.waitFor();
    if (!(await preview.innerText()).includes("EMA 9 crosses above EMA 20")) throw Error("Preview differs from draft criteria");
    if (ruleWrite) throw Error("Preview saved the draft");
    const popupBounds = await preview.boundingBox();
    if (!popupBounds || Math.abs(popupBounds.x + popupBounds.width / 2 - width / 2) > 2 || popupBounds.x < 0 || popupBounds.y < 0) throw Error("Preview is not centered or exceeds viewport");
    await page.screenshot({ path: `/private/tmp/signalgen-rule-preview-${width}-${theme}.png`, animations: "disabled" });
    await page.keyboard.press("Escape");
    await preview.waitFor({ state: "hidden" });
    if (!await previewButton.evaluate(el => el === document.activeElement)) throw Error("Preview did not return focus");
  }
  await page.getByLabel("Condition reference 1", { exact: true }).click();
  await page.getByRole("option", { name: "Numeric value", exact: true }).click();
  await page.getByLabel("Condition value 1", { exact: true }).fill("42");
  await previewButton.click();
  if (!(await preview.innerText()).includes("crosses above 42")) throw Error("Numeric reference not reflected in preview");
  await preview.getByRole("button", { name: "Back to editing", exact: true }).click();
  await page.getByLabel("Condition reference 1", { exact: true }).click();
  await page.getByRole("option", { name: "EMA 20", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await draftInput.fill("Draft stability check");
  const draftNode = await draftInput.elementHandle();
  const initialTimeOrigin = await page.evaluate(() => performance.timeOrigin);
  await page.waitForTimeout(6200); // Covers autosave and the next backend health probe.
  if (await draftInput.inputValue() !== "Draft stability check" || !await draftNode.evaluate(el => el.isConnected) || await page.evaluate(() => performance.timeOrigin) !== initialTimeOrigin) throw Error("Draft autosave reloads or remounts the rule editor");
  await draftInput.fill("Bullish EMA cross");
  healthOffline = true;
  await page.getByText("Connection interrupted", { exact: true }).waitFor({ timeout: 10000 });
  if (await page.locator('.workspace-connection').innerText() !== 'Offline') throw Error('Global API status did not reflect the failed probe');
  if (!await draftNode.evaluate(el => el.isConnected)) throw Error("Health interruption replaced the editor DOM");
  await draftInput.fill("Offline draft retained");
  if (!await page.getByRole("button", { name: "Save rule", exact: true }).isDisabled()) throw Error("Offline rule save is enabled");
  healthOffline = false;
  await page.getByText("Connection interrupted", { exact: true }).waitFor({ state: "hidden", timeout: 10000 });
  if (await page.locator('.workspace-connection').innerText() !== 'Connected') throw Error('Global API status did not recover');
  if (await draftInput.inputValue() !== "Offline draft retained" || !await draftNode.evaluate(el => el.isConnected)) throw Error("Connection recovery resets the draft editor");
  await draftInput.fill("Bullish EMA cross");
  await page.getByRole("button", { name: "Add condition", exact: true }).click();
  await page.getByRole("button", { name: "Add condition", exact: true }).click();
  if (await page.getByLabel("Rule name", { exact: true }).inputValue() !== "Bullish EMA cross") throw Error("Preset did not populate rule name");
  await page.getByRole('button', {name:'Translate', exact:true}).click();
  const translation = page.getByRole('dialog', {name:'In plain English', exact:true});
  await translation.waitFor();
  if (!await translation.getByLabel("Rule summary", { exact: true }).innerText().then(text => text.includes("crosses above"))) throw Error("Preset summary missing crossover semantics");
  await translation.getByRole('button', {name:'Close', exact:true}).click();
  await translation.waitFor({state:'hidden'});
  await page.getByLabel("Condition reference 1", { exact: true }).click();
  await page.getByRole("option", { name: "EMA 9", exact: true }).click();
  await page.getByRole("button", { name: "Save rule", exact: true }).click();
  if (!await page.getByText("Choose a different reference; an indicator cannot compare with itself.", { exact: true }).count()) throw Error("Self-comparison validation missing");
  await page.getByLabel("Condition reference 1", { exact: true }).click();
  await page.getByRole("option", { name: "EMA 20", exact: true }).click();
  if (ruleWrite) throw Error("Invalid criteria were sent to the API");
  const notifications = await page.getByRole("button", { name: "Dismiss notification", exact: true, includeHidden: true }).elementHandles();
  await Promise.all(notifications.map(close => close.click({ force: true, timeout: 1000 }).catch(() => {})));
  for (const width of [1440, 390]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: 1000 });
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole("button", { name: /Switch to .* mode/ }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `/private/tmp/signalgen-preset-workflow-${width}-${theme}.png`, fullPage: true, animations: "disabled" });
    const presetContrast = await page.locator('.rule-presets__choices [aria-pressed="true"]').evaluate(el => {
      const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(value => { const c = Number(value) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const a = luminance(getComputedStyle(el).backgroundColor), b = luminance(getComputedStyle(el.querySelector('strong')).color);
      return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
    });
    if (presetContrast < 4.5) throw Error(`Selected preset contrast too low: ${presetContrast}`);
    if (width > 760) {
      if (!(await page.locator('.rule-condition-columns').innerText()).startsWith('No')) throw Error('Condition numbering header is not No');
      if (!await page.locator('.rule-condition-columns').evaluate(el => getComputedStyle(el).textAlign === 'center')) throw Error('Condition headings are not centered');
      const geometry = await page.locator('.rule-condition-row').evaluateAll(rows => rows.map(row => [...row.querySelectorAll('[data-slot="select-trigger"], [data-slot="input"]')].map(control => { const r = control.getBoundingClientRect(); return { left:r.left, top:r.top, height:r.height }; })));
      for (const row of geometry) if (row.some((cell, index) => Math.abs(cell.height - 48) > 1 || Math.abs(cell.top - row[0].top) > 1 || Math.abs(cell.left - geometry[0][index].left) > 1)) throw Error(`Condition columns are not aligned: ${JSON.stringify(geometry)}`);
    }
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error(`Preset workflow overflow ${width} ${theme}`);
  }
  await page.getByRole("button", { name: "Save rule", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#rule-name')?.value === '');
  if (!ruleWrite || ruleWrite.definition.conditions[0].op !== "CROSS_UP" || ruleWrite.definition.signal_type !== "BUY") throw Error("Preset save payload lost crossover or signal action");
  await page.getByRole("button", { name: "Delete Rule fixture", exact: true }).click();
  const deleteRuleDialog = page.getByRole("alertdialog", { name: "Delete this rule?" });
  await deleteRuleDialog.waitFor();
  if (!(await deleteRuleDialog.innerText()).includes("Rule fixture") || ruleDeletes !== 0) throw Error("Rule deletion lacks protected confirmation");
  await deleteRuleDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  if (ruleDeletes !== 0) throw Error("Cancel deleted the saved rule");
  await page.getByRole("button", { name: "Delete Rule fixture", exact: true }).click();
  await deleteRuleDialog.getByRole("button", { name: "Delete rule", exact: true }).click();
  await page.waitForResponse(response => response.url().endsWith('/api/v1/rules') && response.request().method() === 'GET');
  if (ruleDeletes !== 1) throw Error("Rule confirmation did not issue exactly one deletion");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/#app/universes`);
  const catalog = page.getByRole("table", { name: "Stock catalog", exact: true });
  await catalog.waitFor();
  await page.getByRole("button", { name: "United States · USD", exact: true }).click();
  if (!(await catalog.innerText()).includes("AAPL") || (await catalog.innerText()).includes("BBCA")) throw Error("US catalog is not market isolated");
  const usGroups = page.getByRole("group", { name: "Stock categories", exact: true });
  for (const [category, symbol] of [["Banks", "JPM"], ["Energy", "XOM"], ["Consumer", "PG"], ["Property", "PLD"], ["Technology", "AAPL"]]) {
    await usGroups.getByRole("button", { name: category, exact: true }).click();
    if (!(await catalog.innerText()).includes(symbol)) throw Error(`US ${category} category has no ${symbol}`);
    if (category === "Banks" && /AGRO|BBSI/.test(await catalog.innerText())) throw Error('IDX ticker collisions leaked into US banks');
  }
  await usGroups.getByRole("button", { name: "All stocks", exact: true }).click();
  for (const width of [1440, 390]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: 1000 });
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole("button", { name: /Switch to .* mode/ }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `/private/tmp/signalgen-us-categories-${width}-${theme}.png`, fullPage: true, animations: "disabled" });
  }
  await page.getByRole("button", { name: "Indonesia · IDR", exact: true }).click();
  if (!(await catalog.innerText()).includes("BBCA") || (await catalog.innerText()).includes("AAPL")) throw Error("IDX catalog is not market isolated");
  largeUniverse = true;
  await page.goto(`${origin}/#app/analysis`);
  await page.getByRole("button", { name: "Export CSV", exact: true }).waitFor({ timeout: 10000 });
  if (await page.getByRole('list', { name: 'Selected universe stocks', exact: true }).getByRole('listitem').count() !== 10) throw Error('Selected universe stocks are not rendered as ten compact stock cards');
  await page.getByRole("group", { name: "Signal status", exact: true }).waitFor();
  await page.getByRole("group", { name: "Signal status", exact: true }).getByRole("button", { name: /^SELL/ }).click();
  if (!await page.getByText("No stocks match these filters.", { exact: false }).count()) throw Error("SELL filter did not exclude BUY and rejected rows");
  await page.getByRole("button", { name: "Reset filters", exact: true }).click();
  for (const width of [1440, 390]) for (const theme of ["dark", "light"]) {
    await page.setViewportSize({ width, height: 1000 });
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole("button", { name: /Switch to .* mode/ }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `/private/tmp/signalgen-screening-workflow-${width}-${theme}.png`, fullPage: true, animations: "disabled" });
    const cards = await page.locator('.screener-universe-stocks').evaluate(el => {
      const outer = el.getBoundingClientRect(), rows = new Map();
      for (const item of el.children) { const r = item.getBoundingClientRect(); const top = Math.round(r.top); if (!rows.has(top)) rows.set(top, []); rows.get(top).push(r); }
      return [...rows.values()].every(row => Math.abs(row[0].left - outer.left) < 1 && Math.abs(row[row.length - 1].right - outer.right) < 1);
    });
    if (!cards) throw Error(`Stock cards do not fill every row: ${width} ${theme}`);
    if (!await page.locator('.screener-criteria li').evaluateAll(items => items.length === 2 && items.every(el => parseFloat(getComputedStyle(el).borderRadius) >= 10 && parseFloat(getComputedStyle(el).borderTopWidth) >= 1))) throw Error('Rule preview is not presented as rounded cards');
  }
  savedCardFixture = true;
  await page.goto(`${origin}/#app/universes`);
  await page.getByRole('button', { name: 'Edit Banking watchlist', exact:true }).waitFor();
  if (await page.locator('.universe-library__rows > article').count() !== 2) throw Error('Universe preview must contain only two cards');
  for (const width of [1440, 900, 390]) for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width, height: 1000 });
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole('button', { name: /Switch to .* mode/ }).click();
    const valid = await page.locator('.universe-library__rows').evaluate(el => [...el.children].every(card => {
      const css = getComputedStyle(card), r = card.getBoundingClientRect();
      return parseFloat(css.borderRadius) >= 12 && parseFloat(css.paddingLeft) >= 16 && [...card.querySelectorAll('[data-slot="badge"]')].every(badge => {
        const b = badge.getBoundingClientRect(), style = getComputedStyle(badge);
        return b.left >= r.left + 15 && b.right <= r.right - 15 && b.height >= 32 && parseFloat(style.borderRadius) >= 8 && getComputedStyle(badge, '::before').content === 'none';
      });
    }));
    if (!valid) throw Error(`Saved universe cards or ticker cards invalid: ${width} ${theme}`);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error('Saved card layout overflows');
    await page.locator('.universe-library').screenshot({ path: `/private/tmp/signalgen-saved-universes-${width}-${theme}.png`, animations:'disabled' });
    await page.getByRole('button', {name:'See all stock universes (3)', exact:true}).click();
    const directory = page.getByRole('dialog', {name:'Your stock universes', exact:true});
    await directory.waitFor();
    if (await directory.locator('.universe-directory > li').count() !== 3) throw Error('All-universes popup omitted a saved universe');
    const row = directory.locator('.universe-directory > li').last();
    if (!(await row.innerText()).includes('Third universe') || !(await row.innerText()).includes('BBRI')) throw Error('Universe names or stocks missing');
    if (width === 1440 && !await row.evaluate(el => el.querySelector('.universe-directory__symbols').getBoundingClientRect().left > el.querySelector('.universe-directory__identity').getBoundingClientRect().right)) throw Error('Universe name and stocks are not side by side');
    await page.screenshot({path:`/private/tmp/signalgen-universe-directory-${width}-${theme}.png`, animations:'disabled'});
    await page.keyboard.press('Escape');
    await directory.waitFor({state:'hidden'});
  }
  await page.getByRole('button', {name:'See all stock universes (3)', exact:true}).click();
  await page.getByRole('dialog', {name:'Your stock universes', exact:true}).getByRole('button', {name:'Edit Third universe', exact:true}).click();
  await page.waitForFunction(() => document.getElementById('universe-name') === document.activeElement).catch(async () => { throw Error(`Universe edit did not restore focus: ${await page.evaluate(() => document.activeElement?.tagName)}`); });
  if (await page.getByLabel('Universe name', {exact:true}).inputValue() !== 'Third universe') throw Error('Popup did not edit hidden third universe');
  await page.getByRole('button', { name:'Edit Banking watchlist', exact:true }).click();
  if (await page.getByLabel('Universe name', { exact:true }).inputValue() !== 'Banking watchlist') throw Error('Saved universe edit action broken');
  await page.goto(`${origin}/#app/rules`);
  const editRule = page.getByRole('button', {name:'Edit Rule fixture', exact:true});
  if (!(await editRule.innerText()).includes('Edit rules')) throw Error('Edit rules label missing');
  await editRule.click();
  const editDialog = page.getByRole('dialog', {name:'Edit rules', exact:true});
  await editDialog.waitFor();
  if (await editDialog.getByLabel('Rule name', {exact:true}).inputValue() !== rule.name) throw Error('Editor popup loaded wrong rule');
  await editDialog.getByLabel('Rule name', {exact:true}).fill('Retained popup draft');
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    const box = await editDialog.boundingBox();
    if (!box || box.x < 0 || box.x+box.width > width+1) throw Error('Rule editor exceeds viewport');
    // Read both widths in one frame after the responsive dialog settles.
    await page.waitForFunction(() => {
      const section=document.querySelector('[role="dialog"] .rule-condition-section');
      const add=section?.querySelector('.rule-add-condition');
      return add && Math.abs(add.getBoundingClientRect().width-section.getBoundingClientRect().width)<=2;
    });
    await page.screenshot({path:`/private/tmp/signalgen-edit-rule-${width}.png`,animations:'disabled'});
  }
  await editDialog.getByRole('button',{name:'Translate',exact:true}).click();
  await page.getByRole('dialog',{name:'In plain English',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await editDialog.waitFor();
  await editDialog.getByLabel('Condition operator 1',{exact:true}).click();
  await page.locator('[role="option"] .rule-operator-symbol').first().waitFor();
  const symbolOptions = await page.locator('[role="option"] .rule-operator-symbol').allTextContents();
  if (!symbolOptions.some(text=>text.includes('≥')) || !symbolOptions.some(text=>text.includes('↗'))) throw Error('Comparison symbols missing');
  await page.keyboard.press('Escape');
  await editDialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Continue editing',exact:true}).click();
  if (await editDialog.getByLabel('Rule name',{exact:true}).inputValue() !== 'Retained popup draft') throw Error('Closing popup lost editing draft');
  await editDialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.goto(`${origin}/#app/analysis`);
  unauthorized = true;
  await page.reload();
  await page.waitForURL('**/#login', { timeout: 10000 });
  unauthorized = false;
  for (const view of ['login', 'register', 'forgot-password', 'reset-password']) {
    await page.goto(`${origin}/#${view}`);
    await page.locator('.auth-card').waitFor();
    for (const width of [1440, 900, 390, 320]) for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width, height: 1000 });
      if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole('button', { name: /Switch to .* mode/ }).click();
      const geometry = await page.locator('.auth-card').evaluate(el => {
        const r = el.getBoundingClientRect(), css = getComputedStyle(el), form = el.querySelector('form').getBoundingClientRect(), heading = el.querySelector('.auth-heading').getBoundingClientRect(), toggle = document.querySelector('.auth-theme-toggle').getBoundingClientRect();
        return { radius: parseFloat(css.borderRadius), padding: parseFloat(css.paddingLeft), left: r.left, right:r.right, alignment:Math.abs(form.left-heading.left), overlap: toggle.bottom > r.top && toggle.left < r.right && toggle.right > r.left, viewport: innerWidth };
      });
      if (geometry.radius < 16 || geometry.padding < 24 || geometry.left < 15 || geometry.right > geometry.viewport - 15 || geometry.alignment > 1 || geometry.overlap) throw Error(`Auth card geometry invalid: ${view} ${width} ${theme} ${JSON.stringify(geometry)}`);
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error(`Auth page overflow: ${view} ${width} ${theme}`);
      if (view === 'login' && [1440, 390].includes(width)) {
        await page.evaluate(() => window.scrollTo(0,0));
        await page.screenshot({ path: `/private/tmp/signalgen-auth-card-${width}-${theme}.png`, fullPage:true, animations:'disabled' });
      }
    }
  }
  let registrationCalls = 0;
  let registrationFails = true;
  await page.route('**/api/auth/register', async route => {
    registrationCalls++;
    return registrationFails
      ? route.fulfill({status:503,json:{error:{code:'SERVICE_UNAVAILABLE',message:'Synthetic registration failure'}}})
      : route.fulfill({json:{user}});
  });
  await page.goto(`${origin}/#register`);
  await page.getByLabel('Full name', {exact:true}).fill('Synthetic registration');
  await page.getByLabel('Email', {exact:true}).fill('signup@example.test');
  await page.getByLabel('Password', {exact:true}).fill('Synthetic-pass-123');
  await page.getByLabel('Confirm password', {exact:true}).fill('Different-pass-123');
  await page.getByRole('button', {name:'Create account',exact:true}).click();
  await page.getByText('The passwords do not match.', {exact:true}).waitFor();
  if (registrationCalls) throw Error('Mismatched registration was submitted');
  await page.getByLabel('Confirm password', {exact:true}).fill('Synthetic-pass-123');
  await page.getByRole('button', {name:'Create account',exact:true}).click();
  await page.getByText('The service is temporarily unavailable. Try again shortly.', {exact:true}).waitFor();
  if (await page.getByLabel('Password', {exact:true}).inputValue() !== 'Synthetic-pass-123') throw Error('Failed registration cleared the editable form');
  registrationFails = false;
  await page.getByRole('button', {name:'Create account',exact:true}).click();
  const confirmation = page.getByRole('region', {name:'Registration confirmation',exact:true});
  await confirmation.waitFor();
  if (await page.locator('.auth-card input, .auth-card form').count()) throw Error('Registration fields remain after successful account creation');
  if (await page.getByRole('button', {name:'Create account',exact:true}).count()) throw Error('Registration can be submitted again after success');
  if (!await confirmation.evaluate(el => el === document.activeElement)) throw Error('Registration confirmation did not receive focus');
  for (const width of [1440,390]) for (const theme of ['dark','light']) {
    await page.setViewportSize({width,height:1000});
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole('button',{name:/Switch to .* mode/}).click();
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error('Registration confirmation overflows');
    await page.locator('.auth-card').screenshot({path:`/private/tmp/signalgen-registration-success-${width}-${theme}.png`,animations:'disabled'});
  }
  await page.locator('.auth-registration-success a[href="#login"]').click();
  await page.getByLabel('Password', {exact:true}).waitFor();
  if (await page.getByLabel('Password', {exact:true}).inputValue()) throw Error('Registration password leaked into sign in');
  await page.goto(`${origin}/#register`);
  await page.getByLabel('Full name', {exact:true}).waitFor();
  if (await page.getByLabel('Password', {exact:true}).inputValue() || await page.getByLabel('Full name', {exact:true}).inputValue()) throw Error('Registration data survived reopening the form');
  if (errors.length) throw Error(errors.join("; "));
  await page.evaluate(() => document.body.setAttribute("data-signalgen-browser-tests", "complete"));
}
