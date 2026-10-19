import { execFileSync } from "node:child_process";
import fs, { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogOnly = process.argv.includes("--catalog");
const decisionsOnly = process.argv.includes("--decisions");
const recoveryOnly = process.argv.includes("--recovery");
const baseURL = process.env.SIGNALGEN_TEST_BASE_URL || "http://127.0.0.1:5174";
const testFilename = recoveryOnly
  ? "tests/browser/resource-recovery.cli.js"
  : decisionsOnly
    ? "tests/browser/screener-decisions.cli.js"
    : catalogOnly
      ? "tests/browser/stock-catalog.cli.js"
      : "tests/browser/workspace-regression.cli.js";
const attributeName = recoveryOnly
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

let usedCli = false;
try {
  execFileSync("which", ["playwright-cli"], { stdio: "ignore" });
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
        contextOptions: { viewport: { width: 1440, height: 1000 } },
      },
    }),
  );
  const name = `signalgen-regression-${process.pid}`;
  function cli(args) {
    const output = execFileSync("playwright-cli", [`-s=${name}`, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (output.includes("### Error")) throw Error(output);
    return output;
  }
  try {
    cli(["open", `${baseURL}/#app/analysis`, "--config", config]);
    cli(["run-code", "--filename", testFilename]);
    const result = cli([
      "eval",
      `() => document.body.getAttribute('${attributeName}')`,
    ]);
    if (!/### Result\s+"complete"/.test(result))
      throw Error(
        `Browser suite did not reach its final assertion:\n${result}`,
      );
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
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    await page.goto(baseURL);
    const code = fs.readFileSync(path.join(root, testFilename), "utf8");
    const fn = eval("(" + code + ")");
    await fn(page);
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
  recoveryOnly
    ? "PASS: transient resource recovery, bounded retries, persistent outage, explicit reload, session preservation, 1440/390px and both themes. Synthetic API/account data only."
    : decisionsOnly
      ? "PASS: BUY/SELL, AND/OR, crossover history/reload/evidence/CSV, legacy unknown direction, cooldown, IDR/USD, 1440/390px and both themes. Synthetic API/account data only."
      : catalogOnly
        ? "PASS: categories, search, 10-stock limit, paging, keyboard, empty/loading, 1440/900/390px and both themes. Synthetic catalog fixture only."
        : "PASS: 10 workspace routes × 2 viewport sizes × 2 themes; public/account routes; history/evidence/CSV; monitor sorting; sidebar navigation; expired-session cleanup. API/account fixtures only.",
);
