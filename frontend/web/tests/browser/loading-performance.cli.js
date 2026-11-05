// Runs inside workspace-regression's synthetic API setup, without its UI suite.
async ({ page, origin }) => {
  await page.setViewportSize({ width: 1218, height: 853 });
  let universes = 0,
    catalogs = 0,
    widgets = 0;
  await page.route("**/api/v1/stock-universes", async (route) => {
    universes++;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      json: {
        items: [
          {
            id: "fixture-universe",
            name: "Performance universe",
            symbols: ["BBCA.JK", "BBRI.JK"],
          },
        ],
      },
    });
  });
  await page.route("**/api/v1/stocks", async (route) => {
    catalogs++;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.fulfill({
      json: {
        items: ["BBCA", "BBRI"].map((ticker) => ({
          symbol: ticker + ".JK",
          name: ticker,
          exchange: "XIDX",
          currency: "IDR",
        })),
      },
    });
  });
  page.on("request", (request) => {
    if (request.url().includes("embed-widget-advanced-chart.js")) widgets++;
  });
  await page.goto(`${origin}/#app/realtime`);
  await page.reload();
  // Wait for fixture bootstrap first, then measure route mounts (no asset/network warmup noise).
  await page.locator(".stock-heatmap__tile").first().waitFor();
  // Warm both resources fully: do not mistake in-flight deduplication for a fresh cache hit.
  await page
    .locator('.stock-heatmap__tile[aria-label^="BBCA, BBCA,"]')
    .waitFor();
  await page.goto(`${origin}/#app/overview`);
  const visits = [];
  for (let i = 0; i < 5; i++) {
    const counts = { universes, catalogs, widgets };
    const start = Date.now();
    await page.goto(`${origin}/#app/realtime`);
    await page.waitForFunction(
      () => document.querySelectorAll(".stock-heatmap__tile").length === 2,
    );
    visits.push({
      readyMs: Date.now() - start,
      universes: universes - counts.universes,
      catalogs: catalogs - counts.catalogs,
      widgets: widgets - counts.widgets,
    });
    await page.goto(`${origin}/#app/overview`);
  }
  const sorted = visits.map((visit) => visit.readyMs).sort((a, b) => a - b);
  // Fresh document: isolate catalogue delay from universe rendering, and offscreen widget creation.
  await page.goto(`${origin}/#app/realtime`);
  const start = Date.now();
  await page.reload();
  await page.waitForFunction(
    () => document.querySelectorAll(".stock-heatmap__tile").length === 2,
  );
  const freshReadyMs = Date.now() - start;
  await page.waitForFunction(
    () => !document.querySelector("#monitor-universe[disabled]"),
  );
  const initialChartScripts = await page
    .locator(".monitor-chart script")
    .count();
  const response = await page.request.get(origin + "/");
  const html = await response.text();
  const result = {
    scenario:
      "synthetic API: universe 300ms, catalog 1200ms; production preview; 1218x853",
    freshReadyMs,
    revisitMedianMs: sorted[2],
    revisitRequests: visits,
    initialChartScripts,
    htmlBytes: Buffer.byteLength(html),
  };
  await page.evaluate((result) => {
    document.body.dataset.signalgenPerformance = JSON.stringify(result);
    document.body.setAttribute("data-signalgen-performance-tests", "complete");
  }, result);
};
