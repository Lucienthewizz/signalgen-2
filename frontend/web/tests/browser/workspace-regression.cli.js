async (page) => {
  // All API responses and account state are synthetic. Never call a real account.
  const user = { id: "11111111-1111-4111-8111-111111111111", full_name: "Akun pengujian", email: "fixture@example.test", role: "operator", status: "active" };
  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  const definition = { name: "Rule fixture", logic: "AND", signal_type: "BUY", cooldown_sec: 0, conditions: [{ left: "PRICE", op: ">", right: "EMA20" }] };
  const rule = { id: "fixture-rule", name: definition.name, owner_type: "user", read_only: false, version: 2, definition_hash: "fixture-hash", schema_version: "rule-1", engine_version: "core-0.3.0", definition };
  const universe = { id: "fixture-universe", name: "Bank pilihan", version: 1, symbols: ["BBCA.JK", "BBRI.JK"] };
  const rows = [true, false].map((matched, i) => ({ decision: { symbol: universe.symbols[i], timestamp: now, matched, reason_codes: [matched ? "RULE_MATCHED" : "CONDITIONS_NOT_MET"] }, features: { price: 100 + i, ema9: 95, ema20: 98, rsi14: 60 }, latestOpen: 95, latestClose: 100 + i }));
  const run = { rows, latestDecision: rows[0].decision, features: rows[0].features, latestOpen: 95, latestClose: 100, result: { type: "screener.result", protocol: "screener-private-1", request_id: "fixture-request", decision_version: "fixture-decision", results: rows.map(row => row.decision) }, manifest: { dataset_id: "fixture-dataset", version: "1", schema_version: "ohlcv-multi-1", provider: "yahoo_finance", purpose: "screen", market: "IDX", currency: "IDR", symbols: universe.symbols, timeframe: "1d", timezone: "UTC", requested_range: { from: day, to: day }, available_range: { from: day, to: day }, warmup_candles: 20, adjustment: "split", candle_count: 100, decoded_bytes: 1000, checksum: "fixture-checksum", quality: { status: "complete", warnings: [] } }, execution: "client_wasm+server_private_scoring" };
  const before = JSON.parse(JSON.stringify(run));
  before.rows.forEach(row => { row.decision.matched = !row.decision.matched; });
  const context = { ruleId: rule.id, universeId: universe.id, universeName: universe.name, ruleSnapshot: { version: rule.version, definition_hash: rule.definition_hash, definition } };
  const history = [ { rule: rule.name, recordedAt: now, context, run }, { rule: rule.name, recordedAt: new Date(Date.now() - 86400000).toISOString(), context, run: before } ];
  const plans = ["free", "analyst", "pro"].map((code, i) => ({ code, name: ["Free", "Analyst", "Pro"][i], features: i ? ["screener", "backtest"] : [], limits: { custom_rules: [0, 10, 50][i], stock_universes: [5, 5, 20][i] } }));
  const subscription = { plan_code: "pro", plan_name: "Pro", status: "active", features: ["screener", "backtest"], source: "manual", current_period_start: now, current_period_end: new Date(Date.now()+30*86400000).toISOString(), cancel_at_period_end: false };
  let unauthorized = false;
  let systemRule = false;
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(({ user, history }) => {
    sessionStorage.setItem("signalgen.access-token", "fixture-not-a-real-token");
    sessionStorage.setItem("signalgen.app-session", "fixture-not-a-real-session");
    sessionStorage.setItem("signalgen.app-session-origin", "same-origin");
    localStorage.setItem(`signalgen:workspace:v1:${user.id}:monitor-history`, JSON.stringify({ version: 1, savedAt: Date.now(), data: history }));
  }, { user, history });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    const p = url.pathname;
    if (p !== "/api" && !p.startsWith("/api/") && p !== "/ready") return route.continue();
    if (unauthorized && p === "/api/v1/account/me") return route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED", message: "Fixture session expired" } } });
    let payload;
    if (p === "/api" || p === "/ready") payload = { status: "ready", name: "Fixture API", version: "test" };
    else if (p === "/api/auth/me") payload = user;
    else if (p === "/api/v1/account/me") payload = { user, features: ["screener", "backtest"], session: { id: "fixture", expires_at: subscription.current_period_end }, device: { installation_id: "fixture", label: "Fixture browser", current: true }, capabilities_version: "fixture" };
    else if (p === "/api/v1/rules") payload = { items: [systemRule ? { ...rule, name: "Default Scalping", owner_type: "system", definition: undefined } : rule], next_cursor: null };
    else if (p === "/api/v1/stock-universes") payload = { items: [universe] };
    else if (p === "/api/v1/stocks") payload = { items: universe.symbols.map(symbol => ({ symbol, name: symbol })) };
    else if (p === "/api/v1/subscription") payload = { subscription };
    else if (p === "/api/v1/subscription/plans") payload = { items: plans };
    else if (p === "/api/v1/subscription/usage") payload = { limits: plans[2].limits, used: { custom_rules: 1, stock_universes: 1 } };
    else if (p === "/api/v1/workspace") payload = { items: [{ kind: "monitor-history", data: history, version: 1, updated_at: now }] };
    else if (p.startsWith("/api/v1/workspace/")) { const body = route.request().postDataJSON(); payload = { kind: p.split("/").at(-1), data: body.data, version: body.version + 1, updated_at: now }; }
    else if (p === "/api/news") payload = { articles: [{ title: "BBCA: berita fixture", url: "https://example.test/news", published_at: now }] };
    else payload = { items: [] };
    return route.fulfill({ json: payload });
  });
  await page.goto("http://127.0.0.1:5174/#app/analysis");
  await page.reload();
  await page.getByRole("button", { name: "Ekspor CSV" }).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "BBCA", exact: true }).click({ timeout: 5000 });
  await page.getByRole("heading", { name: /Bukti kondisi/ }).waitFor({ timeout: 5000 });
  if (!await page.getByText("rule versi 2", { exact: false }).count()) throw Error("Frozen evidence version missing");
  await page.getByRole("button", { name: "Tutup detail" }).click({ timeout: 5000 });
  await page.getByText("Riwayat screening (2)", { exact: true }).click({ timeout: 5000 });
  await page.getByLabel("Perbandingan riwayat", { exact: true }).waitFor({ timeout: 5000 });
  const comparison = await page.locator(".screener-comparison").innerText();
  if (!comparison.includes("BBCA") || !comparison.includes("BBRI")) throw Error("Run comparison missing");
  const download = page.waitForEvent("download", { timeout: 5000 });
  await page.getByRole("button", { name: "Ekspor CSV" }).click({ timeout: 5000 });
  if ((await download).suggestedFilename() !== "signalgen-screening.csv") throw Error("CSV download failed");
  await page.goto("http://127.0.0.1:5174/#app/realtime");
  await page.getByLabel("Urutkan tabel", { exact: true }).click({ timeout: 5000 });
  await page.getByRole("option", { name: "Perubahan buka–tutup tertinggi", exact: true }).click({ timeout: 5000 });
  if (!((await page.locator(".monitor-ledger tbody tr").first().innerText()).includes("BBRI"))) throw Error("Monitor change sort failed");
  if (await page.locator(".monitor-chart h3").innerText() !== "BBCA") throw Error("Sort changed selected chart");
  if (!((await page.locator(".monitor-change").first().innerText()).includes("%"))) throw Error("Missing open-close percentage");
  const routes = ["overview", "analysis", "rules", "universes", "journal", "realtime", "news", "access", "subscription", "operator"];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (let theme = 0; theme < 2; theme++) {
      for (const view of routes) {
        await page.goto(`http://127.0.0.1:5174/#app/${view}`);
        await page.locator(".demo-workbench").waitFor({ timeout: 10000 });
        await page.locator(".route-loading").waitFor({ state: "hidden", timeout: 10000 });
        const close = page.getByRole("button", { name: "Close menu" });
        const bounds = await close.boundingBox();
        if (bounds && bounds.x >= 0 && bounds.x + bounds.width <= width) await close.click({ timeout: 5000 });
        await page.screenshot({ path: `/private/tmp/signalgen-${view}-${width}-${theme}.png`, animations: "disabled", timeout: 10000 });
        if (view === "realtime") await page.locator(".monitor-ledger").screenshot({ path: `/private/tmp/signalgen-monitor-table-${width}-${theme}.png`, animations: "disabled", timeout: 10000 });
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error(`Overflow: ${view} ${width}`);
        if (view === "analysis") {
          const offset = await page.evaluate(() => {
            const note = document.querySelector(".screener-result-count");
            const label = document.querySelector(".screener-result-filters label");
            if (!note || !label) return 0;
            const range = document.createRange(); range.selectNodeContents(note);
            return Math.abs(range.getBoundingClientRect().x - label.getBoundingClientRect().x);
          });
          if (offset > 2) throw Error(`Misaligned screener explanation: ${offset}px`);
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
      }
      await page.getByRole("button", { name: /Switch to .* mode/ }).click({ timeout: 5000 });
    }
    await page.getByRole("button", { name: "Open workspace menu", exact: true }).click({ timeout: 5000 });
    await page.getByRole("button", { name: "Rules", exact: true }).click({ timeout: 5000 });
    const stillOpen = await page.getByRole("button", { name: "Close menu", exact: true }).boundingBox();
    if (!stillOpen || stillOpen.x < 0) throw Error(`Navigation collapsed sidebar at ${width}`);
    await page.getByRole("button", { name: "Close menu", exact: true }).click({ timeout: 5000 });
  }
  await page.goto("http://127.0.0.1:5174/#account");
  await page.locator("main").waitFor({ timeout: 10000 });
  await page.screenshot({ path: "/private/tmp/signalgen-account.png", animations: "disabled", timeout: 10000 });
  systemRule = true;
  await page.goto("http://127.0.0.1:5174/#app/analysis");
  await page.getByText("Kondisi rule sistem diperiksa oleh server.", { exact: true }).waitFor({ timeout: 10000 });
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (let theme = 0; theme < 2; theme++) {
      await page.locator(".screener-run-summary").screenshot({ path: `/private/tmp/signalgen-summary-${width}-${theme}.png`, animations: "disabled", timeout: 10000 });
      if (width >= 900) {
        const difference = await page.locator(".screener-run-summary").evaluate(el => { const title = el.querySelector("strong").getBoundingClientRect(), button = el.querySelector("button").getBoundingClientRect(); return Math.abs(title.y + title.height / 2 - button.y - button.height / 2); });
        if (difference > 2) throw Error(`Misaligned screener title/action: ${difference}px`);
      }
      await page.getByRole("button", { name: /Switch to .* mode/ }).click({ timeout: 5000 });
    }
  }
  await page.goto("http://127.0.0.1:5174/#app/subscription");
  await page.getByRole("heading", { name: "Penggunaan kuota", exact: true }).waitFor({ timeout: 10000 });
  const backtest = page.locator('.subscription-feature-grid [data-slot="card"]').filter({ hasText: "Akses backtest" });
  if (!(await backtest.innerText()).includes("Belum tersedia")) throw Error("Backtest incorrectly presented as usable");
  const manage = page.locator(".subscription-manage--account");
  await manage.locator("summary").click({ timeout: 5000 });
  if (!await manage.getByRole("button", { name: "Batalkan sekarang", exact: true }).isVisible()) throw Error("Manage disclosure does not reveal controls");
  await manage.locator("summary").click({ timeout: 5000 });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (let theme = 0; theme < 2; theme++) {
      await page.locator(".subscription-current").screenshot({ path: `/private/tmp/signalgen-access-${width}-${theme}.png`, animations: "disabled", timeout: 10000 });
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error("Subscription overflow");
      const inset = await page.locator(".subscription-current").evaluate(el => {
        const outer = el.getBoundingClientRect(), inner = el.querySelector(".subscription-ledger__lead").getBoundingClientRect();
        return { left: inner.left - outer.left, right: outer.right - inner.right, radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) };
      });
      if (inset.left < 16 || inset.right < 16 || inset.radius < 12) throw Error("Subscription cards lack rounded inset container");
      await page.getByRole("button", { name: /Switch to .* mode/ }).click({ timeout: 5000 });
    }
  }
  unauthorized = true;
  await page.goto("http://127.0.0.1:5174/#app/analysis");
  await page.waitForURL("**/#login", { timeout: 10000 });
  if (await page.evaluate(() => sessionStorage.getItem("signalgen.access-token"))) throw Error("401 retained auth");
  for (const route of ["home", "creators", "login", "register", "forgot-password", "reset-password"]) {
    await page.goto(`http://127.0.0.1:5174/#${route}`);
    await page.locator("main").waitFor({ timeout: 10000 });
    await page.locator(".route-loading").waitFor({ state: "hidden", timeout: 10000 });
    await page.screenshot({ path: `/private/tmp/signalgen-public-${route}.png`, animations: "disabled", timeout: 10000 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error(`Public page overflow: ${route}`);
  }
  if (errors.length) throw Error(errors.join("; "));
}
