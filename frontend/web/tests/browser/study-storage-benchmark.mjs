// Bounded native IndexedDB benchmark and verification runner for study storage
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storagePath = path.resolve(__dirname, "../../src/analysis/signal-study-storage.ts");

function transpileStorage(sourceFile) {
  const code = fs.readFileSync(sourceFile, "utf8");
  return ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

export async function runBenchmark(options = {}) {
  const {
    symbolCounts = [10, 100, 500],
    densities = [2, 10, 30],
    label = "benchmark",
  } = options;

  const storageJs = transpileStorage(storagePath);

  // Serve a clean HTML page with transpile code embedded as an ES module
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Storage Benchmark</title></head>
<body>
<div id="status">Ready</div>
<script type="module">
${storageJs}
window.__storage = {
  storeStudySymbol,
  studyEventPage,
  clearStudyOwner,
  clearAllStudyResults,
  STUDY_STORAGE_LIMIT,
};
document.getElementById("status").textContent = "Loaded";
</script>
</body>
</html>`;

  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  try {
    const page = await browser.newPage();
    await page.goto(url);
    await page.waitForFunction(() => window.__storage !== undefined);

    const results = await page.evaluate(
      async ({ symbolCounts, densities, label }) => {
        const {
          storeStudySymbol,
          studyEventPage,
          clearStudyOwner,
          clearAllStudyResults,
          STUDY_STORAGE_LIMIT,
        } = window.__storage;

        function makeResult(symbol, eventCount) {
          const events = [];
          for (let i = 0; i < eventCount; i++) {
            const day = String((i % 28) + 1).padStart(2, "0");
            events.push({
              symbol,
              timestamp: `2026-01-${day}T10:00:00Z`,
              signal_type: i % 2 === 0 ? "BUY" : "SELL",
              reference_price: 100 + (i % 50) * 0.5,
              outcomes: [
                {
                  basis: "close",
                  step: 1,
                  status: "evaluated",
                  price: 102.5,
                  return_pct: 2.5,
                  timestamp: `2026-01-${day}T11:00:00Z`,
                },
                {
                  basis: "close",
                  step: 2,
                  status: i % 3 === 0 ? "take_profit" : "evaluated",
                  price: 105.0,
                  return_pct: 5.0,
                },
              ],
              swing: {
                basis: "barrier",
                step: 3,
                status: "evaluated",
                price: 106.2,
                return_pct: 6.2,
              },
            });
          }
          return {
            schema_version: "signal-study-1",
            policy_version: "signal-close-independent-1",
            config: { from: "2026-01-01", to: "2026-01-31", n_steps: 3 },
            events,
            horizons: [],
            swing: {
              signals: events.length,
              evaluated: events.length,
              missing: 0,
              wins: events.length,
              losses: 0,
              flats: 0,
              sum_return_pct: events.length * 5,
              mean_return_pct: 5,
              win_rate: 100,
            },
            by_symbol: [],
            by_day: [],
            warnings: [],
          };
        }

        const benchmarkScenarios = [];
        const correctness = {};

        // Run benchmark matrix
        for (const count of symbolCounts) {
          for (const density of densities) {
            await clearAllStudyResults();
            const owner = `user-bench-${count}-${density}`;
            const run = `run-${count}-${density}`;
            const symbols = Array.from({ length: count }, (_, i) =>
              "SYM" + String(i).padStart(4, "0"),
            );

            // 1. Measure Store
            const storeStart = performance.now();
            for (const sym of symbols) {
              const res = makeResult(sym, density);
              await storeStudySymbol(owner, run, sym, res, new AbortController().signal);
            }
            const storeMs = performance.now() - storeStart;
            const totalEvents = count * density;

            // 2. Measure Page 0 (size 50)
            const p0Start = performance.now();
            const p0 = await studyEventPage(owner, run, 0, 50);
            const p0Ms = performance.now() - p0Start;

            // 3. Measure Middle Page (size 50)
            const totalPages = Math.ceil(totalEvents / 50);
            const midPage = Math.floor(totalPages / 2);
            const pMidStart = performance.now();
            const pMid = await studyEventPage(owner, run, midPage, 50);
            const pMidMs = performance.now() - pMidStart;

            // 4. Measure Late Page (size 50)
            const latePage = Math.max(0, totalPages - 1);
            const pLateStart = performance.now();
            const pLate = await studyEventPage(owner, run, latePage, 50);
            const pLateMs = performance.now() - pLateStart;

            // 5. Measure CSV Export (size 100)
            const csvStart = performance.now();
            let totalCsvRows = 0;
            const exportPages = Math.ceil(totalEvents / 100);
            for (let p = 0; ; p++) {
              const found = await studyEventPage(owner, run, p, 100);
              totalCsvRows += found.rows.length;
              if ((p + 1) * 100 >= found.total) break;
            }
            const csvExportMs = performance.now() - csvStart;

            // 6. Measure Cleanup
            const cleanStart = performance.now();
            await clearStudyOwner(owner);
            const cleanMs = performance.now() - cleanStart;

            const checkAfterClean = await studyEventPage(owner, run, 0, 50);

            benchmarkScenarios.push({
              symbols: count,
              density,
              totalEvents,
              storeMs: Number(storeMs.toFixed(2)),
              p0Ms: Number(p0Ms.toFixed(2)),
              pMidMs: Number(pMidMs.toFixed(2)),
              pLateMs: Number(pLateMs.toFixed(2)),
              csvExportMs: Number(csvExportMs.toFixed(2)),
              cleanMs: Number(cleanMs.toFixed(2)),
              verified:
                p0.total === totalEvents &&
                totalCsvRows === totalEvents &&
                checkAfterClean.total === 0 &&
                checkAfterClean.rows.length === 0,
            });
          }
        }

        // Exact Semantics & Correctness Verification:
        await clearAllStudyResults();
        const testOwner = "owner-verify";
        const otherOwner = "owner-other";
        const testRun = "run-verify";

        // A. Overwrite accounting
        await storeStudySymbol(
          testOwner,
          testRun,
          "STOCKA",
          makeResult("STOCKA", 10),
          new AbortController().signal,
        );
        const checkInitial = await studyEventPage(testOwner, testRun, 0, 50);
        await storeStudySymbol(
          testOwner,
          testRun,
          "STOCKA",
          makeResult("STOCKA", 25),
          new AbortController().signal,
        );
        const checkOverwrite = await studyEventPage(testOwner, testRun, 0, 50);
        correctness.overwriteAccounting =
          checkInitial.total === 10 &&
          checkOverwrite.total === 25 &&
          checkOverwrite.rows.length === 25;

        // B. Owner isolation
        await storeStudySymbol(
          otherOwner,
          testRun,
          "STOCKB",
          makeResult("STOCKB", 15),
          new AbortController().signal,
        );
        const otherCheckBefore = await studyEventPage(otherOwner, testRun, 0, 50);
        await clearStudyOwner(testOwner);
        const testCheckAfter = await studyEventPage(testOwner, testRun, 0, 50);
        const otherCheckAfter = await studyEventPage(otherOwner, testRun, 0, 50);
        correctness.ownerIsolation =
          otherCheckBefore.total === 15 &&
          testCheckAfter.total === 0 &&
          otherCheckAfter.total === 15;

        // C. Cancellation rollback
        const abortCtrl = new AbortController();
        abortCtrl.abort();
        let cancelRejected = false;
        try {
          await storeStudySymbol(
            otherOwner,
            testRun,
            "STOCKC",
            makeResult("STOCKC", 10),
            abortCtrl.signal,
          );
        } catch (e) {
          cancelRejected = e?.name === "AbortError";
        }
        const afterCancel = await studyEventPage(otherOwner, testRun, 0, 50);
        correctness.cancellationRollback =
          cancelRejected && afterCancel.total === 15;

        // D. Stable ordering & outcome completeness
        await clearAllStudyResults();
        const orderSymbols = ["ZOO", "ALPHA", "MID", "BETA"];
        for (const s of orderSymbols) {
          await storeStudySymbol(
            testOwner,
            testRun,
            s,
            makeResult(s, 5),
            new AbortController().signal,
          );
        }
        const orderedPage = await studyEventPage(testOwner, testRun, 0, 50);
        const returnedSymbols = orderedPage.rows.map((r) => r.symbol);
        const isSorted =
          returnedSymbols.slice(0, 5).every((s) => s === "ALPHA") &&
          returnedSymbols.slice(5, 10).every((s) => s === "BETA") &&
          returnedSymbols.slice(10, 15).every((s) => s === "MID") &&
          returnedSymbols.slice(15, 20).every((s) => s === "ZOO");
        const fullNumbers = orderedPage.rows.every(
          (r) =>
            typeof r.reference_price === "number" &&
            r.outcomes.length === 2 &&
            r.outcomes[0].price === 102.5 &&
            r.outcomes[0].return_pct === 2.5 &&
            r.swing.price === 106.2,
        );
        correctness.stableOrdering = isSorted;
        correctness.fullNumbersAndOutcomes = fullNumbers;

        // E. Quota rollback
        // Generate an event array that exceeds STUDY_STORAGE_LIMIT (128 MiB)
        const hugeEvents = [];
        // ~10,000 outcomes with large strings to exceed 128 MiB in bytes calculation or test limit
        const hugePayload = "X".repeat(5000);
        for (let i = 0; i < 30000; i++) {
          hugeEvents.push({
            symbol: "HUGE",
            timestamp: "2026-01-01T00:00:00Z",
            signal_type: "BUY",
            reference_price: 100,
            outcomes: [
              {
                basis: "close",
                step: 1,
                status: "evaluated",
                price: 100,
                return_pct: 0,
                timestamp: hugePayload,
              },
            ],
            swing: {
              basis: "barrier",
              step: 1,
              status: "evaluated",
              price: 100,
              return_pct: 0,
            },
          });
        }
        let quotaRejected = false;
        try {
          await storeStudySymbol(
            testOwner,
            testRun,
            "HUGE",
            {
              schema_version: "signal-study-1",
              policy_version: "signal-close-independent-1",
              config: { from: "2026-01-01", to: "2026-01-31", n_steps: 1 },
              events: hugeEvents,
              horizons: [],
              swing: {
                signals: 0,
                evaluated: 0,
                missing: 0,
                wins: 0,
                losses: 0,
                flats: 0,
                sum_return_pct: 0,
                mean_return_pct: 0,
                win_rate: 0,
              },
              by_symbol: [],
              by_day: [],
              warnings: [],
            },
            new AbortController().signal,
          );
        } catch (e) {
          quotaRejected = /128\s*MiB/i.test(String(e));
        }
        const afterQuota = await studyEventPage(testOwner, testRun, 0, 50);
        correctness.quotaRollback =
          quotaRejected && afterQuota.total === 20;

        await clearAllStudyResults();

        return {
          label,
          timestamp: new Date().toISOString(),
          benchmarkScenarios,
          correctness,
        };
      },
      { symbolCounts, densities, label },
    );

    return results;
  } finally {
    await browser.close();
    server.close();
  }
}

// CLI direct invocation
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const label = process.argv[2] || "benchmark";
  runBenchmark({ label })
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
