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
    engine_version: "core-0.4.0",
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
        capabilities_version: "capabilities-3",
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
  if (!(await page.getByText("Actual data:", { exact: false }).count()))
    throw Error("Actual candle range missing");
  const initialPrepares = prepares;
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
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.clock.runFor(300);
    for (let theme = 0; theme < 2; theme++) {
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
      await page.getByRole("button", { name: /Switch to .* mode/ }).click();
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
  await page.goto(`${origin}/#app/rules`);
  await page.goto(`${origin}/#app/analysis`);
  await page
    .getByRole("button", { name: "Start screening", exact: true })
    .waitFor();
  await page.clock.fastForward(600000);
  if (prepares !== beforeStop + 1)
    throw Error("Navigation automatically restarted monitor");
  if (errors.length) throw Error(errors.join("; "));
  await page.evaluate(() =>
    document.body.setAttribute("data-signalgen-monitor-tests", "complete"),
  );
};
