// Run only inside the bounded offline benchmark container. The API must be
// the disposable Go fixture, with synthetic identity and frozen saved prices.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";

const fixture = JSON.parse(fs.readFileSync(process.env.SCREEN_FIXTURE, "utf8"));
assert.equal(new URL(fixture.url).hostname, "127.0.0.1");
assert.ok(fixture.owner.startsWith("synthetic-"));
const roots = JSON.parse(process.env.SCREEN_SOURCES);
assert.ok(Object.keys(roots).length > 0 && Object.keys(roots).length <= 2);
const rounds = Number(process.env.SCREEN_ROUNDS || 3);
assert.ok(Number.isInteger(rounds) && rounds > 0 && rounds <= 5);
const rtt = Number(process.env.SCREEN_RTT_MS || 0);
assert.ok(Number.isFinite(rtt) && rtt >= 0 && rtt <= 100);
const output = [];
const sourceHashes = Object.fromEntries(
  Object.entries(roots).map(([label, root]) => [
    label,
    Object.fromEntries(
      [
        "src/analysis/signal-study.ts",
        "src/analysis/signal-study-engine.ts",
        "src/analysis/signal-study-storage.ts",
        "src/workers/signal-study.worker.ts",
        "package-lock.json",
        "public/wasm/signalgen_core.wasm",
      ].map((file) => [
        file,
        createHash("sha256")
          .update(fs.readFileSync(path.join(root, file)))
          .digest("hex"),
      ]),
    ),
  ]),
);
const usage = () => ({
  cpu_usec: Number(
    fs
      .readFileSync("/sys/fs/cgroup/cpu.stat", "utf8")
      .match(/^usage_usec (\d+)/m)[1],
  ),
  memory_bytes: Number(
    fs.readFileSync("/sys/fs/cgroup/memory.current", "utf8"),
  ),
});

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-dev-shm-usage", "--disable-gpu"],
});
try {
  for (let round = 0; round < rounds; round++) {
    // Alternate order to expose drift; each pair uses the same API process.
    for (const label of round % 2
      ? Object.keys(roots).reverse()
      : Object.keys(roots)) {
      const root = path.resolve(roots[label]);
      const server = await createServer({
        root,
        configFile: false,
        envFile: false,
        appType: "custom",
        plugins: [
          {
            name: "isolated-api-latency",
            configureServer(server) {
              server.middlewares.use((req, res, next) => {
                if (!rtt || !req.url.startsWith("/api/")) return next();
                setTimeout(() => {
                  if (!req.destroyed) next();
                }, rtt);
              });
            },
          },
        ],
        cacheDir: `/scratch/vite-${label}-${round}`,
        publicDir: path.join(root, "public"),
        resolve: { alias: { "@": path.join(root, "src") } },
        server: {
          host: "127.0.0.1",
          port: 0,
          watch: null,
          hmr: false,
          proxy: { "/api": { target: fixture.url, changeOrigin: true } },
        },
      });
      server.middlewares.use((req, res, next) => {
        if (req.url !== "/benchmark") return next();
        res.setHeader("Content-Type", "text/html");
        res.end("<!doctype html><title>Isolated screening measurement</title>");
      });
      await server.listen();
      const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(120000);
        await page.goto(origin + "/benchmark");
        await page.evaluate(async (fixture) => {
          const { session } = await import("/src/api/client.ts");
          session.setToken(fixture.owner);
          session.setAppSession("synthetic-session");
          window.runBenchmarkStudy = (
            await import("/src/analysis/signal-study.ts")
          ).runSignalStudy;
          window.studyStorage =
            await import("/src/analysis/signal-study-storage.ts");
        }, fixture);
        // Fresh context is cold browser storage/assets; the second run retains
        // the module, WASM response cache, and IndexedDB, but uses a new study.
        for (const temperature of ["cold", "warm"]) {
          const requests = [];
          const responses = [];
          const errors = [];
          const onError = (error) => errors.push(error.message);
          const onRequest = (request) => {
            const pathname = new URL(request.url()).pathname;
            if (!pathname.startsWith("/api/")) return;
            requests.push({
              method: request.method(),
              route: pathname
                .replace(/\/scans\/[^/]+/g, "/scans/:id")
                .replace(/\/datasets\/[^/]+/g, "/datasets/:id")
                .replace(/\/batches\/\d+/g, "/batches/:batch"),
              bytes: request.postDataBuffer()?.length ?? 0,
            });
          };
          const onResponse = (response) => {
            if (new URL(response.url()).pathname.startsWith("/api/")) {
              responses.push(
                response.body().then((body) => ({
                  status: response.status(),
                  bytes: body.length,
                })),
              );
            }
          };
          page.on("request", onRequest);
          page.on("response", onResponse);
          page.on("pageerror", onError);
          const before = usage();
          let memoryPeak = before.memory_bytes;
          const sampler = setInterval(() => {
            memoryPeak = Math.max(memoryPeak, usage().memory_bytes);
          }, 50);
          let result;
          try {
            result = await page.evaluate(async (fixture) => {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), 200000);
              let progress;
              const start = performance.now();
              try {
                progress = await window.runBenchmarkStudy(
                  fixture.input,
                  fixture.owner,
                  controller.signal,
                  () => {},
                );
              } finally {
                clearTimeout(timer);
              }
              const elapsed_ms = performance.now() - start;
              window.lastStudyProgress = progress;
              return {
                elapsed_ms,
                total: progress.context.total,
                completed: progress.completed,
                failures: progress.failures,
                remaining: progress.remaining,
                timings: progress.timings,
                traffic: progress.traffic,
              };
            }, fixture);
          } finally {
            clearInterval(sampler);
            page.off("request", onRequest);
            page.off("response", onResponse);
            page.off("pageerror", onError);
          }
          const after = usage();
          const verified = await page.evaluate(async (fixture) => {
            const progress = window.lastStudyProgress;
            const rows = [];
            for (let page = 0; ; page++) {
              const result = await window.studyStorage.studyEventPage(
                fixture.owner,
                progress.context.id,
                page,
                500,
              );
              rows.push(...result.rows);
              if (rows.length >= result.total) break;
            }
            const canonical = JSON.stringify({
              config: progress.context.config,
              catalog_hash: progress.context.catalog_hash,
              processed: progress.processed,
              failures: progress.failures,
              batchStocks: progress.batchStocks,
              pendingBatches: progress.pendingBatches,
              failedBatches: progress.failedBatches,
              horizons: progress.horizons,
              swing: progress.swing,
              bySymbol: progress.bySymbol,
              byDay: progress.byDay,
              rows,
            });
            const hash = await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(canonical),
            );
            const canonical_sha256 = Array.from(new Uint8Array(hash), (b) =>
              b.toString(16).padStart(2, "0"),
            ).join("");
            await (
              await import("/src/api/client.ts")
            ).api.cancelStudy(progress.context.id, false, "screen");
            await window.studyStorage.clearStudyOwner(fixture.owner);
            return { canonical_sha256, events: rows.length };
          }, fixture);
          Object.assign(result, verified);
          const received = await Promise.all(responses);
          assert.deepEqual(errors, []);
          assert.equal(result.total, fixture.expected_total);
          assert.equal(result.completed, fixture.expected_completed);
          assert.equal(result.failures.length, fixture.expected_failures);
          assert.equal(result.remaining, 0);
          assert.equal(result.events, fixture.expected_events);
          if (output.length)
            assert.equal(result.canonical_sha256, output[0].canonical_sha256);
          const row = {
            label,
            round,
            temperature,
            ...result,
            cpu_usec: after.cpu_usec - before.cpu_usec,
            sampled_cgroup_memory_peak_bytes: memoryPeak,
            api_requests: requests.length,
            api_request_body_bytes: requests.reduce((n, r) => n + r.bytes, 0),
            api_response_body_bytes: received.reduce((n, r) => n + r.bytes, 0),
            response_statuses: received.reduce(
              (out, r) => ({ ...out, [r.status]: (out[r.status] || 0) + 1 }),
              {},
            ),
            routes: requests.reduce(
              (out, r) => ({
                ...out,
                [r.method + " " + r.route]:
                  (out[r.method + " " + r.route] || 0) + 1,
              }),
              {},
            ),
          };
          output.push(row);
          console.log("SCREEN_SAMPLE " + JSON.stringify(row));
        }
      } finally {
        await context.close();
        await server.close();
      }
    }
  }
  console.log(
    "SCREEN_RESULT " +
      JSON.stringify({
        schema: "idx-screening-browser-paired-1",
        input: fixture.input,
        injected_api_rtt_ms: rtt,
        latency_method:
          "one fixed delay before forwarding each API request on isolated loopback; modeled latency, not a remote network measurement",
        source_sha256: sourceHashes,
        scope:
          "runSignalStudy through disposable Go API, WASM features and IndexedDB commit; excludes React rendering, module import, result readback and cleanup",
        identity: "synthetic, not a real authenticated user",
        cpu_scope:
          "whole isolated cgroup including API, Vite and Chromium; excludes readback/cleanup",
        network_scope:
          "decoded API bodies during runSignalStudy; excludes headers, assets and cleanup",
        samples: output,
      }),
  );
} finally {
  await browser.close();
}
