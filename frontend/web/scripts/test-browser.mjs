import { execFileSync } from "node:child_process";
import fs, { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tiersOnly = process.argv.includes("--tiers");
const authOnly = process.argv.includes("--auth");
const journalExplorerOnly = process.argv.includes("--journal-explorer");
const adminOnly = process.argv.includes("--admin");
const marketScreenOnly = process.argv.includes("--market-screen");
const studyOnly = process.argv.includes("--study");
const backtestOnly = process.argv.includes("--backtest");
const catalogOnly = process.argv.includes("--catalog");
const decisionsOnly = process.argv.includes("--decisions");
const recoveryOnly = process.argv.includes("--recovery");
const monitorOnly = process.argv.includes("--monitor");
const usabilityOnly = process.argv.includes("--usability");
const mobilePerformance = process.argv.includes("--mobile-performance");
const performanceOnly =
  process.argv.includes("--performance") || mobilePerformance;
let performanceFilename;
if (performanceOnly) {
  const fixture = fs.readFileSync(
    path.join(root, "tests/browser/workspace-regression.cli.js"),
    "utf8",
  );
  const split = fixture.indexOf("  // Keep unrelated GETs unresolved:");
  if (split < 0) throw Error("Performance fixture setup marker is missing");
  const body = fs
    .readFileSync(
      path.join(root, "tests/browser/loading-performance.cli.js"),
      "utf8",
    )
    .trim()
    .replace(/;$/, "");
  performanceFilename = path.join(
    mkdtempSync(path.join(tmpdir(), "signalgen-performance-")),
    "scenario.js",
  );
  writeFileSync(
    performanceFilename,
    fixture.slice(0, split) +
      `await (${body})({page,origin,profile:${JSON.stringify(mobilePerformance ? "mobile" : "desktop")}});\n}`,
  );
}
const baseURL = process.env.SIGNALGEN_TEST_BASE_URL || "http://127.0.0.1:5174";
const testFilename = marketScreenOnly
  ? "tests/browser/market-screen.cli.js"
  : tiersOnly
    ? "tests/browser/tier-access.cli.js"
    : journalExplorerOnly
      ? "tests/browser/journal-explorer.cli.js"
      : authOnly
        ? "tests/browser/google-auth.cli.js"
        : performanceOnly
          ? performanceFilename
          : studyOnly
            ? "tests/browser/signal-study.cli.js"
            : usabilityOnly
              ? "tests/browser/analysis-usability.cli.js"
              : adminOnly
                ? "tests/browser/admin-access.cli.js"
                : backtestOnly
                  ? "tests/browser/backtest.cli.js"
                  : monitorOnly
                    ? "tests/browser/intraday-monitor.cli.js"
                    : recoveryOnly
                      ? "tests/browser/resource-recovery.cli.js"
                      : decisionsOnly
                        ? "tests/browser/screener-decisions.cli.js"
                        : catalogOnly
                          ? "tests/browser/stock-catalog.cli.js"
                          : "tests/browser/workspace-regression.cli.js";
const attributeName = marketScreenOnly
  ? "data-signalgen-market-screen-tests"
  : tiersOnly
    ? "data-signalgen-tier-tests"
    : journalExplorerOnly
      ? "data-signalgen-journal-explorer-tests"
      : authOnly
        ? "data-signalgen-auth-tests"
        : performanceOnly
          ? "data-signalgen-performance-tests"
          : studyOnly
            ? "data-signalgen-study-tests"
            : usabilityOnly
              ? "data-signalgen-usability-tests"
              : adminOnly
                ? "data-signalgen-admin-tests"
                : backtestOnly
                  ? "data-signalgen-backtest-tests"
                  : monitorOnly
                    ? "data-signalgen-monitor-tests"
                    : recoveryOnly
                      ? "data-signalgen-recovery-tests"
                      : decisionsOnly
                        ? "data-signalgen-decision-tests"
                        : catalogOnly
                          ? "data-signalgen-catalog-tests"
                          : "data-signalgen-browser-tests";
const chromePath =
  process.env.SIGNALGEN_TEST_BROWSER_EXECUTABLE ||
  (fs.existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : undefined);

function recordPerformance(json) {
  const label =
    process.env.SIGNALGEN_PERF_LABEL === "before" ? "before" : "after";
  fs.mkdirSync(path.join(root, "output/playwright"), { recursive: true });
  writeFileSync(
    path.join(
      root,
      `output/playwright/loading-${mobilePerformance ? "mobile-" : ""}${label}.json`,
    ),
    JSON.stringify(json, null, 2),
  );
  console.log(JSON.stringify(json, null, 2));
}

const cliExecutable =
  process.env.SIGNALGEN_TEST_PLAYWRIGHT_CLI || "playwright-cli";
let usedCli = false;
try {
  execFileSync("which", [cliExecutable], { stdio: "ignore" });
  usedCli = true;
} catch {}

if (usedCli) {
  const folder = mkdtempSync(path.join(tmpdir(), "signalgen-browser-test-"));
  const config = path.join(folder, "config.json");
  writeFileSync(
    config,
    JSON.stringify({
      browser: {
        browserName: "chromium",
        launchOptions: {
          headless: true,
          ...(chromePath ? { executablePath: chromePath } : {}),
        },
        contextOptions: mobilePerformance
          ? {
              viewport: { width: 390, height: 844 },
              isMobile: true,
              hasTouch: true,
              deviceScaleFactor: 1,
            }
          : { viewport: { width: 1440, height: 1000 } },
      },
    }),
  );
  const name = `signalgen-regression-${process.pid}`;
  function cli(args) {
    const output = execFileSync(cliExecutable, [`-s=${name}`, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (output.includes("### Error")) throw Error(output);
    return output;
  }
  try {
    cli([
      "open",
      `${baseURL}/#app/${adminOnly ? "operator" : backtestOnly ? "backtest" : "analysis"}`,
      "--config",
      config,
    ]);
    cli(["snapshot"]);
    cli(["run-code", "--filename", testFilename]);
    if (performanceOnly) {
      const report = cli([
        "eval",
        "() => document.body.dataset.signalgenPerformance",
      ]);
      const match = report.match(/### Result\s+("[^\n]+")/);
      if (!match) throw Error(report);
      recordPerformance(JSON.parse(JSON.parse(match[1])));
    }
    const result = cli([
      "eval",
      `() => document.body.getAttribute('${attributeName}')`,
    ]);
    if (!/### Result\s+"complete"/.test(result))
      throw Error(
        `Browser suite did not reach its final assertion:\n${result}`,
      );
  } catch (error) {
    try {
      console.error(cli(["snapshot"]));
      if (backtestOnly || adminOnly)
        cli([
          "screenshot",
          `--filename=output/playwright/${adminOnly ? "admin" : "backtest"}-failure.png`,
        ]);
    } catch {}
    throw error;
  } finally {
    try {
      cli(["close"]);
    } catch {}
  }
} else {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    ...(chromePath ? { executablePath: chromePath } : {}),
  });
  try {
    const context = await browser.newContext(
      mobilePerformance
        ? {
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
            deviceScaleFactor: 1,
          }
        : { viewport: { width: 1440, height: 1000 } },
    );
    const page = await context.newPage();
    await page.goto(baseURL);
    const code = fs.readFileSync(path.resolve(root, testFilename), "utf8");
    const fn = eval("(" + code.trim().replace(/;$/, "") + ")");
    try {
      const evidence = await fn(page);
      if (performanceOnly)
        recordPerformance(
          await page.evaluate(() =>
            JSON.parse(document.body.dataset.signalgenPerformance),
          ),
        );
      if (studyOnly || marketScreenOnly)
        writeFileSync(
          path.join(
            root,
            marketScreenOnly
              ? "output/playwright/market-screen-browser.json"
              : "output/playwright/signal-study-browser.json",
          ),
          JSON.stringify(evidence, null, 2) + "\n",
        );
    } catch (error) {
      await page
        .screenshot({
          path: `output/playwright/${studyOnly ? "signal-study" : "browser"}-failure.png`,
          fullPage: true,
        })
        .catch(() => {});
      console.error((await page.locator("body").innerText()).slice(0, 3500));
      throw error;
    }
    const result = await page.evaluate(
      (attr) => document.body.getAttribute(attr),
      attributeName,
    );
    if (result !== "complete")
      throw Error(`Browser suite did not reach its final assertion: ${result}`);
  } finally {
    await browser.close();
  }
}

console.log(
  marketScreenOnly
    ? "PASS: market screening; 23 stocks in three batches, real WASM/IndexedDB, pagination, partial coverage, restart and Stop; 1440/390px dark/light; synthetic API."
    : tiersOnly
      ? "PASS: guided Free onboarding, plan navigation, access recovery and responsive tier checks. Synthetic fixtures only."
      : journalExplorerOnly
        ? "PASS: Journal search/filter/sort, SGT dates, snapshot details, safe filtered CSV, bounded paging and desktop/mobile dark/light layout. Synthetic account/API fixtures only."
        : authOnly
          ? "PASS: Google PKCE login, session handoff, disabled provider and invalid callbacks; desktop/mobile dark/light. Synthetic fixtures only."
          : performanceOnly
            ? "PASS: controlled production-preview loading benchmark; synthetic API/account only."
            : studyOnly
              ? "PASS: batched signal-study browser regression with real Go/WASM; synthetic API/account/provider fixtures."
              : usabilityOnly
                ? "PASS: screening-only journal selection, receipt-only writes, failed-row retry, double-click prevention, bounded paging and outage recovery; desktop/mobile dark/light. Synthetic API/account/evaluator fixtures only."
                : adminOnly
                  ? "PASS: verified-role sidebar navigation, admin search/paging, reviewed grant/revoke, validation focus, contrast and 44px controls, denied/forged/suspended roles, 1440/375px and 844x390 landscape, dark theme. Synthetic account/API fixtures only."
                  : backtestOnly
                    ? "PASS: backtest-2 rule/manual, real Go/WASM, horizon/equity/trade paging, bulk input, full CSV downloads, native IndexedDB persistence/limits/rollback, archive reload/logout/isolation, cancellation/integrity/denial, 1440/390px dark theme. Synthetic account/API fixtures only."
                    : monitorOnly
                      ? "PASS: Start/Stop, real WASM, unchanged-data dedup, new candles, cancellation, navigation, 1440/390px and dark theme; synthetic API/socket fixtures only."
                      : recoveryOnly
                        ? "PASS: transient resource recovery, bounded retries, persistent outage, explicit reload, session preservation, 1440/390px and dark theme. Synthetic API/account data only."
                        : decisionsOnly
                          ? "PASS: BUY/SELL, AND/OR, crossover history/reload/evidence/CSV, legacy unknown direction, cooldown, IDR/USD, 1440/390px and dark theme. Synthetic API/account data only."
                          : catalogOnly
                            ? "PASS: categories, search, 10-stock limit, paging, keyboard, empty/loading, 1440/900/390px and dark theme. Synthetic catalog fixture only."
                            : "PASS: 10 workspace routes × 2 viewport sizes × dark theme; public/account routes; history/evidence/CSV; monitor sorting; sidebar navigation; expired-session cleanup. API/account fixtures only.",
);
