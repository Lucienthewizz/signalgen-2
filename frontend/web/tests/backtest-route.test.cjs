const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const route = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, "../src/lib/backtest-route.ts"),
      "utf8",
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  { exports: route, URLSearchParams },
);
test("result addresses retain the mode and the requested run", () => {
  for (const mode of ["study", "portfolio"]) {
    const value = route.readBacktestRoute(
      route.backtestResultHash(mode, "run_123-abc"),
    );
    assert.equal(value.page, "results");
    assert.equal(value.mode, mode);
    assert.equal(value.run, "run_123-abc");
  }
  assert.equal(route.readBacktestRoute("#app/backtest").page, "setup");
  assert.equal(route.readBacktestRoute("#app/news").page, "setup");
});
test("malformed result IDs cannot become another path or an unbounded lookup", () => {
  for (const run of [
    "",
    "../other",
    "owner/run",
    "<script>",
    "a".repeat(129),
  ]) {
    assert.equal(
      route.readBacktestRoute(
        "#app/backtest/results&mode=portfolio&run=" + encodeURIComponent(run),
      ).run,
      "",
    );
  }
  assert.equal(
    route.readBacktestRoute("#app/backtest/results/another&run=abc").page,
    "setup",
  );
});
