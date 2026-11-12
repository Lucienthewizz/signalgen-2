// Playwright CLI run-code expression. See docs/backend/SCREENING_PERFORMANCE.md.
// Real orchestration, worker/WASM, checksum checks and IndexedDB. All APIs are
// synthetic; no private decision rule or production account is used here.
// CLI wraps this as an expression; keep the final semicolon absent.
// prettier-ignore
async (page) => {
  const url = new URL(page.url()),
    origin = url.origin;
  const symbols = Number(url.searchParams.get("symbols") || 10);
  const purpose = url.searchParams.get("purpose") || "backtest";
  if (
    ![10, 100, 500].includes(symbols) ||
    !["screen", "backtest"].includes(purpose)
  )
    throw Error("Unsupported workload");
  const owner = "11111111-1111-4111-8111-111111111119";
  let context,
    sequence = 0,
    prepares = [],
    scored = [],
    peakSnapshots = 0;
  const snapshots = new Map(),
    failures = [];
  page.on("pageerror", (e) => failures.push(e.message));
  await page.route("**/*", async (route) => {
    const r = route.request(),
      u = new URL(r.url()),
      p = u.pathname;
    if (u.origin !== origin)
      throw Error("External request blocked: " + u.origin);
    if (!p.startsWith("/api/")) return route.continue();
    const respond = (json) => route.fulfill({ json });
    if (p === "/api/v1/account/me")
      return respond({
        user: { id: owner },
        features: ["backtest", "screener"],
      });
    const root =
      purpose === "screen"
        ? "/api/v1/screener/scans"
        : "/api/v1/backtests/studies";
    if (p === root) {
      prepares = [];
      scored = [];
      context = {
        id: "perf-" + ++sequence,
        purpose,
        engine_version: "core-0.5.0",
        rule_schema_version: "signal-baseline-1",
        schema_version: "signal-study-1",
        policy_version: "signal-close-independent-1",
        market: "US",
        currency: "USD",
        rule_id: "synthetic-rule",
        definition_hash: "sha256:synthetic",
        catalog_hash: "sha256:synthetic-" + symbols,
        total: symbols,
        batch_size: 10,
        batches: Math.ceil(symbols / 10),
        config: r.postDataJSON().config,
      };
      return respond(context);
    }
    if (p.startsWith(root + "/") && p.endsWith("/prepare")) {
      if (r.method() === "DELETE") {
        snapshots.clear();
        return route.fulfill({ status: 204 });
      }
      if (snapshots.size) throw Error("Previous batch was not released");
      const index = Number(p.split("/").at(-2)),
        manifests = [],
        stocks = [];
      prepares.push(index);
      for (let s = index * 10; s < Math.min(symbols, (index + 1) * 10); s++) {
        const symbol = "TEST" + String(s).padStart(3, "0");
        stocks.push(symbol);
        // Screen input ends on Sep 30; only backtest includes future outcomes.
        const candles = Array.from(
          { length: purpose === "screen" ? 273 : 300 },
          (_, i) => {
            const price = 100 + ((i * 37 + s * 11) % 601) / 10;
            return {
              timestamp: new Date(Date.UTC(2026, 0, 1 + i))
                .toISOString()
                .replace(".000Z", "Z"),
              open: price,
              high: price + 3,
              low: price - 3,
              close: price + 1,
              volume: 1000 + i,
            };
          },
        );
        const backtest = {
          ...context.config,
          study_id: context.id,
          definition_hash: context.definition_hash,
        };
        const raw = JSON.stringify({
          purpose,
          timeframe: "1d",
          market: "US",
          currency: "USD",
          backtest,
          series: [{ symbol, timezone: "UTC", candles }],
        });
        const bytes = new TextEncoder().encode(raw);
        const digest = Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
        snapshots.set(symbol, raw);
        manifests.push({
          dataset_id: symbol,
          version: "synthetic-1",
          purpose,
          timeframe: "1d",
          market: "US",
          currency: "USD",
          symbols: [symbol],
          backtest,
          decoded_bytes: bytes.length,
          checksum: "sha256:" + digest,
          required_operands: ["PRICE", "EMA20", "RSI14"],
        });
      }
      peakSnapshots = Math.max(peakSnapshots, snapshots.size);
      return respond({ index, stocks, manifests, failures: [] });
    }
    if (p.startsWith("/api/v1/datasets/") && p.endsWith("/content"))
      return route.fulfill({
        body: snapshots.get(p.split("/")[4]),
        contentType: "application/json",
      });
    if (p === "/api/v1/compute-grants") {
      const b = r.postDataJSON();
      if (
        b.purpose !== purpose ||
        b.definition_hash !== context.definition_hash ||
        b.rule_id !== context.rule_id ||
        !snapshots.has(b.dataset_id)
      )
        throw Error("Unbound synthetic grant");
      return respond({ id: b.dataset_id });
    }
    if (p === "/api/v1/backtests/signals" || p === "/api/v1/screener/signals") {
      const b = r.postDataJSON();
      scored.push(b.compute_grant_id);
      // Predetermined fixture decisions, deliberately no client-side rule scoring.
      return respond({
        policy_version: context.policy_version,
        entries: b.candidates
          .filter(
            (c) =>
              c.timestamp.slice(0, 10) >= context.config.from &&
              c.timestamp.slice(0, 10) <= context.config.to,
          )
          .map((c) => ({
            symbol: c.symbol,
            timestamp: c.timestamp,
            signal_type: "BUY",
          })),
      });
    }
    throw Error("Unexpected API request: " + p);
  });
  await page.goto(origin + "/wasm/signalgen_core.manifest.json");
  await page.setContent(
    "<title>Screening performance fixture</title><main>Running synthetic catalog.</main>",
  );
  const runs = [];
  for (let i = 0; i < 6; i++) {
    const result = await page.evaluate(
      async ({ owner, purpose }) => {
        sessionStorage.setItem(
          "signalgen.access-token",
          "synthetic-performance-only",
        );
        sessionStorage.setItem("signalgen.app-session", "synthetic-session");
        sessionStorage.setItem("signalgen.app-session-origin", "same-origin");
        const { runSignalStudy } =
          await import("/src/analysis/signal-study.ts");
        const storage = await import("/src/analysis/signal-study-storage.ts");
        await storage.clearAllStudyResults();
        const input = {
          purpose,
          source: "market",
          market: "US",
          rule_id: "synthetic-rule",
          config: { from: "2026-09-01", to: "2026-09-30", n_steps: 5 },
        };
        const start = performance.now();
        const p = await runSignalStudy(
          input,
          owner,
          new AbortController().signal,
          () => {},
        );
        const total_ms = performance.now() - start;
        const events = await storage.studyEventPage(owner, p.context.id);
        const canonical = JSON.stringify({
          swing: p.swing,
          horizons: p.horizons,
          bySymbol: p.bySymbol,
          byDay: p.byDay,
          events,
        });
        const output_sha256 = Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(canonical),
            ),
          ),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
        return {
          total_ms,
          stages: p.timings,
          traffic: p.traffic,
          completed: p.completed,
          remaining: p.remaining,
          failures: p.failures.length,
          event_count: events.total,
          output_sha256,
        };
      },
      { owner, purpose },
    );
    if (
      result.completed !== symbols ||
      result.remaining ||
      result.failures ||
      result.event_count !== symbols * 30 ||
      scored.length !== symbols ||
      new Set(scored).size !== symbols ||
      prepares.length !== Math.ceil(symbols / 10) ||
      prepares.some((n, i) => n !== i) ||
      snapshots.size ||
      peakSnapshots > 10
    )
      throw Error("Incomplete or unbounded catalog traversal");
    if (runs.length && result.output_sha256 !== runs[0].output_sha256)
      throw Error("Repeated outputs differ");
    runs.push({
      ...result,
      cache:
        i === 0
          ? "first run in fresh browser context"
          : "repeat in same context; fresh run worker; routing disables HTTP cache",
    });
  }
  const quantiles = (values) => {
    const a = [...values].sort((a, b) => a - b);
    return {
      samples: a.length,
      median_ms: a[Math.ceil(a.length * 0.5) - 1],
      p95_ms: a[Math.ceil(a.length * 0.95) - 1],
    };
  };
  const report = {
    schema: "screening-performance-1",
    synthetic: true,
    purpose,
    symbols,
    candles_per_symbol: purpose === "screen" ? 273 : 300,
    steps: 5,
    first_run: runs[0],
    warm: {
      total: quantiles(runs.slice(1).map((r) => r.total_ms)),
      stages: Object.fromEntries(
        Object.keys(runs[0].stages).map((k) => [
          k,
          quantiles(runs.slice(1).map((r) => r.stages[k])),
        ]),
      ),
    },
    runs,
    peak_fixture_snapshots: peakSnapshots,
    user_agent: await page.evaluate(() => navigator.userAgent),
    hardware_concurrency: await page.evaluate(
      () => navigator.hardwareConcurrency,
    ),
    errors: failures,
  };
  if (failures.length) throw Error(failures.join("; "));
  await page.evaluate((report) => {
    document.body.dataset.screeningPerformance = JSON.stringify(report);
    document.querySelector("main").textContent =
      "Synthetic benchmark complete.";
  }, report);
  return report;
}
