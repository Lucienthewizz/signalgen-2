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
          schema_version: "backtest-1",
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
  mode = "denied";
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "not enabled" }).waitFor();
  if (
    await page
      .getByRole("button", { name: "Run backtest", exact: true })
      .count()
  )
    throw Error("Denied account has a runnable form");
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
