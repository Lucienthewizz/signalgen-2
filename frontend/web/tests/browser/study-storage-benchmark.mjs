// Bounded native IndexedDB benchmark and verification runner for study storage
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storagePath = path.resolve(
  __dirname,
  "../../src/analysis/signal-study-storage.ts",
);

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
    args: ["--disable-dev-shm-usage", "--disable-gpu"],
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

        function computeMedian(arr) {
          if (arr.length === 0) return 0;
          const sorted = [...arr].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          return sorted.length % 2 !== 0
            ? sorted[mid]
            : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));
        }

        async function sha256Hex(str) {
          const buf = new TextEncoder().encode(str);
          const digest = await crypto.subtle.digest("SHA-256", buf);
          return Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        }

        const benchmarkScenarios = [];
        const correctness = {};

        // Run benchmark matrix with 1 warmup + 3 paired timed iterations
        for (const count of symbolCounts) {
          for (const density of densities) {
            const totalEvents = count * density;
            const symbols = Array.from({ length: count }, (_, i) =>
              "SYM" + String(i).padStart(4, "0"),
            );
            const totalPages = Math.ceil(totalEvents / 50);
            const midPage = Math.floor(totalPages / 2);
            const latePage = Math.max(0, totalPages - 1);

            // Warmup iteration (unrecorded)
            {
              await clearAllStudyResults();
              const wOwner = `warmup-${count}-${density}`;
              const wRun = `wrun-${count}-${density}`;
              for (const sym of symbols) {
                await storeStudySymbol(
                  wOwner,
                  wRun,
                  sym,
                  makeResult(sym, density),
                  new AbortController().signal,
                );
              }
              await studyEventPage(wOwner, wRun, 0, 50);
              await studyEventPage(wOwner, wRun, midPage, 50);
              await studyEventPage(wOwner, wRun, latePage, 50);
              for (let p = 0; ; p++) {
                const found = await studyEventPage(wOwner, wRun, p, 100);
                if ((p + 1) * 100 >= found.total) break;
              }
              await clearStudyOwner(wOwner);
            }

            // 3 Timed iterations
            const samples = [];
            let allVerified = true;

            for (let iter = 0; iter < 3; iter++) {
              await clearAllStudyResults();
              const owner = `user-bench-${count}-${density}-i${iter}`;
              const run = `run-${count}-${density}-i${iter}`;

              // 1. Measure Store
              const storeStart = performance.now();
              for (const sym of symbols) {
                const res = makeResult(sym, density);
                await storeStudySymbol(
                  owner,
                  run,
                  sym,
                  res,
                  new AbortController().signal,
                );
              }
              const storeMs = performance.now() - storeStart;

              // 2. Measure Page 0 (size 50)
              const p0Start = performance.now();
              const p0 = await studyEventPage(owner, run, 0, 50);
              const p0Ms = performance.now() - p0Start;

              // 3. Measure Middle Page (size 50)
              const pMidStart = performance.now();
              const pMid = await studyEventPage(owner, run, midPage, 50);
              const pMidMs = performance.now() - pMidStart;

              // 4. Measure Late Page (size 50)
              const pLateStart = performance.now();
              const pLate = await studyEventPage(owner, run, latePage, 50);
              const pLateMs = performance.now() - pLateStart;

              // 5. Measure CSV Export (size 100)
              const csvStart = performance.now();
              let totalCsvRows = 0;
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

              const iterVerified =
                p0.total === totalEvents &&
                totalCsvRows === totalEvents &&
                checkAfterClean.total === 0 &&
                checkAfterClean.rows.length === 0;

              if (!iterVerified) allVerified = false;

              samples.push({
                storeMs: Number(storeMs.toFixed(2)),
                p0Ms: Number(p0Ms.toFixed(2)),
                pMidMs: Number(pMidMs.toFixed(2)),
                pLateMs: Number(pLateMs.toFixed(2)),
                csvExportMs: Number(csvExportMs.toFixed(2)),
                cleanMs: Number(cleanMs.toFixed(2)),
              });
            }

            const storeTimes = samples.map((s) => s.storeMs);
            const p0Times = samples.map((s) => s.p0Ms);
            const pMidTimes = samples.map((s) => s.pMidMs);
            const pLateTimes = samples.map((s) => s.pLateMs);
            const csvTimes = samples.map((s) => s.csvExportMs);
            const cleanTimes = samples.map((s) => s.cleanMs);

            benchmarkScenarios.push({
              symbols: count,
              density,
              totalEvents,
              samples,
              storeMs: computeMedian(storeTimes),
              storeRange: [Math.min(...storeTimes), Math.max(...storeTimes)],
              p0Ms: computeMedian(p0Times),
              p0Range: [Math.min(...p0Times), Math.max(...p0Times)],
              pMidMs: computeMedian(pMidTimes),
              pMidRange: [Math.min(...pMidTimes), Math.max(...pMidTimes)],
              pLateMs: computeMedian(pLateTimes),
              pLateRange: [Math.min(...pLateTimes), Math.max(...pLateTimes)],
              csvExportMs: computeMedian(csvTimes),
              csvRange: [Math.min(...csvTimes), Math.max(...csvTimes)],
              cleanMs: computeMedian(cleanTimes),
              cleanRange: [Math.min(...cleanTimes), Math.max(...cleanTimes)],
              verified: allVerified,
            });
          }
        }

        // ==========================================
        // Exact Semantics & Correctness Verification
        // ==========================================
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
        const otherCheckBefore = await studyEventPage(
          otherOwner,
          testRun,
          0,
          50,
        );
        await clearStudyOwner(testOwner);
        const testCheckAfter = await studyEventPage(testOwner, testRun, 0, 50);
        const otherCheckAfter = await studyEventPage(
          otherOwner,
          testRun,
          0,
          50,
        );
        correctness.ownerIsolation =
          otherCheckBefore.total === 15 &&
          testCheckAfter.total === 0 &&
          otherCheckAfter.total === 15;

        // C. Pre-flight and Mid-transaction cancellation rollback
        const abortPre = new AbortController();
        abortPre.abort();
        let preCancelRejected = false;
        try {
          await storeStudySymbol(
            otherOwner,
            testRun,
            "STOCK_PRE",
            makeResult("STOCK_PRE", 10),
            abortPre.signal,
          );
        } catch (e) {
          preCancelRejected = e?.name === "AbortError";
        }

        const abortMid = new AbortController();
        let midCancelRejected = false;
        const storePromise = storeStudySymbol(
          otherOwner,
          testRun,
          "STOCK_MID",
          makeResult("STOCK_MID", 100),
          abortMid.signal,
        );
        // Abort on next event-loop tick while transaction is active
        setTimeout(() => abortMid.abort(), 0);
        try {
          await storePromise;
        } catch (e) {
          midCancelRejected =
            e?.name === "AbortError" || /cancel/i.test(String(e));
        }

        const afterCancel = await studyEventPage(otherOwner, testRun, 0, 50);
        correctness.cancellationRollback =
          preCancelRejected &&
          midCancelRejected &&
          afterCancel.total === 15 &&
          afterCancel.rows.every((r) => r.symbol === "STOCKB");

        // D. Legacy run write regression:
        // Existing records in 'batches' without metadata in 'sizes' must be preserved
        // when a new symbol is stored and an existing symbol is overwritten.
        await clearAllStudyResults();
        const legacyOwner = "owner-legacy";
        const legacyRun = "run-legacy";
        const rawDb = await new Promise((resolve, reject) => {
          const req = indexedDB.open("signalgen-study-temporary-1", 2);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        await new Promise((resolve, reject) => {
          const tx = rawDb.transaction(["batches"], "readwrite");
          const batches = tx.objectStore("batches");
          // Seed LEGACY_A (7 events) and LEGACY_B (9 events) directly without touching 'sizes'
          const resA = makeResult("LEGACY_A", 7);
          const resB = makeResult("LEGACY_B", 9);
          const evA = resA.events.map((e) => [
            e.timestamp,
            e.signal_type,
            e.reference_price,
            e.outcomes.map((o) => [2, o.step, 0, o.price, o.return_pct]),
            [4, 3, 0, 106.2, 6.2],
          ]);
          const evB = resB.events.map((e) => [
            e.timestamp,
            e.signal_type,
            e.reference_price,
            e.outcomes.map((o) => [2, o.step, 0, o.price, o.return_pct]),
            [4, 3, 0, 106.2, 6.2],
          ]);
          batches.put({
            key: `${legacyOwner}\0${legacyRun}\0LEGACY_A`,
            owner: legacyOwner,
            run: legacyRun,
            symbol: "LEGACY_A",
            bytes: 500,
            events: evA,
          });
          batches.put({
            key: `${legacyOwner}\0${legacyRun}\0LEGACY_B`,
            owner: legacyOwner,
            run: legacyRun,
            symbol: "LEGACY_B",
            bytes: 600,
            events: evB,
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        rawDb.close();

        // Now store new symbol LEGACY_C (5 events) and overwrite LEGACY_A (12 events)
        await storeStudySymbol(
          legacyOwner,
          legacyRun,
          "LEGACY_C",
          makeResult("LEGACY_C", 5),
          new AbortController().signal,
        );
        await storeStudySymbol(
          legacyOwner,
          legacyRun,
          "LEGACY_A",
          makeResult("LEGACY_A", 12),
          new AbortController().signal,
        );

        const legacyPage = await studyEventPage(legacyOwner, legacyRun, 0, 50);
        let legacyCsvCount = 0;
        for (let p = 0; ; p++) {
          const found = await studyEventPage(legacyOwner, legacyRun, p, 10);
          legacyCsvCount += found.rows.length;
          if ((p + 1) * 10 >= found.total) break;
        }

        correctness.legacyWriteRegression =
          legacyPage.total === 26 && // 12 (A) + 9 (B) + 5 (C)
          legacyCsvCount === 26 &&
          legacyPage.rows.filter((r) => r.symbol === "LEGACY_A").length ===
            12 &&
          legacyPage.rows.filter((r) => r.symbol === "LEGACY_B").length === 9 &&
          legacyPage.rows.filter((r) => r.symbol === "LEGACY_C").length === 5;

        // E. Concurrent writers on different symbols in native IndexedDB
        await clearAllStudyResults();
        const concOwner = "owner-conc";
        const concRun = "run-conc";
        await Promise.all([
          storeStudySymbol(
            concOwner,
            concRun,
            "CONC_1",
            makeResult("CONC_1", 10),
            new AbortController().signal,
          ),
          storeStudySymbol(
            concOwner,
            concRun,
            "CONC_2",
            makeResult("CONC_2", 15),
            new AbortController().signal,
          ),
        ]);
        const concPage = await studyEventPage(concOwner, concRun, 0, 50);
        correctness.concurrentWriters =
          concPage.total === 25 &&
          concPage.rows.length === 25 &&
          concPage.rows.filter((r) => r.symbol === "CONC_1").length === 10 &&
          concPage.rows.filter((r) => r.symbol === "CONC_2").length === 15;

        // F. Stable ordering & outcome completeness
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

        // G. Quota rollback
        const hugeEvents = [];
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
        correctness.quotaRollback = quotaRejected && afterQuota.total === 20;

        // H. Exact Canonical Equality Oracle
        // Build independent oracle dataset with nulls, all 6 outcome statuses, and high-precision floats
        await clearAllStudyResults();
        const oracleOwner = "owner-oracle";
        const oracleRun = "run-oracle";
        const oracleSymbols = ["AAPL", "GOOGL", "MSFT", "TSLA"];
        const statuses = [
          "evaluated",
          "incomplete",
          "time_exit",
          "stop_loss",
          "take_profit",
          "screened",
        ];
        const allOracleEvents = [];

        for (let sIdx = 0; sIdx < oracleSymbols.length; sIdx++) {
          const sym = oracleSymbols[sIdx];
          const count = (sIdx + 1) * 8; // AAPL:8, GOOGL:16, MSFT:24, TSLA:32 = 80 events
          const events = [];
          for (let i = 0; i < count; i++) {
            const hasNullPrice = i % 7 === 0;
            const hasNullTimestamp = i % 5 === 0;
            const status = statuses[i % statuses.length];
            const o1 = {
              basis: "open",
              step: 1,
              status,
              price: hasNullPrice
                ? null
                : Number((146.987654321 + i * 0.111111111).toFixed(9)),
              return_pct: hasNullPrice
                ? null
                : Number((i * 0.123456789 - 0.54321).toFixed(8)),
            };
            if (!hasNullTimestamp) {
              o1.timestamp = `2026-01-${String((i % 28) + 1).padStart(2, "0")}T10:00:00Z`;
            }
            const event = {
              symbol: sym,
              timestamp: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T09:30:${String(i % 60).padStart(2, "0")}Z`,
              signal_type: i % 2 === 0 ? "BUY" : "SELL",
              reference_price: Number((145.123456789 + i * 0.333333333).toFixed(9)),
              outcomes: [
                o1,
                {
                  basis: "close",
                  step: 2,
                  status: statuses[(i + 1) % statuses.length],
                  price: Number((148.555555555 + i * 0.222222222).toFixed(9)),
                  return_pct: Number((1.55555555 + i * 0.05).toFixed(8)),
                },
              ],
              swing: {
                basis: "barrier",
                step: 3,
                status: statuses[(i + 2) % statuses.length],
                price: Number((150.777777777 + i * 0.123).toFixed(9)),
                return_pct: Number((3.88888888 + i * 0.01).toFixed(8)),
              },
            };
            events.push(event);
            allOracleEvents.push(event);
          }

          await storeStudySymbol(
            oracleOwner,
            oracleRun,
            sym,
            {
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
                sum_return_pct: 0,
                mean_return_pct: 0,
                win_rate: 100,
              },
              by_symbol: [],
              by_day: [],
              warnings: [],
            },
            new AbortController().signal,
          );
        }

        // Paginate through all events via 50-row studyEventPage
        const paginatedRows = [];
        for (let p = 0; ; p++) {
          const res = await studyEventPage(oracleOwner, oracleRun, p, 50);
          paginatedRows.push(...res.rows);
          if ((p + 1) * 50 >= res.total) break;
        }

        // Export through all events via CSV pagination (100 rows)
        const csvRows = [];
        for (let p = 0; ; p++) {
          const res = await studyEventPage(oracleOwner, oracleRun, p, 100);
          csvRows.push(...res.rows);
          if ((p + 1) * 100 >= res.total) break;
        }

        const oracleCanonicalJson = JSON.stringify(allOracleEvents);
        const paginatedCanonicalJson = JSON.stringify(paginatedRows);
        const csvCanonicalJson = JSON.stringify(csvRows);

        const oracleSha256 = await sha256Hex(oracleCanonicalJson);
        const paginatedSha256 = await sha256Hex(paginatedCanonicalJson);
        const csvSha256 = await sha256Hex(csvCanonicalJson);

        correctness.exactCanonicalEquality = {
          totalEvents: allOracleEvents.length,
          oracleSha256,
          paginatedSha256,
          csvSha256,
          matches:
            oracleSha256 === paginatedSha256 &&
            oracleSha256 === csvSha256 &&
            allOracleEvents.length === paginatedRows.length &&
            allOracleEvents.length === csvRows.length,
        };

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

      // Rigorous assertion validation
      const allScenariosVerified = res.benchmarkScenarios.every(
        (s) => s.verified === true,
      );
      const c = res.correctness;
      const allCorrectnessPassed =
        c.overwriteAccounting === true &&
        c.ownerIsolation === true &&
        c.cancellationRollback === true &&
        c.legacyWriteRegression === true &&
        c.concurrentWriters === true &&
        c.stableOrdering === true &&
        c.fullNumbersAndOutcomes === true &&
        c.quotaRollback === true &&
        c.exactCanonicalEquality?.matches === true;

      if (!allScenariosVerified || !allCorrectnessPassed) {
        console.error(
          "FATAL: Invariant failure in benchmark scenarios or correctness suite!",
        );
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("FATAL benchmark execution error:", err);
      process.exit(1);
    });
}
