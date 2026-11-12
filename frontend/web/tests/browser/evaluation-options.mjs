// Run from frontend/web: node tests/browser/evaluation-options.mjs
// Uses an isolated browser context and synthetic local API fixtures only.
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const base = process.env.SIGNALGEN_TEST_BASE_URL || "http://127.0.0.1:5182";
const executable =
  process.env.SIGNALGEN_TEST_PLAYWRIGHT_CLI || "playwright-cli";
const browserPath =
  process.env.SIGNALGEN_TEST_BROWSER_EXECUTABLE ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const scenario = "tests/browser/evaluation-options.cli.js";
mkdirSync("output/playwright", { recursive: true });
let report;
let cliAvailable = false;
try {
  execFileSync("which", [executable], { stdio: "ignore" });
  cliAvailable = true;
} catch {}
if (cliAvailable) {
  const config = path.join(
    mkdtempSync(path.join(tmpdir(), "evaluation-options-")),
    "config.json",
  );
  writeFileSync(
    config,
    JSON.stringify({
      browser: {
        browserName: "chromium",
        launchOptions: {
          headless: true,
          ...(existsSync(browserPath) ? { executablePath: browserPath } : {}),
        },
      },
    }),
  );
  const session = `evaluation-options-${process.pid}`;
  const cli = (...args) => {
    const output = execFileSync(executable, [`-s=${session}`, ...args], {
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (output.includes("### Error")) throw Error(output);
    return output;
  };
  try {
    cli("open", base, "--config", config);
    cli("snapshot");
    const output = cli("run-code", "--filename", scenario);
    const match = output.match(/### Result\s+([\s\S]*?)\n###/);
    if (!match) throw Error(output);
    report = JSON.parse(match[1]);
  } finally {
    cli("close");
  }
} else {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    ...(existsSync(browserPath) ? { executablePath: browserPath } : {}),
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(base);
    report = await eval(`(${readFileSync(scenario, "utf8").trim()})`)(page);
  } finally {
    await browser.close();
  }
}
writeFileSync(
  "output/playwright/evaluation-options-browser.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
