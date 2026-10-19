// playwright-cli run-code --filename tests/browser/us-stocks.cli.js
// CLI expects a function expression without a trailing statement semicolon.
// prettier-ignore
async (page) => {
  await page.unrouteAll({ behavior: "wait" });
  const tickers = [
    "AAPL",
    "ADBE",
    "AMD",
    "AMZN",
    "AVGO",
    "BAC",
    "BRK-B",
    "DIS",
    "GOOGL",
    "JPM",
    "KO",
    "MA",
    "META",
    "MSFT",
    "NFLX",
    "NVDA",
    "QCOM",
    "TSLA",
    "V",
    "XOM",
  ];
  const nyse = new Set(["BAC", "BRK-B", "DIS", "JPM", "KO", "MA", "V", "XOM"]);
  const stocks = [
    {
      symbol: "BBCA.JK",
      name: "Bank Central Asia",
      exchange: "XIDX",
      currency: "IDR",
    },
    ...tickers.map((symbol) => ({
      symbol,
      name: `Fixture ${symbol}`,
      exchange: nyse.has(symbol) ? "XNYS" : "XNAS",
      currency: "USD",
    })),
    // Synthetic metadata verifies the whole catalog stays searchable without
    // mounting thousands of buttons or relaxing the ten-stock run boundary.
    ...Array.from({ length: 5580 }, (_, i) => ({
      symbol: `FIX${i}`,
      name: `Synthetic catalog ${i}`,
      exchange: "XNAS",
      currency: "USD",
    })),
  ];
  const rule = {
    id: "us-rule",
    name: "US fixture rule",
    owner_type: "user",
    version: 1,
    definition_hash: "fixture-rule-hash",
    engine_version: "core-0.3.0",
    definition: {
      name: "US fixture rule",
      logic: "AND",
      signal_type: "BUY",
      cooldown_sec: 0,
      conditions: [{ left: "PRICE", op: ">", right: "EMA20" }],
    },
  };
  let groups = [],
    socketCount = 0,
    prepared;
  const fixtures = new Map();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url()),
      p = url.pathname;
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (!p.startsWith("/api/")) return route.continue();
    const body = route.request().postDataJSON();
    if (p === "/api/auth/me")
      return route.fulfill({
        json: { id: "synthetic-us-user", email: "fixture@example.test" },
      });
    if (p === "/api/v1/account/me")
      return route.fulfill({
        json: {
          user: { id: "synthetic-us-user", status: "active" },
          features: ["screener"],
        },
      });
    if (p === "/api/v1/subscription/usage")
      return route.fulfill({
        json: {
          limits: { custom_rules: 10, stock_universes: 5 },
          used: { custom_rules: 1, stock_universes: groups.length },
        },
      });
    if (p === "/api/v1/stocks")
      return route.fulfill({ json: { items: stocks } });
    if (p === "/api/v1/stock-universes" && body) {
      groups.push({
        ...body,
        id: "univ-us",
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return route.fulfill({ json: groups[0] });
    }
    if (p === "/api/v1/stock-universes")
      return route.fulfill({ json: { items: groups } });
    if (p === "/api/v1/stock-universes/univ-us" && body) {
      groups[0] = { ...groups[0], ...body, version: groups[0].version + 1 };
      return route.fulfill({ json: groups[0] });
    }
    if (p === "/api/v1/rules")
      return route.fulfill({ json: { items: [rule] } });
    if (p === "/api/v1/rules/us-rule") return route.fulfill({ json: rule });
    if (p === "/api/v1/datasets/prepare") {
      const symbols = groups[0].symbols;
      const data = {
        schema_version: "ohlcv-multi-1",
        purpose: "screen",
        market: "US",
        currency: "USD",
        timeframe: "1d",
        timezone: "UTC",
        adjustment: "none",
        series: symbols.map((symbol) => ({
          symbol,
          timezone: "UTC",
          candles: Array.from({ length: 100 }, (_, i) => ({
            timestamp: new Date(Date.UTC(2026, 0, i + 1, 14, 30)).toISOString(),
            open: 100 + i,
            high: 103 + i,
            low: 99 + i,
            close: 102 + i,
            volume: 1000,
          })),
        })),
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
            (b) => b.toString(16).padStart(2, "0"),
          ).join(""),
        text,
      );
      prepared = {
        dataset_id: `ds-us-${symbols.length}`,
        version: "v1",
        expires_at: new Date(Date.now() + 600000).toISOString(),
        schema_version: data.schema_version,
        provider: "yahoo_finance",
        purpose: "screen",
        market: "US",
        currency: "USD",
        symbols,
        exchanges: symbols.map(
          (symbol) => stocks.find((stock) => stock.symbol === symbol).exchange,
        ),
        timeframe: "1d",
        timezone: "UTC",
        adjustment: "none",
        warmup_candles: 20,
        candle_count: symbols.length * 100,
        decoded_bytes: text.length,
        checksum,
        quality: { status: "complete", warnings: [] },
        requested_range: { from: "2026-01-01", to: "2026-04-10" },
        available_range: { from: "2026-01-01", to: "2026-04-10" },
      };
      fixtures.set(prepared.dataset_id, { manifest: prepared, text });
      return route.fulfill({ json: prepared });
    }
    if (p.startsWith("/api/v1/datasets/")) {
      const f = fixtures.get(p.split("/")[4]);
      return route.fulfill(
        p.endsWith("/content")
          ? { body: f.text, contentType: "application/json" }
          : { json: f.manifest },
      );
    }
    if (p === "/api/v1/compute-grants")
      return route.fulfill({ json: { id: "grant-us" } });
    if (p === "/api/v1/screener/socket-tickets")
      return route.fulfill({
        json: {
          ticket: "fixture-ticket",
          websocket_path: "/api/v1/screener/ws",
          protocol: "screener-private-1",
          feature_schema_version: "screener-features-1",
          max_candidates: 1000,
        },
      });
    return route.fulfill({ json: { items: [] } });
  });
  await page.routeWebSocket("**/api/v1/screener/ws*", (socket) => {
    socketCount++;
    socket.onMessage((raw) => {
      const msg = JSON.parse(raw);
      socket.send(
        JSON.stringify({
          type: "screener.result",
          protocol: msg.protocol,
          request_id: msg.request_id,
          decision_version: "fixture",
          results: msg.candidates.map((c) => ({
            symbol: c.symbol,
            timestamp: c.timestamp,
            matched: c.features.price > c.features.ema20,
            reason_codes: ["RULE_MATCHED"],
          })),
        }),
      );
    });
  });
  await page.goto("http://127.0.0.1:5175/tests/browser/us-stocks.fixture.html");
  await page.getByText(/1 saham tersedia/).waitFor();
  await page.getByLabel("Pasar saham", { exact: true }).click();
  await page
    .getByRole("option", { name: "Amerika Serikat · Nasdaq/NYSE · USD" })
    .click();
  await page.getByText(/5\.600 saham tersedia/).waitFor();
  await page.getByLabel("Nama universe", { exact: true }).fill("US fixture");
  const search = page.getByRole("searchbox", {
    name: "Cari kode atau nama perusahaan",
  });
  if ((await page.locator(".instrument-choices button").count()) !== 12)
    throw Error("Unbounded US catalog DOM");
  await search.fill("FIX5579");
  await page
    .locator(".instrument-choices button")
    .filter({ hasText: "FIX5579" })
    .waitFor();
  await search.fill("");
  for (const symbol of ["AAPL", "MSFT", "BRK-B"]) {
    await search.fill(symbol);
    await page
      .locator(".instrument-choices button")
      .filter({ hasText: symbol })
      .click();
  }
  await page
    .getByRole("button", { name: "Create universe", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit US fixture" }).waitFor();
  if (
    groups[0].symbols.length !== 3 ||
    groups[0].symbols.some((s) => s.endsWith(".JK"))
  )
    throw Error("Wrong-market symbols saved");
  await page.getByRole("button", { name: "screener", exact: true }).click();
  await page
    .getByRole("button", { name: "Jalankan screening", exact: true })
    .click();
  await page
    .getByText("3 dari 3 saham ditampilkan", { exact: true })
    .waitFor({ timeout: 20000 });
  await page.getByRole("columnheader", { name: "Harga tutup (USD)" }).waitFor();
  if (await page.getByRole("columnheader", { name: /IDR/ }).count())
    throw Error("USD result labelled IDR");
  await page.evaluate(() => {
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      void blob.text().then((text) => {
        window.fixtureCsv = text;
      });
      return create(blob);
    };
  });
  await page.getByRole("button", { name: "Ekspor CSV", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.fixtureCsv?.includes("Buka USD") &&
      window.fixtureCsv?.includes("Tutup USD"),
  );
  await page.getByRole("button", { name: "BRK-B", exact: true }).click();
  const chart = await page
    .locator(".stock-detail__chart")
    .evaluate((el) => el.innerHTML);
  if (chart.includes("IDX:BRK")) throw Error("US chart uses IDX");
  await page.getByRole("button", { name: "Tutup detail", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "screener", exact: true }).click();
  await page.getByText("3 dari 3 saham ditampilkan", { exact: true }).waitFor();
  await page.getByRole("columnheader", { name: "Harga tutup (USD)" }).waitFor();
  await page.getByRole("button", { name: "monitor", exact: true }).click();
  await page.getByLabel("Tambah saham", { exact: true }).fill("US:AAPL");
  await page.getByRole("button", { name: "Tambah saham", exact: true }).click();
  await page
    .locator(".monitor-chart")
    .getByText("Harian · USD", { exact: true })
    .waitFor();
  if (
    !(await page
      .locator(".monitor-ledger")
      .innerText()
      .then((t) => t.includes("US:AAPL") && t.includes("US fixture rule")))
  )
    throw Error("US monitor lost result");
  await page.getByRole("button", { name: "universes", exact: true }).click();
  await page.getByRole("button", { name: "Edit US fixture" }).click();
  for (const symbol of tickers
    .filter((s) => !groups[0].symbols.includes(s))
    .slice(0, 7)) {
    await search.fill(symbol);
    await page
      .locator(".instrument-choices button")
      .filter({ hasText: symbol })
      .click();
  }
  await search.fill("");
  if (
    await page
      .locator(".instrument-choices button:not(.is-selected):enabled")
      .count()
  )
    throw Error("Eleventh stock enabled");
  await page
    .getByRole("button", { name: "Simpan perubahan", exact: true })
    .click();
  await page.getByRole("button", { name: "screener", exact: true }).click();
  await page
    .getByRole("button", { name: "Jalankan screening", exact: true })
    .click();
  await page
    .getByText("10 dari 10 saham ditampilkan", { exact: true })
    .waitFor({ timeout: 20000 });
  if (socketCount !== 2) throw Error("Unexpected scoring socket count");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (let theme = 0; theme < 2; theme++) {
      await page.getByRole("button", { name: "Ganti tema" }).click();
      if (
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        )
      )
        throw Error(`Overflow at ${width}`);
      await page.screenshot({
        path: `output/playwright/us-stocks-${width}-${theme}.png`,
        fullPage: true,
      });
    }
  }
  await page.getByRole("button", { name: "universes", exact: true }).click();
  await page.getByRole("button", { name: "Edit US fixture" }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (let theme = 0; theme < 2; theme++) {
      await page.getByRole("button", { name: "Ganti tema" }).click();
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
        throw Error(`Catalog overflow at ${width}`);
      await page.screenshot({path:`output/playwright/us-full-catalog-${width}-${theme}.png`,fullPage:true});
    }
  }
  await page.getByLabel("Pasar saham", { exact: true }).click();
  await page.getByRole("option", { name: "Indonesia · IDX · IDR" }).click();
  if (await page.getByLabel("Saham yang dipilih").count())
    throw Error("Changing market kept old selections");
  if (errors.length) throw Error(errors.join("; "));
  await page.evaluate(() => {
    document.body.dataset.usTests = "passed";
  });
}
