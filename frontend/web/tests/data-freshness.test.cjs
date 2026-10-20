const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const output = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, "../src/lib/data-freshness.ts"),
      "utf8",
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  { exports: output },
);
test("snapshot dates use exchange timezone rather than browser timezone", () => {
  assert.equal(
    output.marketCandleDate("2026-10-20T00:30:00Z", "US"),
    "19 Oct 2026",
  );
  assert.equal(
    output.marketCandleDate("2026-10-20T00:30:00Z", "IDX"),
    "20 Oct 2026",
  );
  assert.equal(
    output.marketCandleDate("2026-01-20T04:30:00Z", "US"),
    "19 Jan 2026",
  );
  assert.equal(output.marketCandleDate("invalid", "US"), "unavailable");
});
test("mixed candle days are disclosed instead of claiming every stock uses one day", () => {
  assert.equal(output.candleRange([], "US"), "unavailable");
  assert.equal(
    output.candleRange(["2026-10-20T00:30:00Z", "2026-10-20T01:30:00Z"], "US"),
    "19 Oct 2026",
  );
  assert.equal(
    output.candleRange(["2026-10-20T00:30:00Z", "2026-10-19T00:30:00Z"], "US"),
    "18 Oct 2026 – 19 Oct 2026",
  );
});
test("intraday candle labels preserve market-local time and mixed timestamp ranges", () => {
  const first = "2026-10-20T14:30:00Z";
  const second = "2026-10-20T14:35:00Z";
  assert.match(output.marketCandleDate(first, "US", "5m"), /10:30/);
  assert.match(output.marketCandleDate(first, "IDX", "5m"), /21:30/);
  const range = output.candleRange([first, second], "US", "5m");
  assert.match(range, /10:30.*–.*10:35/);
  assert.equal(output.candleDate(first, "5m", "US"), output.marketCandleDate(first, "US", "5m"));
});
