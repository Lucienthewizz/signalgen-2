// Synthetic account/API/socket boundaries; real application, crypto and Go/WASM.
async (page) => {
  const origin = new URL(page.url()).origin;
  await page.emulateMedia({ reducedMotion: "reduce" });
  const user = {
    id: "11111111-1111-4111-8111-111111111119",
    email: "monitor@example.test",
    full_name: "Monitor fixture",
    role: "user",
    status: "active",
  };
  const rule = {
    id: "monitor-rule",
    name: "Monitor rule",
    owner_type: "user",
    read_only: false,
    version: 1,
    definition_hash: "monitor-hash",
    schema_version: "signal-baseline-1",
    engine_version: "core-0.5.0",
    definition: {
      name: "Monitor rule",
      logic: "AND",
      signal_type: "BUY",
      cooldown_sec: 0,
      conditions: [{ left: "PRICE", op: ">", right: 1 }],
    },
  };
  const universe = {
    id: "univ_monitor",
    name: "Monitor stocks",
    symbols: ["BBCA.JK"],
    version: 1,
  };
  let revision = 0,
    prepares = 0,
    grants = 0,
    sockets = 0,
    hold = false,
    release;
  let providerFailure = "";
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    sessionStorage.setItem("signalgen.access-token", "synthetic-monitor-only");
    sessionStorage.setItem("signalgen.app-session", "synthetic-app-session");
    sessionStorage.setItem("signalgen.app-session-origin", "same-origin");
  });
  const contents = new Map();
  async function snapshot(timeframe) {
    const seconds = {
      "1m": 60,
      "5m": 300,
      "15m": 900,
      "1h": 3600,
      "1d": 86400,
    }[timeframe];
    const start =
      Date.parse("2026-10-16T02:00:00Z") + revision * seconds * 1000;
    const candles = Array.from({ length: 100 }, (_, i) => ({
      timestamp: new Date(start + i * seconds * 1000).toISOString(),
      open: 100 + i,
      high: 102 + i,
      low: 99 + i,
      close: 101 + i,
      volume: 1000,
    }));
    const data = {
      schema_version: "ohlcv-multi-1",
      purpose: "screen",
      market: "IDX",
      currency: "IDR",
      timeframe,
      timezone: "UTC",
      adjustment: "none",
      series: [{ symbol: "BBCA.JK", timezone: "UTC", candles }],
    };
    const text = JSON.stringify(data);
    const bytes = new TextEncoder().encode(text);
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
    const id = `monitor-${timeframe}-${revision}`;
    const manifest = {
      dataset_id: id,
      version: String(revision),
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      schema_version: "ohlcv-multi-1",
      provider: "yahoo_finance",
      purpose: "screen",
      market: "IDX",
      currency: "IDR",
      symbols: ["BBCA.JK"],
      exchanges: ["XIDX"],
      timeframe,
      timezone: "UTC",
      requested_range: { from: "2026-10-13", to: "2026-10-20" },
      available_range: {
        from: candles[0].timestamp.slice(0, 10),
        to: candles.at(-1).timestamp.slice(0, 10),
      },
      available_timestamp_range: {
        from: candles[0].timestamp,
        to: candles.at(-1).timestamp,
      },
      requested_timestamp_range: {
        from: "2026-10-13T00:00:00Z",
        to: "2026-10-20T00:00:00Z",
      },
      warmup_candles: 20,
      adjustment: "none",
      candle_count: 100,
      decoded_bytes: bytes.length,
      checksum,
      quality: { status: "complete", warnings: ["Synthetic intraday fixture"] },
    };
    contents.set(id, { manifest, text });
    return manifest;
  }
  await page.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      p = url.pathname;
    if (url.origin !== origin) return route.abort();
    if (p !== "/api" && !p.startsWith("/api/") && p !== "/ready")
      return route.continue();
    let payload;
    if (p === "/api" || p === "/ready")
      payload = { status: "ready", name: "Synthetic API", version: "0.11.0" };
    else if (p === "/api/auth/me") payload = user;
    else if (p === "/api/v1/account/me")
      payload = {
        user,
        features: ["screener"],
        session: {
          id: "monitor-session",
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        },
        device: { installation_id: "monitor", current: true },
        capabilities_version: "capabilities-4",
      };
    else if (p === "/api/v1/rules") payload = { items: [rule] };
    else if (p === `/api/v1/rules/${rule.id}`) payload = rule;
    else if (p === "/api/v1/stock-universes") payload = { items: [universe] };
    else if (p === "/api/v1/workspace") payload = { items: [] };
    else if (p.startsWith("/api/v1/workspace/"))
      payload = {
        kind: p.split("/").at(-1),
        data: request.postDataJSON()?.data ?? {},
        version: 1,
        updated_at: new Date().toISOString(),
      };
    else if (p === "/api/v1/datasets/prepare") {
      prepares++;
      if (providerFailure)
        return route.fulfill({
          status: providerFailure === "PROVIDER_UNAVAILABLE" ? 503 : 422,
          headers:
            providerFailure === "PROVIDER_UNAVAILABLE"
              ? { "Retry-After": "600" }
              : {},
          json: {
            error: {
              code: providerFailure,
              message: "Synthetic provider failure",
            },
          },
        });
      if (hold) await new Promise((resolve) => (release = resolve));
      payload = await snapshot(request.postDataJSON().timeframe ?? "1d");
    } else if (p.match(/^\/api\/v1\/datasets\/[^/]+\/manifest$/))
      payload = contents.get(p.split("/")[4]).manifest;
    else if (p.match(/^\/api\/v1\/datasets\/[^/]+\/content$/))
      return route.fulfill({
        contentType: "application/json",
        body: contents.get(p.split("/")[4]).text,
      });
    else if (p === "/api/v1/compute-grants") {
      grants++;
      payload = {
        id: "monitor-grant",
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      };
    } else if (p === "/api/v1/screener/socket-tickets")
      payload = {
        ticket: "synthetic-monitor-ticket",
        websocket_path: "/api/v1/screener/ws",
        protocol: "screener-private-1",
        feature_schema_version: "screener-features-1",
        max_candidates: 1000,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      };
    else
      return route.fulfill({
        status: 404,
        json: { error: { code: "UNMOCKED_FIXTURE", message: p } },
      });
    try {
      return await route.fulfill({ json: payload });
    } catch (error) {
      if (!hold) throw error;
    }
  });
  await page.routeWebSocket("**/api/v1/screener/ws**", (ws) => {
    sockets++;
    ws.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      ws.send(
        JSON.stringify({
          type: "screener.result",
          protocol: "screener-private-1",
          request_id: message.request_id,
          decision_version: "decision-1",
          results: message.candidates.map((candidate) => ({
            symbol: candidate.symbol,
            timestamp: candidate.timestamp,
            matched: true,
            signal_type: "BUY",
            reason_codes: ["RULE_MATCHED"],
          })),
        }),
      );
    });
  });
  const wait = async (predicate, label) => {
    for (let i = 0; i < 150; i++) {
      if (await predicate()) return;
      await page.waitForTimeout(50);
    }
    throw Error(label);
  };
  await page.goto(`${origin}/#app/analysis`);
  await page.reload();
  await page
    .getByRole("button", { name: "Start screening", exact: true })
    .waitFor({ timeout: 15000 });
  await page.clock.install();
  await page
    .getByRole("button", { name: "Start screening", exact: true })
    .click();
  await page
    .getByText("Waiting for new completed candles", { exact: true })
    .waitFor({ timeout: 15000 });
  if (grants !== 1 || sockets !== 1)
    throw Error(`First cycle grants=${grants} sockets=${sockets}`);
  if (!(await page.locator("#screen-interval").isDisabled()))
    throw Error("Interval not locked while monitoring");
  await page
    .getByRole("button", { name: "Monitoring details", exact: true })
    .click();
  const monitorDialog = page.getByRole("dialog", {
    name: "Monitoring details",
    exact: true,
  });
  await monitorDialog.waitFor();
  if (!(await monitorDialog.innerText()).includes("Actual data (5m, UTC)"))
    throw Error("Actual candle range missing");
  await monitorDialog
    .getByRole("button", { name: "Close", exact: true })
    .click();
  const initialPrepares = prepares;
  const correctOrder = await page.evaluate(() => {
    const results = document.querySelector('.screener-results'), history = document.querySelector('.screener-history'), data = document.querySelector('.screener-technical');
    return Boolean(results && history && data && (results.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING) && (history.compareDocumentPosition(data) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  if (!correctOrder) throw Error('History must sit below results and above Data information');
  if (await page.locator('.screener-results__header .screener-result-actions').count()) throw Error('Result actions must not be in the heading');
  const resultBar = page.locator('.screener-result-statusbar');
  if (await resultBar.getByRole('button', {name:/View data quality/}).count() !== 1 || await resultBar.getByRole('button', {name:'Export CSV', exact:true}).count() !== 1) throw Error('Quality and CSV must be beside the lower status filters');
  await page.clock.fastForward(300001);
  await wait(() => prepares > initialPrepares, "Next cycle did not run");
  await page
    .getByText("Waiting for new completed candles", { exact: true })
    .waitFor();
  if (grants !== 1 || sockets !== 1) throw Error("Unchanged data was rescored");
  if (!(await page.getByText("Screening history (1)", { exact: true }).count()))
    throw Error("Unchanged snapshot duplicated history");
  revision++;
  await page.clock.fastForward(300001);
  await wait(() => grants === 2, "New candle did not reach scoring");
  await page
    .getByText("Waiting for new completed candles", { exact: true })
    .waitFor();
  if (!(await page.getByText("Screening history (2)", { exact: true }).count()))
    throw Error("New candle missing from history");
  await page.getByText("Screening history (2)", { exact: true }).click();
  await page.locator("#history-interval").click();
  await page.getByRole("option", { name: "Daily", exact: true }).click();
  await page
    .getByText("No saved screens match these filters.", { exact: true })
    .waitFor();
  await page.locator("#history-interval").click();
  await page.getByRole("option", { name: "5 minutes", exact: true }).click();
  await page.getByText("2 of 2 saved screens", { exact: true }).waitFor();
  await page.getByText("Screening history (2)", { exact: true }).click();
  await page.getByRole("button", { name: /View data quality/ }).click();
  const qualityDialog = page.getByRole("dialog", {
    name: "Data quality",
    exact: true,
  });
  await qualityDialog.waitFor();
  if (!(await qualityDialog.innerText()).includes("Total supplied candles"))
    throw Error("Data quality does not explain candle totals");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (let theme = 0; theme < 1; theme++) {
      const bounds = await qualityDialog.boundingBox();
      if (
        !bounds ||
        bounds.x < 0 ||
        bounds.x + bounds.width > width + 1 ||
        Math.abs(bounds.x + bounds.width / 2 - width / 2) > 2
      )
        throw Error("Quality dialog is not centered or overflows");
      await page.screenshot({
        path: `output/playwright/screener-quality-${width}-${theme}.png`,
      });
      await page.evaluate(
        () =>
          (document.documentElement.dataset.theme =
            document.documentElement.dataset.theme === "light"
              ? "dark"
              : "light"),
      );
    }
  }
  await page.keyboard.press("Escape");
  await qualityDialog.waitFor({ state: "hidden" });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.clock.runFor(300);
    for (let theme = 0; theme < 1; theme++) {
      if (
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        )
      )
        throw Error(`Monitor layout overflow at ${width}`);
      await page.screenshot({
        path: `output/playwright/intraday-monitor-${width}-${theme}.png`,
        fullPage: true,
      });
      await resultBar.screenshot({path:`output/playwright/screener-result-actions-${width}-${theme}.png`});
      await page.locator('.screener-monitor-status').screenshot({path:`output/playwright/screener-controls-${width}-${theme}.png`});
      if (await page.getByRole("button", { name: /Switch to .* mode/ }).count()) throw Error("Theme toggle must remain hidden while dark-only mode is active");
    }
  }
  hold = true;
  const beforeStop = prepares;
  await page.clock.fastForward(300001);
  await wait(() => prepares > beforeStop, "Delayed cycle did not start");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page
    .getByRole("button", { name: "Start screening", exact: true })
    .waitFor();
  release?.();
  await page.clock.fastForward(600000);
  if (prepares !== beforeStop + 1 || grants !== 2)
    throw Error("Stop allowed more work or a late scoring result");
  hold = false;
  providerFailure = "PROVIDER_UNAVAILABLE";
  await page
    .getByRole("button", { name: "Start screening", exact: true })
    .click();
  await page
    .locator(".screener-monitor-status")
    .getByText("Retry scheduled", { exact: true })
    .waitFor();
  await page
    .getByText(
      "Previous result retained. The latest check did not update prices.",
      { exact: true },
    )
    .waitFor();
  const errorDialog = page.getByRole("dialog");
  await errorDialog.waitFor();
  if (
    !(await page
      .getByRole("button", { name: "Automatic retry scheduled", exact: true })
      .isDisabled())
  )
    throw Error("Manual retry can bypass provider delay");
  const beforeBackoff = prepares;
  await page.clock.fastForward(300001);
  if (prepares !== beforeBackoff) throw Error("Retry-After was not respected");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (let theme = 0; theme < 1; theme++) {
      await page.screenshot({
        path: `output/playwright/intraday-retry-${width}-${theme}.png`,
        fullPage: true,
      });
      await page.evaluate(
        () =>
          (document.documentElement.dataset.theme =
            document.documentElement.dataset.theme === "light"
              ? "dark"
              : "light"),
      );
    }
  }
  await errorDialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  providerFailure = "INTERVAL_UNAVAILABLE";
  await page
    .getByRole("button", { name: "Start screening", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Candle interval unavailable", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Change interval", exact: true })
    .click();
  await page.waitForFunction(
    () => document.getElementById("screen-interval") === document.activeElement,
  );
  providerFailure = "";
  const beforeNavigation = prepares;
  await page.goto(`${origin}/#app/rules`);
  await page.goto(`${origin}/#app/analysis`);
  await page
    .getByRole("button", { name: "Start screening", exact: true })
    .waitFor();
  await page.clock.fastForward(600000);
  if (prepares !== beforeNavigation)
    throw Error("Navigation automatically restarted monitor");
  await page.goto(`${origin}/#app/realtime`);
  const savedRows = page.locator('.monitor-history li');
  await savedRows.first().waitFor();
  const beforeDelete = await savedRows.count();
  const originalHistory = await page.evaluate((id) => localStorage.getItem(`signalgen:workspace:v1:${id}:monitor-history`), user.id);
  const deleteButton = savedRows.first().getByRole('button', {name:/Delete history for/});
  await deleteButton.click();
  const confirm = page.getByRole('alertdialog', {name:'Delete screening history?', exact:true});
  await confirm.waitFor();
  await page.clock.runFor(100);
  if (!await confirm.getByRole('button', {name:'Cancel', exact:true}).evaluate(el => el === document.activeElement)) throw Error('Delete confirmation must focus Cancel');
  await confirm.getByRole('button', {name:'Cancel', exact:true}).click();
  if (await savedRows.count() !== beforeDelete) throw Error('Cancel removed history');
  await deleteButton.click();
  await confirm.getByRole('button', {name:'Delete history', exact:true}).click();
  await page.waitForFunction((count) => document.querySelectorAll('.monitor-history li').length === count - 1, beforeDelete);
  if (await page.evaluate((id) => localStorage.getItem(`signalgen:workspace:v1:${id}:monitor-history`), user.id) !== originalHistory) throw Error('Display-only deletion rewrote synced history');
  await page.reload();
  await savedRows.first().waitFor();
  if (await savedRows.count() !== beforeDelete - 1) throw Error('Deleted history returned on reload');
  const monitorTools = page.locator('.monitor-history__tools');
  const countBox = await monitorTools.locator('[data-slot="badge"]').boundingBox();
  const allBox = await monitorTools.getByRole('button',{name:'Delete all',exact:true}).boundingBox();
  if (!countBox || !allBox || Math.abs(countBox.height-allBox.height)>1) throw Error('History count and Delete all heights differ');
  await monitorTools.getByRole('button',{name:'Delete all',exact:true}).click();
  const allConfirmation = page.getByRole('alertdialog',{name:'Delete all screening history?',exact:true});
  await allConfirmation.getByRole('button',{name:'Cancel',exact:true}).click();
  if (await savedRows.count() !== beforeDelete-1) throw Error('Delete all Cancel removed history');
  await page.goto(`${origin}/#app/analysis`);
  await page.locator('.screener-history summary').click();
  const historyCards = page.locator('.screener-history-list > li');
  if (await historyCards.count() !== beforeDelete-1) throw Error('Screener history did not respect local deletions');
  const card = historyCards.first();
  if (await card.locator('.screener-history-facts > div').count() !== 5) throw Error('History metadata tiles missing');
  for (const width of [1440,390]) for (const theme of ["dark"]) {
    await page.setViewportSize({width,height:1000});
    await page.evaluate(theme => document.documentElement.dataset.theme=theme,theme);
    await card.screenshot({path:`output/playwright/history-card-${width}-${theme}.png`});
    if (await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)) throw Error('History cards overflow');
    const review = await card.getByRole('button',{name:'Review result',exact:true}).boundingBox();
    const remove = await card.getByRole('button',{name:/Delete history for/}).boundingBox();
    if (!review || !remove || Math.abs(review.y+review.height/2-remove.y-remove.height/2)>2) throw Error('Review and Delete are not adjacent');
  }
  await card.getByRole('button',{name:/Delete history for/}).click();
  await page.getByRole('alertdialog',{name:'Delete screening history?',exact:true}).getByRole('button',{name:'Cancel',exact:true}).click();
  await page.locator('.screener-history-toolbar').getByRole('button',{name:'Delete all',exact:true}).click();
  await allConfirmation.getByRole('button',{name:'Cancel',exact:true}).click();
  if (await historyCards.count() !== beforeDelete-1) throw Error('Screener Delete all Cancel removed history');
  await page.locator('.screener-history-toolbar').getByRole('button',{name:'Delete all',exact:true}).click();
  await allConfirmation.getByRole('button',{name:'Delete all history',exact:true}).click();
  await page.locator('.screener-history').waitFor({state:'hidden'});
  if (await page.evaluate((id)=>localStorage.getItem(`signalgen:workspace:v1:${id}:monitor-history`),user.id) !== originalHistory) throw Error('Delete all rewrote synced history');
  await page.reload();
  await page.getByRole('button',{name:'Start screening',exact:true}).waitFor();
  if (await page.locator('.screener-history').count()) throw Error('Deleted history returned');
  if (errors.length) throw Error(errors.join("; "));
  await page.evaluate(() =>
    document.body.setAttribute("data-signalgen-monitor-tests", "complete"),
  );
}
