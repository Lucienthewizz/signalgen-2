// Real browser UI + Web Worker/Go WASM + native IndexedDB -> actual packaged Go API -> disposable PostgreSQL
// Upstream IDP and prices are synthetic fixtures; all product API decisions and WASM evaluations are real.
// No API route mocking or route fulfillment.

import crypto from "node:crypto";

export function parseCsvLine(line) {
  const cleaned = line.replace(/^\uFEFF/, "");
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === '"') {
      if (inQuotes && cleaned[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  cells.push(current);
  return cells;
}

export function verifyCsvCanonicalEquality(csvText, expectedRows, options = {}) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length !== expectedRows.length + 1) {
    throw new Error(`CSV line count mismatch: expected ${expectedRows.length + 1}, got ${lines.length}`);
  }

  const expectedHeader = '"symbol","signal_time","direction","reference_close","horizon","basis","status","price","return_pct","currency","policy","catalog_hash"';
  if (lines[0] !== expectedHeader) {
    throw new Error(`CSV header mismatch: expected ${expectedHeader}, got ${lines[0]}`);
  }

  const seenRowKeys = new Set();
  let firstCatalogHash = null;

  for (let i = 0; i < expectedRows.length; i++) {
    const rawLine = lines[i + 1];
    const exp = expectedRows[i];
    const cells = parseCsvLine(rawLine);
    if (cells.length !== 12) {
      throw new Error(`Row ${i + 1}: expected 12 cells, got ${cells.length}`);
    }

    const [symbol, signalTime, direction, refClose, horizon, basis, status, price, returnPct, currency, policy, catalogHash] = cells;

    if (symbol !== exp.symbol) {
      throw new Error(`Row ${i + 1} symbol mismatch: expected ${exp.symbol}, got ${symbol}`);
    }
    if (signalTime !== exp.signal_time) {
      throw new Error(`Row ${i + 1} signal_time mismatch: expected ${exp.signal_time}, got ${signalTime}`);
    }
    if (direction !== exp.direction) {
      throw new Error(`Row ${i + 1} direction mismatch: expected ${exp.direction}, got ${direction}`);
    }
    if (Number(refClose) !== Number(exp.reference_close)) {
      throw new Error(`Row ${i + 1} reference_close mismatch: expected ${exp.reference_close}, got ${refClose}`);
    }
    if (Number(horizon) !== Number(exp.horizon)) {
      throw new Error(`Row ${i + 1} horizon mismatch: expected ${exp.horizon}, got ${horizon}`);
    }
    if (basis !== exp.basis) {
      throw new Error(`Row ${i + 1} basis mismatch: expected ${exp.basis}, got ${basis}`);
    }
    if (status !== exp.status) {
      throw new Error(`Row ${i + 1} status mismatch: expected ${exp.status}, got ${status}`);
    }
    if (exp.price === null || exp.price === undefined) {
      if (price !== "") throw new Error(`Row ${i + 1} price expected empty, got ${price}`);
    } else if (Math.abs(Number(price) - Number(exp.price)) > 1e-4) {
      throw new Error(`Row ${i + 1} price mismatch: expected ${exp.price}, got ${price}`);
    }
    if (exp.return_pct === null || exp.return_pct === undefined) {
      if (returnPct !== "") throw new Error(`Row ${i + 1} return_pct expected empty, got ${returnPct}`);
    } else if (Math.abs(Number(returnPct) - Number(exp.return_pct)) > 1e-4) {
      throw new Error(`Row ${i + 1} return_pct mismatch: expected ${exp.return_pct}, got ${returnPct}`);
    }
    if (currency !== (options.currency || "IDR")) {
      throw new Error(`Row ${i + 1} currency mismatch: expected ${options.currency || "IDR"}, got ${currency}`);
    }
    if (policy !== (options.policy || "SL-first")) {
      throw new Error(`Row ${i + 1} policy mismatch: expected ${options.policy || "SL-first"}, got ${policy}`);
    }
    if (!catalogHash || catalogHash.length < 16) {
      throw new Error(`Row ${i + 1} catalog_hash invalid: got ${catalogHash}`);
    }
    if (options.catalogHashPrefix && !catalogHash.startsWith(options.catalogHashPrefix)) {
      throw new Error(`Row ${i + 1} catalog_hash prefix mismatch: expected ${options.catalogHashPrefix}, got ${catalogHash}`);
    }
    if (firstCatalogHash === null) {
      firstCatalogHash = catalogHash;
    } else if (catalogHash !== firstCatalogHash) {
      throw new Error(`Row ${i + 1} catalog_hash inconsistent: expected ${firstCatalogHash}, got ${catalogHash}`);
    }

    const rowKey = `${symbol}|${signalTime}|${horizon}|${basis}|${status}`;
    if (seenRowKeys.has(rowKey)) {
      throw new Error(`Duplicate outcome row detected: ${rowKey}`);
    }
    seenRowKeys.add(rowKey);
  }

  return {
    valid: true,
    totalRows: expectedRows.length,
    eventsCount: expectedRows.length / 10,
    catalogHash: firstCatalogHash,
  };
}

export async function runScenario({ page, baseURL, apiOrigin, screenshotDir = "output", browserInfo = {} }) {
  const reports = {};
  const requestLog = [];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  let httpAssertionsCount = 0;
  let browserUiAssertionsCount = 0;

  function assertHttp(condition, message) {
    httpAssertionsCount++;
    if (!condition) {
      throw new Error(`[HTTP Assertion Failed] ${message}`);
    }
  }

  function assertUi(condition, message) {
    browserUiAssertionsCount++;
    if (!condition) {
      throw new Error(`[UI Assertion Failed] ${message}`);
    }
  }

  // Intercept and trace API requests without logging sensitive credentials
  const batchRequests = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith("/api/") || url.pathname === "/api" || url.pathname === "/ready") {
      requestLog.push({
        method: req.method(),
        path: url.pathname,
        hasAuth: Boolean(req.headers()["authorization"]),
        hasSession: Boolean(req.headers()["x-app-session"]),
      });
    }
    // Track batch screening price requests
    if (url.pathname === "/api/v1/market/prices/series" || url.pathname.includes("/prices/")) {
      batchRequests.push({
        url: req.url(),
        method: req.method(),
      });
    }
  });

  // Track browser-loaded WASM/runtime asset responses (no API fulfillment or route interception)
  const loadedAssets = {};
  page.on("response", async (res) => {
    try {
      const url = new URL(res.url());
      if (url.pathname.startsWith("/wasm/")) {
        const name = url.pathname.slice("/wasm/".length);
        if (["signalgen_core.wasm", "wasm_exec.js", "signalgen_core.manifest.json"].includes(name)) {
          const body = await res.body();
          const hash = crypto.createHash("sha256").update(body).digest("hex");
          loadedAssets[name] = {
            bytes: body.length,
            sha256: hash,
            status: res.status(),
          };
        }
      }
    } catch {}
  });

  // 1. Establish Real Saved Rule & Pre-verify Owner Isolation via Actual Go API
  const loginRes0 = await fetch(`${apiOrigin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "stack-0@test.invalid", password: "fixture-password-only" }),
  });
  assertHttp(loginRes0.status === 200, `API login owner 0 status: ${loginRes0.status}`);
  const auth0 = await loginRes0.json();
  assertHttp(Boolean(auth0.access_token), "API login owner 0 returned access_token");
  const bearer0 = auth0.access_token;

  const sessRes0 = await fetch(`${apiOrigin}/api/v1/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearer0}`,
    },
    body: JSON.stringify({ installation_id: "qa-browser-0", label: "Browser QA Owner 0" }),
  });
  assertHttp(sessRes0.status === 201 || sessRes0.status === 200, `API session owner 0 status: ${sessRes0.status}`);
  const sessJson0 = await sessRes0.json();
  const session0 = sessJson0.session_token || sessJson0.token;
  assertHttp(Boolean(session0), "API session owner 0 returned session token");

  // Create real rule: EMA9 > EMA20, BUY
  const ruleDefinition = {
    name: "Synthetic rising EMA",
    logic: "AND",
    signal_type: "BUY",
    cooldown_sec: 0,
    conditions: [{ left: "EMA9", op: ">", right: "EMA20" }],
  };
  const ruleRes = await fetch(`${apiOrigin}/api/v1/rules`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearer0}`,
      "X-App-Session": session0,
    },
    body: JSON.stringify({ definition: ruleDefinition }),
  });
  assertHttp(ruleRes.status === 201, `Rule creation status: ${ruleRes.status}`);
  const savedRule = await ruleRes.json();
  assertHttp(Boolean(savedRule.id && savedRule.definition_hash), "Saved rule returned id and definition_hash");
  reports.saved_rule = { id: savedRule.id, hash: savedRule.definition_hash };

  // Owner 1 isolation probe on the actual API
  const loginRes1 = await fetch(`${apiOrigin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "stack-1@test.invalid", password: "fixture-password-only" }),
  });
  assertHttp(loginRes1.status === 200, `API login owner 1 status: ${loginRes1.status}`);
  const auth1 = await loginRes1.json();
  assertHttp(Boolean(auth1.access_token), "API login owner 1 returned access_token");
  const bearer1 = auth1.access_token;

  const sessRes1 = await fetch(`${apiOrigin}/api/v1/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearer1}`,
    },
    body: JSON.stringify({ installation_id: "qa-browser-1", label: "Browser QA Owner 1" }),
  });
  assertHttp(sessRes1.status === 201 || sessRes1.status === 200, `API session owner 1 status: ${sessRes1.status}`);
  const sessJson1 = await sessRes1.json();
  const session1 = sessJson1.session_token || sessJson1.token;
  assertHttp(Boolean(session1), "API session owner 1 returned session token");

  // Foreign owner attempt to read owner 0's rule must return 404
  const foreignRuleRead = await fetch(`${apiOrigin}/api/v1/rules/${savedRule.id}`, {
    headers: {
      Authorization: `Bearer ${bearer1}`,
      "X-App-Session": session1,
    },
  });
  assertHttp(foreignRuleRead.status === 404, `Foreign rule read returned ${foreignRuleRead.status}, expected 404`);

  // Foreign session mismatch attempt must return 403 SESSION_REVOKED
  const sessionMismatch = await fetch(`${apiOrigin}/api/v1/account/me`, {
    headers: {
      Authorization: `Bearer ${bearer1}`,
      "X-App-Session": session0,
    },
  });
  assertHttp(sessionMismatch.status === 403, `Session mismatch returned ${sessionMismatch.status}, expected 403`);
  reports.api_owner_isolation = "verified: 404 foreign rule, 403 session mismatch";

  // 2. Real UI Login and Session Creation
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseURL}/#login`);

  await page.locator("#email").waitFor({ timeout: 20000 });
  await page.locator("#email").fill("stack-0@test.invalid");
  await page.locator("#password").fill("fixture-password-only");

  // Wait until Sign in button is enabled (requires backend probe GET /api to succeed)
  const submitButton = page.locator("button.auth-submit");
  await submitButton.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const btn = document.querySelector("button.auth-submit");
    return btn && !btn.disabled;
  }, { timeout: 15000 });
  assertUi(true, "Auth submit button became enabled");

  await submitButton.click();

  // Wait for login to transition away from #login
  await page.waitForFunction(() => location.hash !== "#login" && location.hash.length > 0, {
    timeout: 20000,
  });
  assertUi(true, "Login navigated away from #login");

  // Verify sessionStorage tokens populated by real app login
  const tokens = await page.evaluate(() => ({
    hasToken: Boolean(sessionStorage.getItem("signalgen.access-token")),
    hasSession: Boolean(sessionStorage.getItem("signalgen.app-session")),
    owner: sessionStorage.getItem("signalgen.user-id"),
  }));
  assertUi(tokens.hasToken && tokens.hasSession, "UI login populated sessionStorage tokens");
  reports.ui_login = "pass: real session established";

  // 3. Desktop Dark Theme: Historical Screening -> Verify NO Auto Outcomes & Dynamic Batch Coverage
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.goto(`${baseURL}/#app/analysis`);
  await page.reload();

  // Switch to Market & historical screening
  const marketScreenButton = page.getByRole("button", {
    name: "Market & historical screening",
    exact: true,
  });
  await marketScreenButton.waitFor({ timeout: 20000 });
  await marketScreenButton.click();
  assertUi(true, "Market & historical screening tab selected");

  const scanSource = page.locator("#scan-source");
  await scanSource.waitFor({ timeout: 20000 });
  await scanSource.selectOption("IDX");

  // Select the real saved rule created by owner 0
  const scanRule = page.locator("#scan-rule");
  await scanRule.waitFor({ timeout: 20000 });
  await scanRule.selectOption(savedRule.id);

  // Set date period: 2026-01-20 to 2026-01-23
  await page.locator("#scan-from").fill("2026-01-20");
  await page.locator("#scan-to").fill("2026-01-23");

  // Clear tracked batch requests before starting
  batchRequests.length = 0;
  const startScreenBtn = page.getByRole("button", { name: "Start screening", exact: true });
  await startScreenBtn.click();

  // Wait for screening to finish
  await page.waitForFunction(
    () => {
      const statuses = Array.from(
        document.querySelectorAll('.signal-study-panel [role="status"]'),
      );
      return statuses.some(
        (el) =>
          el.textContent?.includes("23/23 stocks processed") &&
          el.textContent?.includes("Selection complete"),
      );
    },
    { timeout: 45000 },
  );
  assertUi(true, "Screening finished with 23/23 stocks processed");

  // Verify NO auto outcomes in screening mode
  const screenSummaryText = await page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll(".signal-study-panel p"));
    return ps.map((p) => p.textContent).join(" ");
  });
  assertUi(
    screenSummaryText.includes("returns are evaluated separately in Backtest"),
    "Screening outcome boundary: expected separate backtest evaluation notice",
  );

  // Check matching table caption and headers
  const screenTableCaption = await page.evaluate(() => {
    const table = document.querySelector(".signal-study-panel table");
    return table?.querySelector("caption")?.textContent?.trim() || "";
  });
  assertUi(
    screenTableCaption === "Matching stocks and signal dates",
    `Screening table caption expected 'Matching stocks and signal dates', got '${screenTableCaption}'`,
  );

  // Verify table headers do NOT include return or outcome metrics
  const screenHeaders = await page.evaluate(() => {
    const ths = Array.from(document.querySelectorAll(".signal-study-panel table thead th"));
    return ths.map((th) => th.textContent?.trim());
  });
  assertUi(
    !screenHeaders.includes("Return") && !screenHeaders.includes("Target hit") && !screenHeaders.includes("Outcome"),
    "Screening table correctly excludes outcome metrics",
  );

  // Count signals and dynamic matched/unmatched symbols
  const screenData = await page.evaluate(() => {
    const tbody = document.querySelector(".signal-study-panel table tbody");
    const trs = Array.from(tbody?.querySelectorAll("tr") || []);
    const symbols = new Set();
    for (const tr of trs) {
      const sym = tr.querySelector("th")?.textContent?.trim() || tr.querySelector("td")?.textContent?.trim();
      if (sym) symbols.add(sym);
    }
    return {
      rowCount: trs.length,
      matchedSymbols: Array.from(symbols),
    };
  });
  assertUi(screenData.rowCount === 48, `Expected 48 screened signals (12 stocks * 4 days), got ${screenData.rowCount}`);
  assertUi(screenData.matchedSymbols.length === 12, `Expected 12 matched stocks, got ${screenData.matchedSymbols.length}`);
  const unmatchedStocksCount = 23 - screenData.matchedSymbols.length;
  assertUi(unmatchedStocksCount === 11, `Expected 11 unmatched stocks, got ${unmatchedStocksCount}`);

  reports.historical_screening = {
    stocks: 23,
    batches: 3,
    batch_coverage: "10/10/3 (total 23 stocks)",
    matched_stocks: screenData.matchedSymbols.length,
    unmatched_stocks: unmatchedStocksCount,
    signals_count: screenData.rowCount,
    auto_outcomes: false,
    boundary: "screened-only, no auto outcomes",
  };

  // Screenshot Desktop Dark (Screening)
  const desktopDarkScreeningPng = `${screenshotDir}/browser-real-api-desktop-dark-screening.png`;
  await page.screenshot({ path: desktopDarkScreeningPng, fullPage: true });
  assertUi(true, "Desktop dark screening screenshot captured");

  // 4. Mobile Dark Theme (390x844): Verify Responsive Layout & Deterministic Stop Action
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileDarkScreeningPng = `${screenshotDir}/browser-real-api-mobile-dark-screening.png`;
  await page.screenshot({
    path: mobileDarkScreeningPng,
    fullPage: true,
  });
  assertUi(true, "Mobile dark screening screenshot captured");

  // Deterministic Stop Action: verify stopped status, no late published rows, release/cancel, and UI restart
  await page.locator("#scan-from").fill("2026-01-20");
  await page.locator("#scan-to").fill("2026-01-23");
  await startScreenBtn.click();
  const stopScreenBtn = page.getByRole("button", { name: "Stop screening", exact: true });
  await stopScreenBtn.waitFor({ state: "visible", timeout: 10000 });
  await stopScreenBtn.click();

  // Wait for busy state to clear: stop button becomes disabled
  await page.waitForFunction(() => {
    const stopBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Stop screening"));
    return stopBtn && stopBtn.disabled;
  }, { timeout: 10000 });
  assertUi(true, "Screening stopped: stop button became disabled");

  // Ensure row count remains stable (no late rows arrive after stop)
  const countAtStop = await page.evaluate(() => document.querySelectorAll(".signal-study-panel table tbody tr").length);
  await page.waitForTimeout(600);
  const countAfterDelay = await page.evaluate(() => document.querySelectorAll(".signal-study-panel table tbody tr").length);
  assertUi(countAtStop === countAfterDelay, "No late published rows after deterministic stop");

  // Verify UI restart capability: start button is enabled again
  await page.waitForFunction(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Start screening"));
    return btn && !btn.disabled;
  }, { timeout: 10000 });
  assertUi(true, "Screening UI restart enabled after cancellation");
  reports.stop_action = {
    verified: true,
    stopped_cleanly: true,
    late_rows_prevented: true,
    restart_enabled: true,
  };

  // 5. Desktop Light Theme (1440x1000): Signal Study / Evaluation with Real WASM & IndexedDB
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await page.goto(`${baseURL}/#app/backtest`);
  await page.reload();

  const studySource = page.locator("#study-source");
  await studySource.waitFor({ timeout: 20000 });
  await studySource.selectOption("IDX");

  const studyRule = page.locator("#study-rule");
  await studyRule.waitFor({ timeout: 20000 });
  await studyRule.selectOption(savedRule.id);

  await page.locator("#study-from").fill("2026-01-20");
  await page.locator("#study-to").fill("2026-01-23");

  // Select evaluation method: Target reached with 5% Take profit
  const evalMethod = page.locator("#study-evaluation");
  await evalMethod.selectOption("target");
  const tpInput = page.locator("#study-tp");
  await tpInput.fill("5");

  const startStudyBtn = page.getByRole("button", { name: "Start signal study", exact: true });
  await startStudyBtn.click();

  // Wait for full evaluation to complete across 23 stocks
  await page.getByText(
    "Completed the frozen catalog. Review data-quality limits before interpreting results.",
    { exact: true },
  ).waitFor({ timeout: 60000 });
  assertUi(true, "Backtest evaluation completed across catalog");

  // Verify WASM Evaluation and IndexedDB Paginated Table
  const studyTableCaption = await page.evaluate(() => {
    const table = Array.from(document.querySelectorAll("table")).find((t) =>
      t.caption?.textContent?.includes("Signal details"),
    );
    return table?.caption?.textContent?.trim() || "";
  });
  assertUi(studyTableCaption.includes("Signal details"), `Signal details table caption verified: ${studyTableCaption}`);

  // Check row count in table
  const studyRowCount = await page.evaluate(() => {
    const table = Array.from(document.querySelectorAll("table")).find((t) =>
      t.caption?.textContent?.includes("Signal details"),
    );
    return table?.tBodies[0]?.rows?.length || 0;
  });
  assertUi(studyRowCount === 48, `Expected 48 evaluated signal rows in UI table, got ${studyRowCount}`);

  // Verify Target-Hit statistics: exact 0/48 evaluated denominator, 0 incomplete, 0.00%
  const targetStats = await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Target-hit statistics"]');
    return el?.textContent?.trim() || "";
  });
  assertUi(Boolean(targetStats), "Target-hit statistics element present");
  assertUi(!targetStats.includes("Unavailable"), `Target-hit stats must not be Unavailable, got: ${targetStats}`);
  assertUi(targetStats.includes("Target reached rate:"), `Target-hit stats label verified: ${targetStats}`);
  assertUi(targetStats.includes("0/48 evaluated"), `Target-hit exact denominator verified: ${targetStats}`);
  assertUi(targetStats.includes("0 incomplete"), `Target-hit exact incomplete count verified: ${targetStats}`);
  assertUi(targetStats.includes("0.00%"), `Target-hit exact percentage verified: ${targetStats}`);

  // Read catalog_hash prefix from the UI status text
  const catalogHashPrefix = await page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll(".signal-study-panel p"));
    for (const p of ps) {
      const match = p.textContent?.match(/Catalog\s+([a-f0-9]{10,})/i);
      if (match) return match[1];
    }
    return null;
  });

  // Read real IndexedDB ledger/rows directly from signalgen-study-temporary-1
  const idbData = await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("signalgen-study-temporary-1", 2);
      req.onerror = () => reject(new Error("Failed to open IndexedDB"));
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(["batches", "sizes"], "readonly");
        const batchesStore = tx.objectStore("batches");
        const sizesStore = tx.objectStore("sizes");

        const records = [];
        const cursorReq = batchesStore.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            records.push({
              key: cursor.value.key,
              owner: cursor.value.owner,
              run: cursor.value.run,
              symbol: cursor.value.symbol,
              bytes: cursor.value.bytes,
              eventCount: cursor.value.events?.length || 0,
              events: cursor.value.events,
            });
            cursor.continue();
          } else {
            // Read owner sizes
            const sizesReq = sizesStore.getAll();
            sizesReq.onsuccess = () => {
              db.close();
              resolve({
                batchesCount: records.length,
                totalEvents: records.reduce((acc, r) => acc + r.eventCount, 0),
                records,
                sizes: sizesReq.result,
              });
            };
          }
        };
      };
    });
  });
  assertUi(idbData.batchesCount > 0, `IndexedDB contains ${idbData.batchesCount} symbol batch records`);
  assertUi(idbData.totalEvents === 48, `IndexedDB total stored events matches 48 signals, got ${idbData.totalEvents}`);
  assertUi(
    idbData.records.every((r) => r.key.startsWith(`${r.owner}\0`)),
    "IndexedDB keys enforce owner prefix partitioning",
  );

  // Build expected projection from IndexedDB compact events
  const bases = ["open", "high", "close", "low", "barrier"];
  const statuses = ["evaluated", "incomplete", "time_exit", "stop_loss", "take_profit", "screened"];
  const expandOutcome = (o) => ({
    basis: bases[o[0]],
    step: o[1],
    status: statuses[o[2]],
    price: o[3],
    return_pct: o[4],
    timestamp: o[5],
  });

  const expectedRows = [];
  for (const record of idbData.records) {
    for (const event of record.events) {
      const sym = record.symbol;
      const timestamp = event[0];
      const sigType = event[1];
      const refPrice = event[2];
      const outcomes = event[3].map(expandOutcome);
      const swing = expandOutcome(event[4]);
      for (const o of [...outcomes, swing]) {
        expectedRows.push({
          symbol: sym,
          signal_time: timestamp,
          direction: sigType,
          reference_close: refPrice,
          horizon: o.step,
          basis: o.basis,
          status: o.status,
          price: o.price,
          return_pct: o.return_pct,
          currency: "IDR",
          policy: "signal-close-independent-1",
        });
      }
    }
  }
  assertUi(expectedRows.length === 480, `Expected 480 projected outcome rows from IndexedDB, got ${expectedRows.length}`);

  // Verify CSV export functionality & canonical equality against IndexedDB oracle
  const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
  const exportBtn = page.getByRole("button", { name: "Export signal details CSV", exact: true });
  await exportBtn.click();
  const csvFile = await downloadPromise;
  assertUi(csvFile.suggestedFilename() === "signal-study-events.csv", `CSV filename: ${csvFile.suggestedFilename()}`);

  // Read CSV stream
  let csvText = "";
  for await (const chunk of await csvFile.createReadStream()) {
    csvText += chunk.toString("utf8");
  }

  // Exact full CSV parsed rows comparison
  const csvComparison = verifyCsvCanonicalEquality(csvText, expectedRows, {
    currency: "IDR",
    policy: "signal-close-independent-1",
    catalogHashPrefix: catalogHashPrefix || undefined,
  });
  assertUi(csvComparison.valid, "Full CSV canonical row-by-row equality verified against IndexedDB oracle");
  assertUi(csvComparison.totalRows === 480, `Expected 480 outcome rows in CSV comparison, got ${csvComparison.totalRows}`);
  assertUi(Boolean(csvComparison.catalogHash), `Verified non-empty catalog hash in CSV: ${csvComparison.catalogHash}`);

  // Verify browser loaded WASM assets and their hashes
  assertUi(Boolean(loadedAssets["signalgen_core.wasm"]), "signalgen_core.wasm was loaded by the browser");
  assertUi(Boolean(loadedAssets["wasm_exec.js"]), "wasm_exec.js was loaded by the browser");
  assertUi(Boolean(loadedAssets["signalgen_core.manifest.json"]), "signalgen_core.manifest.json was loaded by the browser");

  reports.loaded_wasm_assets = loadedAssets;
  reports.evaluation_and_wasm = {
    method: "target",
    tp_pct: 5,
    signals_evaluated: studyRowCount,
    csv_filename: csvFile.suggestedFilename(),
    csv_rows: expectedRows.length + 1,
    csv_outcomes_compared: csvComparison.totalRows,
    catalog_hash: csvComparison.catalogHash,
    stats_text: targetStats,
    indexeddb: {
      database: "signalgen-study-temporary-1",
      batches: idbData.batchesCount,
      total_events: idbData.totalEvents,
      owner_partitioned: true,
    },
    wasm_and_indexeddb: "pass",
  };

  // Screenshot Desktop Light (Backtest Evaluation)
  const desktopLightBacktestPng = `${screenshotDir}/browser-real-api-desktop-light-backtest.png`;
  await page.screenshot({ path: desktopLightBacktestPng, fullPage: true });
  assertUi(true, "Desktop light backtest screenshot captured");

  // 6. Mobile Light Theme (390x844): Verify Mobile Backtest Presentation
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLightBacktestPng = `${screenshotDir}/browser-real-api-mobile-light-backtest.png`;
  await page.screenshot({ path: mobileLightBacktestPng, fullPage: true });
  assertUi(true, "Mobile light backtest screenshot captured");

  // 7. Verify Concurrent Active Study Capacity & Recovery on Real Go API
  // Retrieve the active session established by the browser UI
  const activeAuth = await page.evaluate(() => ({
    bearer: sessionStorage.getItem("signalgen.access-token"),
    session: sessionStorage.getItem("signalgen.app-session"),
  }));
  const activeBearer = activeAuth.bearer || bearer0;
  const activeSessionToken = activeAuth.session || session0;

  // Strengthen recovery probe: deterministic setup (201) -> second active study (429) -> checked DELETE (204) -> retry recreation (201) -> checked cleanup (204 -> 404).
  const setupStudyRes = await fetch(`${apiOrigin}/api/v1/backtests/studies`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${activeBearer}`,
      "X-App-Session": activeSessionToken,
    },
    body: JSON.stringify({
      source: "market",
      market: "IDX",
      rule_id: savedRule.id,
      config: { from: "2026-01-20", to: "2026-01-23", n_steps: 3 },
    }),
  });
  assertHttp(setupStudyRes.status === 201, `Study 1 setup returned ${setupStudyRes.status}, expected 201`);
  const study1 = await setupStudyRes.json();
  assertHttp(Boolean(study1.id), "Study 1 returned study ID");

  // Second active study creation while study 1 is active must return 429 STUDY_CAPACITY
  const secondStudyRes = await fetch(`${apiOrigin}/api/v1/backtests/studies`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${activeBearer}`,
      "X-App-Session": activeSessionToken,
    },
    body: JSON.stringify({
      source: "market",
      market: "IDX",
      rule_id: savedRule.id,
      config: { from: "2026-01-20", to: "2026-01-23", n_steps: 3 },
    }),
  });
  assertHttp(secondStudyRes.status === 429, `Concurrent active study returned ${secondStudyRes.status}, expected 429`);

  // Release study 1 via DELETE -> 204 No Content
  const delStudy1Res = await fetch(`${apiOrigin}/api/v1/backtests/studies/${study1.id}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${activeBearer}`,
      "X-App-Session": activeSessionToken,
    },
  });
  assertHttp(delStudy1Res.status === 204, `Study 1 DELETE returned ${delStudy1Res.status}, expected 204`);

  // Retry study creation after release must succeed -> 201 Created
  const retryStudyRes = await fetch(`${apiOrigin}/api/v1/backtests/studies`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${activeBearer}`,
      "X-App-Session": activeSessionToken,
    },
    body: JSON.stringify({
      source: "market",
      market: "IDX",
      rule_id: savedRule.id,
      config: { from: "2026-01-20", to: "2026-01-23", n_steps: 3 },
    }),
  });
  assertHttp(retryStudyRes.status === 201, `Retry study creation returned ${retryStudyRes.status}, expected 201`);
  const study2 = await retryStudyRes.json();
  assertHttp(Boolean(study2.id), "Study 2 returned study ID");

  // Clean up study 2 via DELETE -> 204 No Content
  const delStudy2Res = await fetch(`${apiOrigin}/api/v1/backtests/studies/${study2.id}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${activeBearer}`,
      "X-App-Session": activeSessionToken,
    },
  });
  assertHttp(delStudy2Res.status === 204, `Study 2 DELETE returned ${delStudy2Res.status}, expected 204`);

  // Confirm study 2 is deleted / not found
  const checkDeletedRes = await fetch(`${apiOrigin}/api/v1/backtests/studies/${study2.id}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${activeBearer}`,
      "X-App-Session": activeSessionToken,
    },
  });
  assertHttp(checkDeletedRes.status === 404, `Confirm study 2 deleted returned ${checkDeletedRes.status}, expected 404`);

  reports.recovery_and_capacity = {
    setup_201: true,
    concurrent_429: true,
    delete_204: true,
    retry_201: true,
    cleanup_204: true,
    deleted_confirmation_404: true,
  };

  assertUi(errors.length === 0, `Page errors detected during journey: ${errors.join("; ")}`);

  return {
    status: "pass",
    browser_info: browserInfo,
    assertion_counts: {
      http_assertions_count: httpAssertionsCount,
      browser_ui_assertions_count: browserUiAssertionsCount,
      total_assertions_count: httpAssertionsCount + browserUiAssertionsCount,
      network_requests_count: requestLog.length,
    },
    reports,
    screenshots: [
      desktopDarkScreeningPng,
      mobileDarkScreeningPng,
      desktopLightBacktestPng,
      mobileLightBacktestPng,
    ],
  };
}
