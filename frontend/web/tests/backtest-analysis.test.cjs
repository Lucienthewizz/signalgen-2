const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
function load(name) {
  const exports = {};
  const code = ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, "../src/analysis", name + ".ts"),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(code, {
    exports,
    require: () => ({
      BACKTEST_SCHEMA: "backtest-2",
      BACKTEST_POLICY: "holding-next-open-1",
    }),
    TextEncoder,
    Date,
    setTimeout,
    clearTimeout,
  });
  return exports;
}
const { parseBacktestEntries, backtestTradesCSV, backtestHorizonsCSV } = load(
  "backtest-presentation",
);
const { validBacktestResult } = load("backtest-history");
const fixture = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "../../../backend/core/testdata/backtest_next_open_v1.json",
    ),
    "utf8",
  ),
);
const dataset = { series: fixture.series };
test("bulk input is atomic, validates exact candle scope, canonical offsets and duplicates", () => {
  const text =
    "symbol,timestamp\nTEST,2026-01-20T08:00:00+08:00\nTEST,2026-01-21T00:00:00Z";
  const added = parseBacktestEntries(text, dataset, fixture.config, []);
  assert.equal(added.length, 2);
  assert.equal(added[0].timestamp, "2026-01-20T00:00:00Z");
  for (const [bad, reason] of [
    ["TEST,2026-01-20T00:00:00Z\nOTHER,2026-01-20T00:00:00Z", /Line 2/],
    ["TEST,2026-01-20T01:00:00Z", /match/],
    ["TEST,2026-01-20", /match/],
    ["TEST,2026-01-20T00:00:00Z,SELL", /BUY only/],
    ["TEST,2026-01-19T00:00:00Z", /range/],
    ["TEST,2026-01-20T00:00:00Z\nTEST,2026-01-20T08:00:00+08:00", /Duplicate/],
  ])
    assert.throws(
      () => parseBacktestEntries(bad, dataset, fixture.config, []),
      reason,
    );
  assert.throws(
    () =>
      parseBacktestEntries(
        "TEST,2026-01-20T00:00:00Z",
        dataset,
        fixture.config,
        added,
      ),
    /Duplicate/,
  );
  assert.throws(
    () =>
      parseBacktestEntries(
        "TEST,2026-01-22T00:00:00Z",
        dataset,
        fixture.config,
        Array.from({ length: 2000 }, () => added[0]),
      ),
    /2,000/,
  );
  assert.equal(added.length, 2);
});
const metrics = {
  initial_capital: 10000,
  final_equity: 10000,
  total_return_pct: 0,
  max_drawdown_pct: 0,
  net_pl_cash: 0,
  unrealized_pl: 0,
  closed_trades: 0,
  open_trades: 0,
  wins: 0,
  losses: 0,
  flats: 0,
  win_rate: null,
  profit_factor: null,
  total_commission: 0,
  expectancy_cash: null,
  avg_win_cash: null,
  avg_loss_cash: null,
  risk_reward: null,
  avg_return_pct: null,
};
test("bulk timestamps preserve nanoseconds and reject normalized invalid dates", () => {
  const d = structuredClone(dataset);
  d.series[0].candles[19].timestamp = "2026-01-20T00:00:00.100100001Z";
  assert.equal(
    parseBacktestEntries(
      "TEST,2026-01-20T08:00:00.100100001+08:00",
      d,
      fixture.config,
      [],
    )[0].timestamp,
    d.series[0].candles[19].timestamp,
  );
  assert.throws(
    () =>
      parseBacktestEntries(
        "TEST,2026-01-20T00:00:00.100100002Z",
        d,
        fixture.config,
        [],
      ),
    /match/,
  );
  assert.throws(
    () =>
      parseBacktestEntries(
        "TEST,2026-01-20T24:00:00Z",
        dataset,
        fixture.config,
        [],
      ),
    /match/,
  );
});
const result = {
  schema_version: "backtest-2",
  policy_version: "holding-next-open-1",
  execution: "portable_go_backtest",
  config: { ...fixture.config, n_steps: 1 },
  horizons: [
    {
      step: 1,
      label: "T+1",
      metrics,
      trades: [],
      skipped: [],
      equity_curve: [{ timestamp: "", equity: 10000 }],
      by_symbol: [],
    },
  ],
  warnings: [],
};
test("archive boundary rejects incompatible, incomplete and nonfinite results", () => {
  assert.equal(validBacktestResult(result), true);
  for (const edit of [
    (r) => (r.schema_version = "backtest-1"),
    (r) => delete r.horizons[0].by_symbol,
    (r) => (r.horizons[0].metrics.win_rate = NaN),
    (r) => (r.horizons[0].equity_curve[0].timestamp = "broken"),
    (r) => (r.horizons[0].metrics.closed_trades = -1),
  ]) {
    const r = structuredClone(result);
    edit(r);
    assert.equal(validBacktestResult(r), false);
  }
});
test("CSV exports all trades/horizons, preserves numeric losses and neutralizes formulas", () => {
  const trade = {
    symbol: ' =HYPERLINK("bad"),TEST',
    signal_time: "2026-01-20T00:00:00Z",
    entry_time: "2026-01-21T00:00:00Z",
    status: "closed",
    quantity: 1,
    entry_price: 110,
    exit_price: 100,
    entry_commission: 0,
    exit_commission: 0,
    net_pl: -10,
    unrealized_pl: 0,
    return_pct: -9.09,
  };
  const h = {
    ...result.horizons[0],
    trades: Array.from({ length: 31 }, () => trade),
  };
  const csv = backtestTradesCSV(result, h, "USD");
  assert.equal(csv.split("\r\n").length, 32);
  assert.ok(csv.includes('"\' =HYPERLINK(""bad""),TEST"'));
  assert.ok(csv.includes('"-10"'));
  assert.ok(csv.includes('"USD"'));
  assert.ok(csv.includes('"2026-01-21T00:00:00Z"'));
  const summary = backtestHorizonsCSV(
    {
      ...result,
      horizons: Array.from({ length: 100 }, (_, i) => ({
        ...h,
        label: `T+${i + 1}`,
        step: i + 1,
      })),
    },
    "IDR",
  );
  assert.equal(summary.split("\r\n").length, 101);
  assert.ok(summary.includes('"T+100"'));
  assert.ok(!summary.includes('"null"'));
});
