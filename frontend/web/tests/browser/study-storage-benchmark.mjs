// Bounded native IndexedDB benchmark and verification runner for study storage
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const candidatePath = path.resolve(
  __dirname,
  "../../src/analysis/signal-study-storage.ts",
);
const baselinePath = path.resolve(
  __dirname,
  "../fixtures/signal-study-storage.baseline.ts",
);
const lockfilePath = path.resolve(__dirname, "../../package-lock.json");

function getFileSha256(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

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
    label = "paired-benchmark",
  } = options;

  const candidateJs = transpileStorage(candidatePath);
  const baselineJs = transpileStorage(baselinePath);

  const indexHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Storage Benchmark</title></head>
<body>
<div id="status">Loading</div>
<script type="module">
import * as candidate from "/candidate.js";
import * as baseline from "/baseline.js";
window.__storageCandidate = candidate;
window.__storageBaseline = baseline;
document.getElementById("status").textContent = "Loaded";
</script>
</body>
</html>`;

  const server = http.createServer((req, res) => {
    if (req.url === "/candidate.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
      });
      res.end(candidateJs);
    } else if (req.url === "/baseline.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
      });
      res.end(baselineJs);
    } else {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(indexHtml);
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--disable-gpu"],
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const page2 = await context.newPage();
    await page.goto(url);
    await page2.goto(url);
    await page.waitForFunction(
      () =>
        window.__storageCandidate !== undefined &&
        window.__storageBaseline !== undefined,
    );
    await page2.waitForFunction(() => window.__storageCandidate !== undefined);

    // =========================================================================
    // R2: Two-Page Same-Context Shared-DB Concurrency & Overwrite Verification
    // =========================================================================
    await page.evaluate(async () => {
      await window.__storageCandidate.clearAllStudyResults();
    });

    const diffOwner = "owner-twopage-diff";
    const diffRun = "run-twopage-diff";
    const p1WriteDiff = page.evaluate(
      async ({ owner, run }) => {
        const { storeStudySymbol } = window.__storageCandidate;
        function makeSimpleResult(symbol, count) {
          const events = [];
          for (let i = 0; i < count; i++) {
            events.push({
              symbol,
              timestamp: `2026-01-01T10:00:00Z`,
              signal_type: "BUY",
              reference_price: 100,
              outcomes: [
                {
                  basis: "close",
                  step: 1,
                  status: "evaluated",
                  price: 101,
                  return_pct: 1,
                },
              ],
              swing: {
                basis: "barrier",
                step: 1,
                status: "evaluated",
                price: 102,
                return_pct: 2,
              },
            });
          }
          return {
            schema_version: "signal-study-1",
            policy_version: "signal-close-independent-1",
            config: { from: "2026-01-01", to: "2026-01-31", n_steps: 1 },
            events,
            horizons: [],
            swing: {
              signals: count,
              evaluated: count,
              missing: 0,
              wins: count,
              losses: 0,
              flats: 0,
              sum_return_pct: 0,
              mean_return_pct: 0,
              win_rate: 100,
            },
            by_symbol: [],
            by_day: [],
            warnings: [],
          };
        }
        await storeStudySymbol(
          owner,
          run,
          "SYM_P1",
          makeSimpleResult("SYM_P1", 10),
          new AbortController().signal,
        );
      },
      { owner: diffOwner, run: diffRun },
    );

    const p2WriteDiff = page2.evaluate(
      async ({ owner, run }) => {
        const { storeStudySymbol } = window.__storageCandidate;
        function makeSimpleResult(symbol, count) {
          const events = [];
          for (let i = 0; i < count; i++) {
            events.push({
              symbol,
              timestamp: `2026-01-01T10:00:00Z`,
              signal_type: "BUY",
              reference_price: 100,
              outcomes: [
                {
                  basis: "close",
                  step: 1,
                  status: "evaluated",
                  price: 101,
                  return_pct: 1,
                },
              ],
              swing: {
                basis: "barrier",
                step: 1,
                status: "evaluated",
                price: 102,
                return_pct: 2,
              },
            });
          }
          return {
            schema_version: "signal-study-1",
            policy_version: "signal-close-independent-1",
            config: { from: "2026-01-01", to: "2026-01-31", n_steps: 1 },
            events,
            horizons: [],
            swing: {
              signals: count,
              evaluated: count,
              missing: 0,
              wins: count,
              losses: 0,
              flats: 0,
              sum_return_pct: 0,
              mean_return_pct: 0,
              win_rate: 100,
            },
            by_symbol: [],
            by_day: [],
            warnings: [],
          };
        }
        await storeStudySymbol(
          owner,
          run,
          "SYM_P2",
          makeSimpleResult("SYM_P2", 15),
          new AbortController().signal,
        );
      },
      { owner: diffOwner, run: diffRun },
    );

    await Promise.all([p1WriteDiff, p2WriteDiff]);

    const twoPageDiffCheck = await page.evaluate(
      async ({ owner, run }) => {
        const { studyEventPage } = window.__storageCandidate;
        const pageRes = await studyEventPage(owner, run, 0, 50);
        const p1Rows = pageRes.rows.filter((r) => r.symbol === "SYM_P1").length;
        const p2Rows = pageRes.rows.filter((r) => r.symbol === "SYM_P2").length;

        const db = await new Promise((res, rej) => {
          const req = indexedDB.open("signalgen-study-temporary-1", 2);
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        const meta = await new Promise((res, rej) => {
          const tx = db.transaction(["sizes"], "readonly");
          const req = tx.objectStore("sizes").get(`meta:${owner}\0${run}\0`);
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        const ownerBytes = await new Promise((res, rej) => {
          const tx = db.transaction(["sizes"], "readonly");
          const req = tx.objectStore("sizes").get(owner);
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        db.close();

        return {
          total: pageRes.total,
          rowsCount: pageRes.rows.length,
          p1Rows,
          p2Rows,
          metaTotal: meta?.total,
          metaSymbols: meta?.s,
          metaCounts: meta?.c,
          hasOwnerBytes: typeof ownerBytes === "number" && ownerBytes > 0,
        };
      },
      { owner: diffOwner, run: diffRun },
    );

    const twoPageSharedDbConcurrentDifferentSymbols =
      twoPageDiffCheck.total === 25 &&
      twoPageDiffCheck.rowsCount === 25 &&
      twoPageDiffCheck.p1Rows === 10 &&
      twoPageDiffCheck.p2Rows === 15 &&
      twoPageDiffCheck.metaTotal === 25 &&
      Array.isArray(twoPageDiffCheck.metaSymbols) &&
      twoPageDiffCheck.metaSymbols.includes("SYM_P1") &&
      twoPageDiffCheck.metaSymbols.includes("SYM_P2") &&
      twoPageDiffCheck.hasOwnerBytes === true;

    // Test 2B: Concurrent SAME-symbol overwrite race across two pages
    await page.evaluate(async () => {
      await window.__storageCandidate.clearAllStudyResults();
    });

    const sameOwner = "owner-twopage-same";
    const sameRun = "run-twopage-same";
    const raceSymbol = "RACE_SYM";

    const p1WriteSame = page.evaluate(
      async ({ owner, run, symbol }) => {
        const { storeStudySymbol } = window.__storageCandidate;
        function makeSimpleResult(sym, count) {
          const events = [];
          for (let i = 0; i < count; i++) {
            events.push({
              symbol: sym,
              timestamp: `2026-01-01T10:00:00Z`,
              signal_type: "BUY",
              reference_price: 100,
              outcomes: [
                {
                  basis: "close",
                  step: 1,
                  status: "evaluated",
                  price: 101,
                  return_pct: 1,
                },
              ],
              swing: {
                basis: "barrier",
                step: 1,
                status: "evaluated",
                price: 102,
                return_pct: 2,
              },
            });
          }
          return {
            schema_version: "signal-study-1",
            policy_version: "signal-close-independent-1",
            config: { from: "2026-01-01", to: "2026-01-31", n_steps: 1 },
            events,
            horizons: [],
            swing: {
              signals: count,
              evaluated: count,
              missing: 0,
              wins: count,
              losses: 0,
              flats: 0,
              sum_return_pct: 0,
              mean_return_pct: 0,
              win_rate: 100,
            },
            by_symbol: [],
            by_day: [],
            warnings: [],
          };
        }
        await storeStudySymbol(
          owner,
          run,
          symbol,
          makeSimpleResult(symbol, 10),
          new AbortController().signal,
        );
      },
      { owner: sameOwner, run: sameRun, symbol: raceSymbol },
    );

    const p2WriteSame = page2.evaluate(
      async ({ owner, run, symbol }) => {
        const { storeStudySymbol } = window.__storageCandidate;
        function makeSimpleResult(sym, count) {
          const events = [];
          for (let i = 0; i < count; i++) {
            events.push({
              symbol: sym,
              timestamp: `2026-01-01T10:00:00Z`,
              signal_type: "BUY",
              reference_price: 100,
              outcomes: [
                {
                  basis: "close",
                  step: 1,
                  status: "evaluated",
                  price: 101,
                  return_pct: 1,
                },
              ],
              swing: {
                basis: "barrier",
                step: 1,
                status: "evaluated",
                price: 102,
                return_pct: 2,
              },
            });
          }
          return {
            schema_version: "signal-study-1",
            policy_version: "signal-close-independent-1",
            config: { from: "2026-01-01", to: "2026-01-31", n_steps: 1 },
            events,
            horizons: [],
            swing: {
              signals: count,
              evaluated: count,
              missing: 0,
              wins: count,
              losses: 0,
              flats: 0,
              sum_return_pct: 0,
              mean_return_pct: 0,
              win_rate: 100,
            },
            by_symbol: [],
            by_day: [],
            warnings: [],
          };
        }
        await storeStudySymbol(
          owner,
          run,
          symbol,
          makeSimpleResult(symbol, 20),
          new AbortController().signal,
        );
      },
      { owner: sameOwner, run: sameRun, symbol: raceSymbol },
    );

    await Promise.all([p1WriteSame, p2WriteSame]);

    const twoPageSameCheck = await page.evaluate(
      async ({ owner, run, symbol }) => {
        const { studyEventPage } = window.__storageCandidate;
        const pageRes = await studyEventPage(owner, run, 0, 50);

        const db = await new Promise((res, rej) => {
          const req = indexedDB.open("signalgen-study-temporary-1", 2);
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        const meta = await new Promise((res, rej) => {
          const tx = db.transaction(["sizes"], "readonly");
          const req = tx.objectStore("sizes").get(`meta:${owner}\0${run}\0`);
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        const batch = await new Promise((res, rej) => {
          const tx = db.transaction(["batches"], "readonly");
          const req = tx
            .objectStore("batches")
            .get(`${owner}\0${run}\0${symbol}`);
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        const ownerBytes = await new Promise((res, rej) => {
          const tx = db.transaction(["sizes"], "readonly");
          const req = tx.objectStore("sizes").get(owner);
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        db.close();

        const symOccurrences =
          meta?.s?.filter((s) => s === symbol).length || 0;
        return {
          total: pageRes.total,
          rowsCount: pageRes.rows.length,
          allMatchSymbol: pageRes.rows.every((r) => r.symbol === symbol),
          symOccurrences,
          metaTotal: meta?.total,
          metaCount: meta?.c?.[0],
          batchEventCount: batch?.events?.length,
          batchBytes: batch?.bytes,
          ownerBytes,
          consistentBytes: batch?.bytes === ownerBytes,
        };
      },
      { owner: sameOwner, run: sameRun, symbol: raceSymbol },
    );

    const twoPageSharedDbConcurrentSameSymbolOverwrite =
      (twoPageSameCheck.total === 10 || twoPageSameCheck.total === 20) &&
      twoPageSameCheck.rowsCount === twoPageSameCheck.total &&
      twoPageSameCheck.allMatchSymbol === true &&
      twoPageSameCheck.symOccurrences === 1 &&
      twoPageSameCheck.metaTotal === twoPageSameCheck.total &&
      twoPageSameCheck.metaCount === twoPageSameCheck.total &&
      twoPageSameCheck.batchEventCount === twoPageSameCheck.total &&
      twoPageSameCheck.consistentBytes === true;

    // Close page2 to keep memory and pids bounded for the remaining tests
    await page2.close();

    // ==========================================
    // Exact Semantics & Correctness Verification
    // ==========================================
    const singlePageCorrectness = await page.evaluate(async () => {
      const {
        storeStudySymbol,
        studyEventPage,
        clearStudyOwner,
        clearAllStudyResults,
      } = window.__storageCandidate;

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

      async function sha256Hex(str) {
        const buf = new TextEncoder().encode(str);
        const digest = await crypto.subtle.digest("SHA-256", buf);
        return Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      }

      const results = {};
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
      results.overwriteAccounting =
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
      results.ownerIsolation =
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
      setTimeout(() => abortMid.abort(), 0);
      try {
        await storePromise;
      } catch (e) {
        midCancelRejected =
          e?.name === "AbortError" || /cancel/i.test(String(e));
      }

      const afterCancel = await studyEventPage(otherOwner, testRun, 0, 50);
      results.cancellationRollback =
        preCancelRejected &&
        midCancelRejected &&
        afterCancel.total === 15 &&
        afterCancel.rows.every((r) => r.symbol === "STOCKB");

      // D. Legacy run write regression:
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

      results.legacyWriteRegression =
        legacyPage.total === 26 &&
        legacyCsvCount === 26 &&
        legacyPage.rows.filter((r) => r.symbol === "LEGACY_A").length === 12 &&
        legacyPage.rows.filter((r) => r.symbol === "LEGACY_B").length === 9 &&
        legacyPage.rows.filter((r) => r.symbol === "LEGACY_C").length === 5;

      // E. Single-page concurrent writers on separate connections
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
      results.singlePageConcurrentWriters =
        concPage.total === 25 &&
        concPage.rows.length === 25 &&
        concPage.rows.filter((r) => r.symbol === "CONC_1").length === 10 &&
        concPage.rows.filter((r) => r.symbol === "CONC_2").length === 15;

      // F. Readonly transaction abort error rejection probe (Closing R3)
      const roOwner = "owner-ro-probe";
      const roRun = "run-ro-probe";
      await storeStudySymbol(
        roOwner,
        roRun,
        "RO_SYM",
        makeResult("RO_SYM", 5),
        new AbortController().signal,
      );
      let nativeRoRejectionObserved = false;
      const origTx = IDBDatabase.prototype.transaction;
      try {
        IDBDatabase.prototype.transaction = function (...args) {
          const tx = origTx.apply(this, args);
          if (args[1] === "readonly") {
            setTimeout(() => {
              try {
                tx.abort();
              } catch {}
            }, 0);
          }
          return tx;
        };
        await studyEventPage(roOwner, roRun, 0, 50);
      } catch (e) {
        nativeRoRejectionObserved =
          /Could not read study results/i.test(String(e)) ||
          /abort/i.test(String(e));
      } finally {
        IDBDatabase.prototype.transaction = origTx;
      }
      results.nativeReadonlyAbortErrorRejection = nativeRoRejectionObserved;

      // G. Stable ordering & outcome completeness
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
      results.stableOrdering = isSorted;
      results.fullNumbersAndOutcomes = fullNumbers;

      // H. Quota rollback (exact 128 MiB boundary verified with atomic rollback)
      const qOwner = "owner-quota";
      const qRun = "run-quota";
      await storeStudySymbol(
        qOwner,
        qRun,
        "VALID1",
        makeResult("VALID1", 5),
        new AbortController().signal,
      );
      const qRawDb = await new Promise((res, rej) => {
        const req = indexedDB.open("signalgen-study-temporary-1", 2);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      await new Promise((res, rej) => {
        const tx = qRawDb.transaction(["sizes"], "readwrite");
        tx.objectStore("sizes").put(127 * 1024 * 1024, qOwner);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      qRawDb.close();

      const chunk = "Y".repeat(2000);
      const bigEvents = [];
      for (let i = 0; i < 1100; i++) {
        bigEvents.push({
          symbol: "BREACH",
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
              timestamp: chunk,
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
          qOwner,
          qRun,
          "BREACH",
          {
            schema_version: "signal-study-1",
            policy_version: "signal-close-independent-1",
            config: { from: "2026-01-01", to: "2026-01-31", n_steps: 1 },
            events: bigEvents,
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
      const afterQuota = await studyEventPage(qOwner, qRun, 0, 50);
      results.quotaRollback = quotaRejected && afterQuota.total === 5;

      // I. Exact Canonical Equality Oracle
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
        const count = (sIdx + 1) * 8;
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
            reference_price: Number(
              (145.123456789 + i * 0.333333333).toFixed(9),
            ),
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

      const paginatedRows = [];
      for (let p = 0; ; p++) {
        const res = await studyEventPage(oracleOwner, oracleRun, p, 50);
        paginatedRows.push(...res.rows);
        if ((p + 1) * 50 >= res.total) break;
      }

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

      results.exactCanonicalEquality = {
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
      return results;
    });

    const correctness = {
      ...singlePageCorrectness,
      twoPageSharedDbConcurrentDifferentSymbols,
      twoPageSharedDbConcurrentSameSymbolOverwrite,
    };

    // =========================================================================
    // Paired Alternating Benchmark Matrix across both baseline and candidate
    // =========================================================================
    const pairedScenarios = await page.evaluate(
      async ({ symbolCounts, densities }) => {
        const candidate = window.__storageCandidate;
        const baseline = window.__storageBaseline;

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
          if (!arr || arr.length === 0) return 0;
          const sorted = [...arr].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          return sorted.length % 2 !== 0
            ? sorted[mid]
            : Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));
        }

        async function runSingleTimedSuite(mod, count, density, iterTag) {
          await mod.clearAllStudyResults();
          const totalEvents = count * density;
          const symbols = Array.from({ length: count }, (_, i) =>
            "SYM" + String(i).padStart(4, "0"),
          );
          const owner = `user-bench-${count}-${density}-${iterTag}`;
          const run = `run-${count}-${density}-${iterTag}`;
          const totalPages = Math.ceil(totalEvents / 50);
          const midPage = Math.floor(totalPages / 2);
          const latePage = Math.max(0, totalPages - 1);

          // 1. Measure Store
          const storeStart = performance.now();
          for (const sym of symbols) {
            const res = makeResult(sym, density);
            await mod.storeStudySymbol(
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
          const p0 = await mod.studyEventPage(owner, run, 0, 50);
          const p0Ms = performance.now() - p0Start;

          // 3. Measure Middle Page (size 50)
          const pMidStart = performance.now();
          const pMid = await mod.studyEventPage(owner, run, midPage, 50);
          const pMidMs = performance.now() - pMidStart;

          // 4. Measure Late Page (size 50)
          const pLateStart = performance.now();
          const pLate = await mod.studyEventPage(owner, run, latePage, 50);
          const pLateMs = performance.now() - pLateStart;

          // 5. Measure CSV Export (size 100)
          const csvStart = performance.now();
          let totalCsvRows = 0;
          for (let p = 0; ; p++) {
            const found = await mod.studyEventPage(owner, run, p, 100);
            totalCsvRows += found.rows.length;
            if ((p + 1) * 100 >= found.total) break;
          }
          const csvExportMs = performance.now() - csvStart;

          // 6. Measure Cleanup
          const cleanStart = performance.now();
          await mod.clearStudyOwner(owner);
          const cleanMs = performance.now() - cleanStart;

          const checkAfterClean = await mod.studyEventPage(owner, run, 0, 50);

          const verified =
            p0.total === totalEvents &&
            totalCsvRows === totalEvents &&
            checkAfterClean.total === 0 &&
            checkAfterClean.rows.length === 0;

          await mod.clearAllStudyResults();

          return {
            verified,
            sample: {
              storeMs: Number(storeMs.toFixed(2)),
              p0Ms: Number(p0Ms.toFixed(2)),
              pMidMs: Number(pMidMs.toFixed(2)),
              pLateMs: Number(pLateMs.toFixed(2)),
              csvExportMs: Number(csvExportMs.toFixed(2)),
              cleanMs: Number(cleanMs.toFixed(2)),
            },
          };
        }

        const scenarios = [];

        for (const count of symbolCounts) {
          for (const density of densities) {
            const totalEvents = count * density;

            // Warmup for baseline and candidate (unrecorded)
            await runSingleTimedSuite(baseline, count, density, "warmup-base");
            await runSingleTimedSuite(candidate, count, density, "warmup-cand");

            const baselineSamples = [];
            const candidateSamples = [];
            let allBaselineVerified = true;
            let allCandidateVerified = true;

            // 3 Paired Alternating Iterations:
            // Iteration 0: Baseline, then Candidate
            // Iteration 1: Candidate, then Baseline
            // Iteration 2: Baseline, then Candidate
            for (let iter = 0; iter < 3; iter++) {
              if (iter % 2 === 0) {
                const bRes = await runSingleTimedSuite(
                  baseline,
                  count,
                  density,
                  `b-${iter}`,
                );
                if (!bRes.verified) allBaselineVerified = false;
                baselineSamples.push(bRes.sample);

                const cRes = await runSingleTimedSuite(
                  candidate,
                  count,
                  density,
                  `c-${iter}`,
                );
                if (!cRes.verified) allCandidateVerified = false;
                candidateSamples.push(cRes.sample);
              } else {
                const cRes = await runSingleTimedSuite(
                  candidate,
                  count,
                  density,
                  `c-${iter}`,
                );
                if (!cRes.verified) allCandidateVerified = false;
                candidateSamples.push(cRes.sample);

                const bRes = await runSingleTimedSuite(
                  baseline,
                  count,
                  density,
                  `b-${iter}`,
                );
                if (!bRes.verified) allBaselineVerified = false;
                baselineSamples.push(bRes.sample);
              }
            }

            const bStore = baselineSamples.map((s) => s.storeMs);
            const bP0 = baselineSamples.map((s) => s.p0Ms);
            const bPMid = baselineSamples.map((s) => s.pMidMs);
            const bPLate = baselineSamples.map((s) => s.pLateMs);
            const bCsv = baselineSamples.map((s) => s.csvExportMs);
            const bClean = baselineSamples.map((s) => s.cleanMs);

            const cStart = candidateSamples.map((s) => s.storeMs);
            const cP0 = candidateSamples.map((s) => s.p0Ms);
            const cPMid = candidateSamples.map((s) => s.pMidMs);
            const cPLate = candidateSamples.map((s) => s.pLateMs);
            const cCsv = candidateSamples.map((s) => s.csvExportMs);
            const cClean = candidateSamples.map((s) => s.cleanMs);

            const baselineSummary = {
              storeMs: computeMedian(bStore),
              storeRange: [Math.min(...bStore), Math.max(...bStore)],
              p0Ms: computeMedian(bP0),
              p0Range: [Math.min(...bP0), Math.max(...bP0)],
              pMidMs: computeMedian(bPMid),
              pMidRange: [Math.min(...bPMid), Math.max(...bPMid)],
              pLateMs: computeMedian(bPLate),
              pLateRange: [Math.min(...bPLate), Math.max(...bPLate)],
              csvExportMs: computeMedian(bCsv),
              csvRange: [Math.min(...bCsv), Math.max(...bCsv)],
              cleanMs: computeMedian(bClean),
              cleanRange: [Math.min(...bClean), Math.max(...bClean)],
              verified: allBaselineVerified,
            };

            const candidateSummary = {
              storeMs: computeMedian(cStart),
              storeRange: [Math.min(...cStart), Math.max(...cStart)],
              p0Ms: computeMedian(cP0),
              p0Range: [Math.min(...cP0), Math.max(...cP0)],
              pMidMs: computeMedian(cPMid),
              pMidRange: [Math.min(...cPMid), Math.max(...cPMid)],
              pLateMs: computeMedian(cPLate),
              pLateRange: [Math.min(...cPLate), Math.max(...cPLate)],
              csvExportMs: computeMedian(cCsv),
              csvRange: [Math.min(...cCsv), Math.max(...cCsv)],
              cleanMs: computeMedian(cClean),
              cleanRange: [Math.min(...cClean), Math.max(...cClean)],
              verified: allCandidateVerified,
            };

            const speedup = {
              csvExport: Number(
                (
                  baselineSummary.csvExportMs / candidateSummary.csvExportMs
                ).toFixed(2),
              ),
              p0: Number(
                (baselineSummary.p0Ms / candidateSummary.p0Ms).toFixed(2),
              ),
              pMid: Number(
                (baselineSummary.pMidMs / candidateSummary.pMidMs).toFixed(2),
              ),
              pLate: Number(
                (baselineSummary.pLateMs / candidateSummary.pLateMs).toFixed(2),
              ),
              storeDeltaMs: Number(
                (
                  candidateSummary.storeMs - baselineSummary.storeMs
                ).toFixed(2),
              ),
              cleanDeltaMs: Number(
                (
                  candidateSummary.cleanMs - baselineSummary.cleanMs
                ).toFixed(2),
              ),
            };

            scenarios.push({
              symbols: count,
              density,
              totalEvents,
              baselineSamples,
              candidateSamples,
              baseline: baselineSummary,
              candidate: candidateSummary,
              speedup,
              verified: allBaselineVerified && allCandidateVerified,
            });
          }
        }

        return scenarios;
      },
      { symbolCounts, densities },
    );

    const provenance = {
      candidateCommitSha: "df92fc14a4637cca153b55a884731c1d0804a2b8",
      baselineCommitSha: "e74b1651d7e04059141b4f7ff9a4d1f23f6c2c8e",
      candidateSourceSha256: getFileSha256(candidatePath),
      baselineSourceSha256: getFileSha256(baselinePath),
      runnerSha256: getFileSha256(fileURLToPath(import.meta.url)),
      lockfileSha256: getFileSha256(lockfilePath),
      containerImageDigest:
        "sha256:f609973e8fd93f38a5ddfd706a65805294247dae8d81b2541c0afe2787746197",
      containerImageTag:
        "mcr.microsoft.com/playwright@sha256:f609973e8fd93f38a5ddfd706a65805294247dae8d81b2541c0afe2787746197",
      platform: "linux/arm64",
      isolationControls: {
        network: "offline loopback namespace (--network none)",
        user: "pwuser (uid 1001, gid 1001)",
        securityOpt: "no-new-privileges:true",
        capDrop: "ALL",
        cpus: 2,
        memory: "2g",
        pidsLimit: 100,
        mounts: [
          "Read-only node_modules (/work/node_modules:ro)",
          "Read-only allowlisted staging snapshot (/work/app:ro)",
        ],
        browserSandboxing:
          "Native Chromium Linux sandbox enabled (no --no-sandbox)",
      },
      command:
        "docker run --rm --pull=never --network none --user 1001:1001 --security-opt=no-new-privileges:true --cap-drop=ALL --cpus 2 --memory 2g --pids-limit 100 -v <real-node_modules>:/work/node_modules:ro -v /tmp/storage-bench-stage:/work/app:ro -e NODE_PATH=/work/node_modules -w /work sha256:f609973e8fd93f38a5ddfd706a65805294247dae8d81b2541c0afe2787746197 node /work/app/tests/browser/study-storage-benchmark.mjs",
      timestamp: new Date().toISOString(),
    };

    return {
      label,
      provenance,
      scenarios: pairedScenarios,
      correctness,
    };
  } finally {
    await browser.close();
    server.close();
  }
}

// CLI direct invocation
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const label = process.argv[2] || "paired-benchmark";
  runBenchmark({ label })
    .then((res) => {
      console.log(JSON.stringify(res, null, 2));

      // Rigorous assertion validation: exit non-zero on any invariant failure
      const allScenariosVerified = res.scenarios.every(
        (s) => s.verified === true,
      );
      const c = res.correctness;
      const allCorrectnessPassed =
        c.overwriteAccounting === true &&
        c.ownerIsolation === true &&
        c.cancellationRollback === true &&
        c.legacyWriteRegression === true &&
        c.singlePageConcurrentWriters === true &&
        c.twoPageSharedDbConcurrentDifferentSymbols === true &&
        c.twoPageSharedDbConcurrentSameSymbolOverwrite === true &&
        c.nativeReadonlyAbortErrorRejection === true &&
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
