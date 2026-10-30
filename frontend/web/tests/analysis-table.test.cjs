const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const api = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      require("node:path").join(__dirname, "../src/lib/analysis-table.ts"),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { exports: api },
);
const trades = [
  {
    symbol: "BBCA.JK",
    status: "closed",
    signal_time: "2026-10-01",
    entry_time: "2026-10-02",
    exit_time: "2026-10-05",
    return_pct: 2,
  },
  {
    symbol: "AAPL",
    status: "open",
    signal_time: "2026-10-02",
    entry_time: "2026-10-05",
    exit_time: null,
    return_pct: -1,
  },
  {
    symbol: "BBRI.JK",
    status: "closed",
    signal_time: "2026-10-03",
    entry_time: "2026-10-06",
    exit_time: "2026-10-07",
    return_pct: 0,
  },
];
test("trade search and status operate on existing results without changing source or metrics", () => {
  const original = JSON.stringify(trades);
  assert.equal(
    api.backtestTradeRows(trades, " bbca ", "all", "original")[0].symbol,
    "BBCA.JK",
  );
  assert.equal(api.backtestTradeRows(trades, "", "open", "original").length, 1);
  assert.equal(
    api.backtestTradeRows(trades, "2026-10-07", "closed", "original").length,
    1,
  );
  assert.equal(
    api.backtestTradeRows(trades, "missing", "all", "original").length,
    0,
  );
  assert.equal(JSON.stringify(trades), original);
});
test("trade sorting preserves zero and negative returns and simulation order remains available", () => {
  assert.equal(
    api
      .backtestTradeRows(trades, "", "all", "return")
      .map((x) => x.return_pct)
      .join(","),
    "2,0,-1",
  );
  assert.equal(
    api.backtestTradeRows(trades, "", "all", "newest")[0].symbol,
    "BBRI.JK",
  );
  assert.equal(
    api.backtestTradeRows(trades, "", "all", "symbol")[0].symbol,
    "AAPL",
  );
  assert.equal(
    api.backtestTradeRows(trades, "", "all", "original")[0].symbol,
    "BBCA.JK",
  );
});
