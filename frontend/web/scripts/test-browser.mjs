import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const folder = mkdtempSync(path.join(tmpdir(), "signalgen-browser-test-"));
const config = path.join(folder, "config.json");
writeFileSync(config, JSON.stringify({ browser: {
  browserName: "chromium",
  launchOptions: { headless: true, ...(process.env.SIGNALGEN_TEST_BROWSER_EXECUTABLE ? { executablePath: process.env.SIGNALGEN_TEST_BROWSER_EXECUTABLE } : {}) },
  contextOptions: { viewport: { width: 1440, height: 1000 } },
} }));
const name = `signalgen-regression-${process.pid}`;
const catalogOnly = process.argv.includes("--catalog");
function cli(args) {
  const output = execFileSync("playwright-cli", [`-s=${name}`, ...args], { cwd: root, encoding: "utf8", timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  if (output.includes("### Error")) throw Error(output);
  return output;
}
try {
  cli(["open", "http://127.0.0.1:5174/#app/analysis", "--config", config]);
  cli(["run-code", "--filename", catalogOnly ? "tests/browser/stock-catalog.cli.js" : "tests/browser/workspace-regression.cli.js"]);
  const result = cli(["eval", catalogOnly ? "() => document.body.getAttribute('data-signalgen-catalog-tests')" : "() => document.body.getAttribute('data-signalgen-browser-tests')"]);
  if (!/### Result\s+"complete"/.test(result)) throw Error(`Browser suite did not reach its final assertion:\n${result}`);
  console.log(catalogOnly ? "PASS: categories, search, 10-stock limit, paging, keyboard, empty/loading, 1440/900/390px and both themes. Synthetic catalog fixture only." : "PASS: 10 workspace routes × 2 viewport sizes × 2 themes; public/account routes; history/evidence/CSV; monitor sorting; sidebar navigation; expired-session cleanup. API/account fixtures only.");
} finally {
  try { cli(["close"]); } catch { /* Preserve the original test failure. */ }
}
