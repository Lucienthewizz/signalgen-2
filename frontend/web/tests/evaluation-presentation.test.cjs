const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  vm = require("node:vm"),
  ts = require("typescript");
const exportsForTest = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      __dirname + "/../src/analysis/evaluation-presentation.ts",
      "utf8",
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  { exports: exportsForTest },
);
const { evaluationComparison, outcomeDescription } = exportsForTest;
const metric = {
  signals: 3,
  evaluated: 2,
  missing: 1,
  wins: 1,
  losses: 1,
  flats: 0,
  mean_return_pct: -2,
  win_rate: 50,
  sum_return_pct: -4,
};
test("exact Open/Close comparison preserves negative averages and incomplete denominators; High is separate", () => {
  const horizons = ["open", "high", "close"].map((basis) => ({
    ...metric,
    basis,
    step: 3,
  }));
  const rows = evaluationComparison(horizons, metric, { n_steps: 3 }, 3);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].label, "Exact T+3 Open");
  assert.equal(rows[1].metrics.mean_return_pct, -2);
  assert.equal(rows[1].metrics.evaluated, 2);
  assert.equal(rows[1].metrics.missing, 1);
  assert.equal(
    evaluationComparison(horizons, metric, { n_steps: 3 }, 1).length,
    0,
  );
});
test("target-only and TP/SL use existing swing metrics and frozen window regardless of exact step", () => {
  const target = evaluationComparison(
    [],
    metric,
    { n_steps: 3, take_profit_pct: 5 },
    1,
  );
  assert.match(target[0].label, /Target within T\+3/);
  assert.equal(target[0].metrics, metric);
  const barriers = evaluationComparison(
    [],
    metric,
    { n_steps: 3, take_profit_pct: 5, stop_loss_pct: 3 },
    1,
  );
  assert.match(barriers[0].label, /TP \/ SL/);
});
test("first hit exposes time, step and threshold price; unhit losses and incomplete outcomes remain distinct", () => {
  const base = {
    basis: "barrier",
    step: 2,
    status: "take_profit",
    price: 105,
    return_pct: 5,
    timestamp: "2026-01-26T00:00:00Z",
  };
  assert.equal(
    outcomeDescription(base),
    "Target hit · T+2 · 2026-01-26T00:00:00Z · price 105 · 5.00%",
  );
  assert.match(
    outcomeDescription({
      ...base,
      status: "stop_loss",
      price: 97,
      return_pct: -3,
    }),
    /Stop loss hit.*-3.00%/,
  );
  assert.match(
    outcomeDescription({
      ...base,
      status: "time_exit",
      step: 3,
      return_pct: -8,
    }),
    /Unhit · final Close.*-8.00%/,
  );
  assert.match(
    outcomeDescription({ ...base, status: "time_exit" }, false),
    /^Final Close/,
  );
  assert.equal(
    outcomeDescription({
      ...base,
      status: "incomplete",
      price: null,
      return_pct: null,
    }),
    "Incomplete · excluded",
  );
  assert.match(
    outcomeDescription({
      ...base,
      status: "evaluated",
      basis: "open",
      return_pct: -12,
    }),
    /Exact price.*-12.00%/,
  );
});
