// Reuse existing API fixture setup; execute real app/client/worker/WASM in fresh contexts.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
const base = process.env.SIGNALGEN_TEST_BASE_URL || "http://127.0.0.1:5181";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.SIGNALGEN_TEST_BROWSER_EXECUTABLE ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const reports = [];
mkdirSync("output/playwright", { recursive: true });
try {
  for (const screen of [true, false])
    for (const width of [1440, 390])
      for (const theme of ["dark", "light"]) {
        const filename = screen
          ? "market-screen.cli.js"
          : "evaluation-options.cli.js";
        const fixture = readFileSync(`tests/browser/${filename}`, "utf8");
        const marker = screen ? "\n for(const width" : "\n const assert=";
        const end = fixture.indexOf(marker);
        if (end < 0) throw Error(`Fixture setup marker missing: ${filename}`);
        const body = fixture.slice(fixture.indexOf("=>{") + 3, end);
        const scenario = readFileSync(
          "tests/browser/snapshot-overload.cli.js",
          "utf8",
        );
        const fn = eval(
          `(async(page)=>{${body}\n${screen ? "partial=false;" : ""}\nreturn await (${scenario})({page,screen:${screen},width:${width},theme:${JSON.stringify(theme)}});})`,
        );
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await page.goto(base);
          const errors = [];
          page.on("pageerror", (error) => errors.push(error.message));
          reports.push(await fn(page));
          if (errors.length) throw Error(errors.join("; "));
        } finally {
          await context.close();
        }
      }
} finally {
  await browser.close();
}
writeFileSync(
  "output/playwright/snapshot-overload-browser.json",
  JSON.stringify(reports, null, 2) + "\n",
);
console.log(JSON.stringify(reports, null, 2));
