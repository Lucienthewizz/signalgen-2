// Synthetic account/API boundaries, real application, checksum validation and Go/WASM.
// prettier-ignore
async (page) => {
  const origin = new URL(page.url()).origin;
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const user = {
    id: "11111111-1111-4111-8111-111111111119",
    email: "backtest@example.test",
    full_name: "Backtest QA fixture",
    role: "user",
    status: "active",
  };
  const rule = {
    id: "bt-rule",
    name: "QA BUY rule",
    owner_type: "user",
    read_only: false,
    version: 1,
    definition_hash: "sha256:qa-rule",
    engine_version: "core-0.4.0",
    schema_version: "signal-baseline-1",
    definition: {
      name: "QA BUY rule",
      logic: "AND",
      signal_type: "BUY",
      cooldown_sec: 0,
      conditions: [{ left: "PRICE", op: ">", right: 1 }],
    },
  };
  const universe = {
    id: "univ_qa",
    name: "QA US stocks",
    symbols: ["TEST"],
    version: 1,
  };
  let mode = "healthy",
    prepares = 0,
    grants = 0,
    scoring = 0,
    release,
    holdReady,
    heldDone;
  const snapshots = new Map();
  await page.addInitScript(() => {
    sessionStorage.setItem("signalgen.access-token", "synthetic-backtest-only");
    sessionStorage.setItem(
      "signalgen.app-session",
      "synthetic-backtest-session",
    );
    sessionStorage.setItem("signalgen.app-session-origin", "same-origin");
  });
  async function snapshot(input) {
    const start = Date.parse("2025-11-01T00:00:00Z");
    const special = {
      "2026-01-21": [110, 115],
      "2026-01-22": [120, 100],
      "2026-01-23": [90, 100],
      "2026-01-24": [105, 110],
      "2026-01-25": [115, 110],
      "2026-01-26": [120, 125],
    };
    const candles = Array.from({ length: 90 }, (_, index) => {
      const timestamp = new Date(start + index * 86400000).toISOString();
      const [open, close] = special[timestamp.slice(0, 10)] ?? [100, 100];
      return {
        timestamp,
        open,
        high: Math.max(open, close) + 5,
        low: Math.min(open, close) - 5,
        close,
        volume: 1000,
      };
    });
    const scope = {
      mode: input.mode,
      from: input.from,
      to: input.to,
      n_steps: input.n_steps,
      ...(input.rule_id ? { rule_id: input.rule_id } : {}),
    };
    const data = {
      schema_version: "ohlcv-multi-1",
      purpose: "backtest",
      market: "US",
      currency: "USD",
      timeframe: "1d",
      timezone: "UTC",
      adjustment: "none",
      backtest: scope,
      series: [{ symbol: "TEST", timezone: "UTC", candles }],
    };
    const text = JSON.stringify(data);
    const checksum = await page.evaluate(
      async (text) =>
        "sha256:" +
        Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(text),
            ),
          ),
          (n) => n.toString(16).padStart(2, "0"),
        ).join(""),
      text,
    );
    const manifest = {
      dataset_id: `backtest-${prepares}`,
      version: String(prepares),
      expires_at: new Date(Date.now() + 900000).toISOString(),
      schema_version: "ohlcv-multi-1",
      provider: "yahoo_finance",
      purpose: "backtest",
      market: "US",
      currency: "USD",
      symbols: ["TEST"],
      exchanges: ["XNAS"],
      timeframe: "1d",
      timezone: "UTC",
      requested_range: { from: input.from, to: input.to },
      available_range: { from: "2025-11-01", to: "2026-01-29" },
      warmup_candles: 20,
      adjustment: "none",
      candle_count: candles.length,
      decoded_bytes: new TextEncoder().encode(text).length,
      checksum: mode === "bad-checksum" ? "sha256:corrupt" : checksum,
      quality: {
        status: "partial",
        warnings: ["Synthetic browser-test data; raw OHLCV."],
      },
      backtest: scope,
    };
    snapshots.set(manifest.dataset_id, { manifest, text });
    return manifest;
  }
  await page.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      pathname = url.pathname;
    const respond = (payload) => route.fulfill({ json: payload });
    if (
      pathname !== "/api" &&
      !pathname.startsWith("/api/") &&
      pathname !== "/ready"
    )
      return url.origin === origin ? route.continue() : route.abort();
    if (pathname === "/api" || pathname === "/ready")
      return respond({
        name: "Synthetic backtest API",
        status: "ready",
        version: "0.12.0",
      });
    if (pathname === "/api/auth/me") return respond(user);
    if (pathname === "/api/v1/sessions/current" && request.method()==="DELETE") return respond({message:"Signed out"});
    if (pathname === "/api/v1/sessions") return respond({ session_token: "synthetic-backtest-session", session: { id: "qa-session", installation_id: "11111111-1111-4111-8111-111111111118", label: "QA browser", created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(), last_seen_at: new Date().toISOString() } });
    if (pathname === "/api/v1/account/me")
      return respond({
        user,
        features: mode === "denied" ? ["screener"] : ["screener", "backtest"],
        session: {
          id: "qa-session",
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        },
      });
    if (pathname === "/api/v1/capabilities")
      return respond({
        backtest: {
          schema_version: "backtest-2",
          policy_version: "holding-next-open-1",
          max_symbols: 10,
          max_candles_per_symbol: 2500,
          max_entries: 2000,
          max_horizon: 100,
        },
      });
    if (pathname === "/api/v1/rules")
      return respond({
        items: [
          rule,
          {
            ...rule,
            id: "sell-rule",
            name: "QA SELL rule",
            definition: { ...rule.definition, signal_type: "SELL" },
          },
        ],
        next_cursor: null,
      });
    if (pathname === `/api/v1/rules/${rule.id}`) return respond(rule);
    if (pathname === "/api/v1/stock-universes")
      return respond({ items: [universe] });
    if (pathname === "/api/v1/subscription")
      return respond({ subscription: null });
    if (pathname === "/api/v1/workspace") return respond({ items: [] });
    if (
      pathname.startsWith("/api/v1/workspace/") &&
      request.method() === "PUT"
    ) {
      const body = request.postDataJSON();
      return respond({
        kind: pathname.split("/").at(-1),
        data: body.data,
        version: (body.version ?? 0) + 1,
        updated_at: new Date().toISOString(),
      });
    }
    if (pathname === "/api/v1/datasets/prepare") {
      prepares++;
      const body = request.postDataJSON();
      if (body.purpose !== "backtest" || body.timeframe !== "1d")
        throw Error("Wrong backtest purpose/interval");
      if (mode === "provider-error")
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: "PROVIDER_UNAVAILABLE",
              message: "Provider temporarily unavailable.",
              request_id: "qa-provider",
            },
          },
        });
      let finish;
      if (mode === "hold") {
        heldDone = new Promise((resolve) => {
          finish = resolve;
        });
        await new Promise((resolve) => {
          release = resolve;
          holdReady?.();
        });
      }
      try {
        return await respond(await snapshot(body));
      } catch (error) {
        if (!finish) throw error;
      } finally {
        finish?.();
      }
    }
    const match = pathname.match(
      /^\/api\/v1\/datasets\/([^/]+)\/(manifest|content)$/,
    );
    if (match) {
      const item = snapshots.get(match[1]);
      if (!item) throw Error("Unknown fixture snapshot");
      return match[2] === "manifest"
        ? respond(item.manifest)
        : route.fulfill({ contentType: "application/json", body: item.text });
    }
    if (pathname === "/api/v1/compute-grants") {
      grants++;
      const body = request.postDataJSON();
      if (body.purpose !== "backtest")
        throw Error("Screen grant used for backtest");
      return respond({
        ...body,
        id: "qa-backtest-grant",
        expires_at: new Date(Date.now() + 300000).toISOString(),
      });
    }
    if (pathname === "/api/v1/backtests/signals") {
      scoring++;
      const body = request.postDataJSON();
      if (
        body.candidates.length !== 71 ||
        body.candidates.some(
          (item) =>
            item.symbol !== "TEST" || !Number.isFinite(item.features.ema20),
        )
      )
        throw Error("WASM did not send the complete feature history");
      const scope = [...snapshots.values()].at(-1).manifest.backtest;
      return respond({
        policy_version: "holding-next-open-1",
        entries:
          mode === "no-signals"
            ? []
            : body.candidates
                .filter(
                  (item) =>
                    item.timestamp.slice(0, 10) >= scope.from &&
                    item.timestamp.slice(0, 10) <= scope.to,
                )
                .map((item) => ({
                  symbol: item.symbol,
                  timestamp: item.timestamp,
                  signal_type: "BUY",
                })),
      });
    }
    return route.fulfill({
      status: 404,
      json: { error: { code: "UNMOCKED_FIXTURE", message: pathname } },
    });
  });
  async function ready() {
    await page.goto(`${origin}/#app/backtest`);
    await page.reload();
    await page
      .getByLabel("Entry mode", { exact: true })
      .waitFor({ timeout: 20000 });
  }
  async function dates() {
    await page
      .getByLabel("From date (UTC)", { exact: true })
      .fill("2026-01-20");
    await page.getByLabel("To date (UTC)", { exact: true }).fill("2026-01-23");
  }
  async function result() {
    await page
      .getByRole("heading", { name: "Backtest results", exact: true })
      .waitFor({ timeout: 60000 });
  }
  async function assertLayout(width) {
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      )
    )
      throw Error(`Page overflow at ${width}px`);
    if (
      await page
        .getByRole("region", { name: "Backtest trades", exact: true })
        .count()
    ) {
      const box = await page
        .getByRole("region", { name: "Backtest trades", exact: true })
        .boundingBox();
      if (box && (box.x < 0 || box.x + box.width > width + 1))
        throw Error("Trade table escaped its scroll region");
    }
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["dark", "light"]) {
      mode = "healthy";
      await ready();
      await dates();
      if ((await page.locator("html").getAttribute("data-theme")) !== theme)
        await page.getByRole("button", { name: /Switch to .* mode/ }).click();
      if (
        !(await page.locator("#bt-rule option[value='sell-rule']").isDisabled())
      )
        throw Error("SELL rule is selectable");
      const beforeGrants = grants,
        beforeScoring = scoring;
      await page
        .getByRole("button", { name: "Run backtest", exact: true })
        .click();
      await result();
      if (grants !== beforeGrants + 1 || scoring !== beforeScoring + 1)
        throw Error("Rule mode did not use one complete symbol batch");
      await page.getByText("Saved to this account's local history.", { exact: true }).waitFor();
      const comparison = page.getByRole("region", { name: "Holding period comparison", exact: true });
      if (await comparison.locator("tbody tr").count() !== 3) throw Error("Missing horizon comparison");
      await comparison.getByRole("button", {name:"T+1",exact:true}).focus();
      await page.keyboard.press("Enter");
      if (await page.getByLabel("Exit horizon", {exact:true}).inputValue() !== "0") throw Error("Keyboard horizon selection failed");
      await page.getByRole("region",{name:"Results by stock",exact:true}).waitFor();
      const slider = page.getByLabel("Inspect daily equity",{exact:true});
      await slider.focus(); await page.keyboard.press("End");
      if (!(await slider.getAttribute("aria-valuetext")).includes("$")) throw Error("Equity chart lost dataset currency");
      if(width===1440 && theme==="dark") {
        const pendingDownload = page.waitForEvent("download");
        await page.getByRole("button",{name:"Export horizons CSV",exact:true}).click();
        const download=await pendingDownload; const stream=await download.createReadStream(); let text="";
        for await(const chunk of stream) text+=chunk.toString("utf8");
        if(text.split("\r\n").length!==4 || !text.includes('"T+3"') || !text.includes('"USD"')) throw Error("Horizon CSV is incomplete");
      }
      await assertLayout(width);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `output/playwright/backtest-rule-${width}-${theme}.png`,
        fullPage: true,
      });
      await page
        .getByLabel("Entry mode", { exact: true })
        .selectOption("manual");
      if (await page.getByTestId("backtest-results").count())
        throw Error("Old result survived a mode change");
      await page
        .getByLabel("Holding period (candles)", { exact: true })
        .fill("1");
      await page
        .getByRole("button", { name: "Prepare data", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Manual entries", exact: true })
        .waitFor();
      await page
        .getByLabel("Signal candle (UTC)", { exact: true })
        .selectOption({ label: "2026-01-20 · close 100" });
      await page
        .getByRole("button", { name: "Add entry", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Add entry", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "already been added" })
        .waitFor();
      if(width===1440 && theme==="dark") {
        await page.getByText("Add multiple manual entries",{exact:true}).click();
        await page.getByLabel("Manual entry rows",{exact:true}).fill("symbol,timestamp\nTEST,2026-01-21T00:00:00Z\nOTHER,2026-01-21T00:00:00Z");
        await page.getByRole("button",{name:"Add all entries",exact:true}).click();
        await page.locator("#bt-bulk-error").filter({hasText:"Line 3"}).waitFor();
        if(await page.locator(".backtest-entry-list li").count()!==1) throw Error("Bulk input partially appended invalid rows");
        await page.getByLabel("Manual entry rows",{exact:true}).fill("TEST,2026-01-21T00:00:00Z");
        await page.getByRole("button",{name:"Add all entries",exact:true}).click();
        if(await page.locator(".backtest-entry-list li").count()!==2) throw Error("Valid bulk entry was not added");
        await page.getByRole("button",{name:"Remove entry 2",exact:true}).click();
      }
      const manualGrants = grants;
      await page
        .getByRole("button", { name: "Run manual backtest", exact: true })
        .click();
      await result();
      if (grants !== manualGrants)
        throw Error("Manual mode issued a rule grant");
      const finalEquity = await page
        .locator(".backtest-metrics > div")
        .filter({ has: page.getByText("Final equity", { exact: true }) })
        .locator("dd")
        .textContent();
      if (finalEquity !== "$10,454.55")
        throw Error(`Unexpected actual WASM next-open P&L: ${finalEquity}`);
      await page.getByText("Saved to this account's local history.", { exact: true }).waitFor();
      await assertLayout(width);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `output/playwright/backtest-manual-${width}-${theme}.png`,
        fullPage: true,
      });
      await page
        .getByLabel("Commission per side (%)", { exact: true })
        .fill("1");
      if (await page.getByTestId("backtest-results").count())
        throw Error("Results were retained after a cost change");
      if (width === 1440 && theme === "dark") {
        await page
          .getByLabel("To date (UTC)", { exact: true })
          .fill("2026-01-29");
        await page
          .getByLabel("From date (UTC)", { exact: true })
          .fill("2026-01-28");
        await page
          .getByLabel("Holding period (candles)", { exact: true })
          .fill("3");
        await page
          .getByRole("button", { name: "Prepare data", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Manual entries", exact: true })
          .waitFor();
        await page
          .getByLabel("Signal candle (UTC)", { exact: true })
          .selectOption({ label: "2026-01-28 · close 100" });
        await page
          .getByRole("button", { name: "Add entry", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Run manual backtest", exact: true })
          .click();
        await result();
        await page
          .getByRole("cell", { name: "Open · unrealized", exact: true })
          .waitFor();
        await page
          .getByLabel("Entry mode", { exact: true })
          .selectOption("rule");
        await dates();
        mode = "no-signals";
        await page
          .getByRole("button", { name: "Run backtest", exact: true })
          .click();
        await result();
        await page
          .getByText(
            "No trades in this range. Review the rule or manual entries.",
            { exact: true },
          )
          .waitFor();
        await page
          .getByRole("button", { name: "Reset results", exact: true })
          .click();
        mode = "bad-checksum";
        await page
          .getByRole("button", { name: "Run backtest", exact: true })
          .click();
        await page
          .getByRole("alert")
          .filter({ hasText: "integrity" })
          .waitFor();
        if (await page.getByTestId("backtest-results").count())
          throw Error("Corrupt snapshot produced a result");
        mode = "provider-error";
        await page
          .getByRole("button", { name: "Run backtest", exact: true })
          .click();
        await page
          .getByRole("alert")
          .filter({ hasText: "Provider temporarily unavailable" })
          .waitFor();
        mode = "hold";
        const holdStarted = new Promise((resolve) => { holdReady = resolve; });
        await page
          .getByRole("button", { name: "Run backtest", exact: true })
          .click();
        await holdStarted;
        await page.waitForFunction(
          () =>
            document.querySelector('[data-testid="backtest-progress"]')
              ?.textContent === "Preparing historical data…",
        );
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        if (release) release();
        if (heldDone) await heldDone;
        await page
          .getByTestId("backtest-progress")
          .filter({ hasText: "cancelled" })
          .waitFor();
        if (await page.getByTestId("backtest-results").count())
          throw Error("Cancelled result appeared late");
      }
    }
  }
  // Pagination and a failed archive save must leave the complete result/export usable.
  mode="healthy";
  await page.getByLabel("Entry mode",{exact:true}).selectOption("rule");
  await page.getByLabel("From date (UTC)",{exact:true}).fill("2026-01-01");
  await page.getByLabel("To date (UTC)",{exact:true}).fill("2026-01-29");
  await page.getByLabel("Holding period (candles)",{exact:true}).fill("12");
  await page.evaluate(()=>{window.__btPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.transaction.db.name==="signalgen-backtest-history-v1")throw new DOMException("Synthetic full history","QuotaExceededError");return window.__btPut.apply(this,args);};});
  await page.getByRole("button",{name:"Run backtest",exact:true}).click();await result();
  await page.getByText(/Result is available, but history was not saved/).waitFor();
  await page.evaluate(()=>{IDBObjectStore.prototype.put=window.__btPut;delete window.__btPut;});
  await page.getByLabel("Exit horizon",{exact:true}).selectOption("0");
  const horizonTable=page.getByRole("region",{name:"Holding period comparison",exact:true});
  if(await horizonTable.locator("tbody tr").count()!==10)throw Error("Horizon pagination is not bounded to ten");
  await page.getByRole("button",{name:"Next horizons",exact:true}).click();
  await horizonTable.getByRole("button",{name:"T+12",exact:true}).click();
  if(await page.getByLabel("Exit horizon",{exact:true}).inputValue()!=="11")throw Error("Second-page horizon selection failed");
  await page.getByLabel("Exit horizon",{exact:true}).selectOption("0");
  await page.getByRole("button",{name:"Next trades",exact:true}).click();
  if(await page.getByRole("region",{name:"Backtest trades",exact:true}).locator("tbody tr").count()!==3)throw Error("Trade pagination lost rows");
  const tradeDownload=page.waitForEvent("download");await page.getByRole("button",{name:"Export trades CSV",exact:true}).click();
  const tradeStream=await(await tradeDownload).createReadStream();let tradeText="";for await(const chunk of tradeStream)tradeText+=chunk.toString("utf8");
  if(tradeText.split("\r\n").length!==29)throw Error("CSV exported only the visible trade page");
  await page.getByText("Equity values",{exact:true}).click();
  await page.getByRole("button",{name:"Next equity values",exact:true}).click();
  if(await page.getByRole("region",{name:"Backtest equity",exact:true}).locator("tbody tr").count()!==25)throw Error("Equity table is not paginated");
  await page.getByRole("button",{name:"Run backtest",exact:true}).click();await result();
  await page.getByText("Saved to this account's local history.",{exact:true}).waitFor();
  // Native IndexedDB transactions, persistence and limits; no fake storage implementation.
  const storageChecks = await page.evaluate(async(owner) => {
    const h=await import("/src/analysis/backtest-history.ts");
    const signal=()=>new AbortController().signal,active=()=>true;
    const check=(condition,message)=>{if(!condition)throw Error(message);};
    const fails=async(fn,message)=>{let failed=false;try{await fn();}catch{failed=true;}check(failed,message);};
    const rows=await h.listBacktestArchives(owner,signal(),active);
    check(rows.length>0,"No native history saved");
    const original=await h.loadBacktestArchive(owner,rows[0].id,signal(),active);
    const encoded=JSON.stringify(original);
    check(!encoded.includes("synthetic-backtest-only") && !encoded.includes("compute_grant") && !encoded.includes('"candles"') && !encoded.includes('"conditions"'),"Archive persisted credentials or raw/private input");
    const make=(id,account="qa-history-retention")=>({...structuredClone(original),id,owner_id:account,saved_at:new Date(Date.now()+Number(id.replace(/\D/g,""))*1000).toISOString()});
    for(let i=0;i<12;i++)await h.saveBacktestArchive(make(`run-${i}`),signal(),active);
    const kept=await h.listBacktestArchives("qa-history-retention",signal(),active);
    check(kept.length===10 && kept.every((r)=>r.id!=="run-0"&&r.id!=="run-1"),"History count pruning failed");
    await fails(()=>h.loadBacktestArchive("another-account",rows[0].id,signal(),active),"Foreign account opened an archive");
    await fails(()=>h.saveBacktestArchive({...structuredClone(original),owner_id:"another-account"},signal(),active),"Foreign account overwrote an archive");
    await h.deleteBacktestArchives("another-account",rows[0].id,signal(),active);
    check((await h.listBacktestArchives(owner,signal(),active)).length===rows.length,"Foreign delete changed owner's history");
    let current=true;const cancelled=h.saveBacktestArchive(make("run-99"),signal(),()=>current);current=false;
    await fails(()=>cancelled,"Account switch did not cancel pending save");
    check(!(await h.listBacktestArchives("qa-history-retention",signal(),active)).some((r)=>r.id==="run-99"),"Late write restored account data");
    const controller=new AbortController();const aborted=h.saveBacktestArchive(make("run-98"),controller.signal,active);controller.abort();
    await fails(()=>aborted,"Aborted save committed");
    const raw=async(work)=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(h.BACKTEST_HISTORY_DATABASE,1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{await new Promise((resolve,reject)=>{const tx=db.transaction(["summaries","runs"],"readwrite");tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);work(tx);});}finally{db.close();}};
    await raw((tx)=>tx.objectStore("runs").put({id:"run-11",payload:"{invalid"}));
    await fails(()=>h.loadBacktestArchive("qa-history-retention","run-11",signal(),active),"Damaged archive was accepted");
    await h.deleteBacktestArchives("qa-history-retention","run-11",signal(),active);
    await h.saveBacktestArchive(make("run-12"),signal(),active);
    const before=(await h.listBacktestArchives("qa-history-retention",signal(),active)).length;
    check(before===10,"Quota rollback fixture must force pruning");
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(){throw new DOMException("Synthetic quota failure","QuotaExceededError");};
    try{await fails(()=>h.saveBacktestArchive(make("run-100"),signal(),active),"Quota failure claimed success");}finally{IDBObjectStore.prototype.put=put;}
    check((await h.listBacktestArchives("qa-history-retention",signal(),active)).length===before,"Failed commit lost previous archives");
    const big=make("big-1","qa-history-bytes");big.result.warnings=["x".repeat(26*1024*1024)];
    await h.saveBacktestArchive(big,signal(),active);big.id="big-2";big.saved_at=new Date(Date.now()+2000).toISOString();await h.saveBacktestArchive(big,signal(),active);
    check((await h.listBacktestArchives("qa-history-bytes",signal(),active)).length===1,"50 MiB byte pruning failed");
    big.id="oversize";big.result.warnings=["x".repeat(51*1024*1024)];await fails(()=>h.saveBacktestArchive(big,signal(),active),"Oversize run was saved");
    await h.deleteBacktestArchives("qa-history-bytes",null,signal(),active);await h.deleteBacktestArchives("qa-history-retention",null,signal(),active);
    return {rows:rows.length,latestTitle:rows[0].title};
  },user.id);
  const readsBefore=prepares,grantsBefore=grants,scoringBefore=scoring;
  await ready();
  const history=page.getByRole("region",{name:"Local backtest history",exact:true});
  await history.getByRole("button",{name:/Open saved run/}).first().click();await result();
  await page.getByText(/Saved result · read-only/).waitFor();
  if(prepares!==readsBefore || grants!==grantsBefore || scoring!==scoringBefore)throw Error("Opening history fetched market data or scored a rule");
  if(!(await page.locator(".backtest-metrics").textContent()).includes("$"))throw Error("Archive lost its saved currency after reload");
  await history.getByRole("button",{name:/Delete saved run/}).first().click();
  await page.getByRole("button",{name:"Cancel",exact:true}).click();
  if(await history.getByRole("button",{name:/Open saved run/}).count()!==storageChecks.rows)throw Error("Cancel deleted history");
  await history.getByRole("button",{name:/Delete saved run/}).first().click();
  await page.getByRole("button",{name:"Delete saved backtest",exact:true}).click();
  await page.waitForFunction((n)=>document.querySelectorAll(".backtest-history-list li").length===n,storageChecks.rows-1);
  // Real logout clears the visible report, leaving archives for next login.
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole("button",{name:"Open Backtest QA fixture menu",exact:true}).click();
  await page.getByRole("menuitem",{name:"Log out",exact:true}).click();
  await page.waitForFunction(()=>location.hash==="#home" && !document.querySelector('[data-testid="backtest-results"]') && !document.querySelector(".backtest-history-list"));
  await ready();
  if(await page.getByRole("button",{name:/Open saved run/}).count()!==storageChecks.rows-1)throw Error("Logout erased persistent history");
  const previousId=user.id;user.id="11111111-1111-4111-8111-111111111117";await ready();
  await page.getByText("No saved backtests on this browser yet.",{exact:true}).waitFor();
  user.id=previousId;await ready();
  if(await page.getByRole("button",{name:/Open saved run/}).count()!==storageChecks.rows-1)throw Error("Account switch lost owner history");
  await page.getByRole("button",{name:"Delete all history",exact:true}).click();await page.getByRole("button",{name:"Delete all local backtests",exact:true}).click();
  await page.getByText("No saved backtests on this browser yet.",{exact:true}).waitFor();
  mode = "denied";
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "not enabled" }).waitFor();
  if (
    await page
      .getByRole("button", { name: "Run backtest", exact: true })
      .count()
  )
    throw Error("Denied account has a runnable form");
  if(await page.getByRole("heading",{name:"Local backtest history",exact:true}).count())throw Error("Denied account can see saved history");
  mode = "healthy";
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByLabel("Entry mode", { exact: true }).waitFor();
  if (errors.length) throw Error(errors.join("; "));
  await page.evaluate(() =>
    document.body.setAttribute("data-signalgen-backtest-tests", "complete"),
  );
  return {
    synthetic: true,
    wasm: "real",
    widths: [1440, 390],
    themes: ["dark", "light"],
    rule: true,
    manual: true,
    cancelled: true,
    integrity: true,
    denied: true,
  };
}
