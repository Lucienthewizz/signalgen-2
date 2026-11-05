// Runs inside workspace-regression's synthetic API setup, without its UI suite.
async ({ page, origin, profile = "desktop" }) => {
  const mobile = profile === "mobile";
  await page.setViewportSize(
    mobile ? { width: 390, height: 844 } : { width: 1218, height: 853 },
  );
  if (mobile) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: 200000,
      uploadThroughput: 93750,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }
  await page.addInitScript(() => {
    const metrics = {
      lcpMs: null,
      cls: 0,
      interactionLatencyMsMax: null,
      interactionSamples: 0,
      supported: PerformanceObserver.supportedEntryTypes,
    };
    let sessionStart = 0,
      lastShift = 0,
      sessionScore = 0;
    const interactions = new Map();
    const observe = (type, callback, options = {}) => {
      if (metrics.supported.includes(type))
        new PerformanceObserver((list) => callback(list.getEntries())).observe({
          type,
          buffered: true,
          ...options,
        });
    };
    observe("largest-contentful-paint", (entries) => {
      metrics.lcpMs = entries.at(-1).startTime;
    });
    observe("layout-shift", (entries) => {
      for (const entry of entries) {
        if (entry.hadRecentInput) continue;
        if (
          !sessionStart ||
          entry.startTime - lastShift > 1000 ||
          entry.startTime - sessionStart > 5000
        ) {
          sessionStart = entry.startTime;
          sessionScore = 0;
        }
        lastShift = entry.startTime;
        sessionScore += entry.value;
        metrics.cls = Math.max(metrics.cls, sessionScore);
      }
    });
    observe(
      "event",
      (entries) => {
        for (const entry of entries)
          if (entry.interactionId)
            interactions.set(
              entry.interactionId,
              Math.max(
                interactions.get(entry.interactionId) ?? 0,
                entry.duration,
              ),
            );
        metrics.interactionSamples = interactions.size;
        metrics.interactionLatencyMsMax = interactions.size
          ? Math.max(...interactions.values())
          : null;
      },
      { durationThreshold: 16 },
    );
    window.__signalgenLabMetrics = metrics;
  });
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
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("button", { name: "Hide heatmap", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Show heatmap", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Preview test data", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Exit test preview", exact: true })
      .click();
  }
  await page.waitForTimeout(150);
  const labMetrics = await page.evaluate(() => window.__signalgenLabMetrics);
  const response = await page.request.get(origin + "/");
  const html = await response.text();
  const result = {
    scenario: mobile
      ? "mobile emulation 390x844, CPU 4x, network 1.6Mbps down/0.75Mbps up/150ms; synthetic API delay 300/1200ms; not a physical phone or field INP"
      : "synthetic API: universe 300ms, catalog 1200ms; production preview; 1218x853",
    labMetrics,
    scriptedInteractions: 8,
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
