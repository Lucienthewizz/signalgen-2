const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  vm = require("node:vm"),
  ts = require("typescript");
function load(name) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(__dirname + "/../src/analysis/" + name + ".ts", "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText,
    { exports },
  );
  return exports;
}
const { emptyStudyMetrics, mergeStudyMetrics } = load("signal-study-types");
const { targetHitSummary } = load("evaluation-presentation");
const config = { n_steps: 3, take_profit_pct: 5 };
const metrics = (signals, evaluated, hits, wins = 0) => ({
  ...emptyStudyMetrics(),
  signals,
  evaluated,
  missing: signals - evaluated,
  target_hits: hits,
  wins,
  sum_return_pct: wins * 2,
});
test("weighted target rate uses all batch counts, not average percentages or the visible 50 events", () => {
  const batches = [
    metrics(2, 2, 1, 2),
    metrics(101, 100, 10, 90),
    metrics(4, 3, 1, 2),
  ];
  const total = batches.reduce(mergeStudyMetrics, emptyStudyMetrics());
  assert.equal(total.target_hits, 12);
  assert.equal(total.evaluated, 105);
  assert.equal(total.missing, 2);
  assert.equal(total.signals, 107);
  assert.equal(targetHitSummary(total, config).rate, (12 / 105) * 100);
  assert.equal(total.win_rate, (94 / 105) * 100);
  assert.equal(
    targetHitSummary(total, config).text,
    "11.43% · 12/105 evaluated · 2 incomplete",
  );
  const reversed = [...batches]
    .reverse()
    .reduce(mergeStudyMetrics, emptyStudyMetrics());
  assert.equal(reversed.target_hits, 12);
  assert.equal(
    targetHitSummary(reversed, config).rate,
    targetHitSummary(total, config).rate,
  );
});
test("positive unhit exits change win rate, never the target numerator; TP/SL is labelled as exit rate", () => {
  const m = metrics(4, 3, 1, 2),
    out = mergeStudyMetrics(emptyStudyMetrics(), m);
  assert.equal(out.win_rate, (2 / 3) * 100);
  assert.equal(targetHitSummary(out, config).rate, (1 / 3) * 100);
  assert.equal(
    targetHitSummary(out, { ...config, stop_loss_pct: 3 }).label,
    "TP exit rate",
  );
  assert.equal(targetHitSummary(out, config).label, "Target reached rate");
});
test("empty or entirely incomplete target windows have no rate; no-target configuration is unavailable", () => {
  const empty = targetHitSummary(metrics(0, 0, 0), config);
  assert.equal(empty.available, true);
  assert.equal(empty.rate, null);
  assert.match(empty.text, /0\/0 evaluated · 0 incomplete/);
  assert.equal(targetHitSummary(metrics(2, 0, 0), config).rate, null);
  assert.equal(
    targetHitSummary(metrics(2, 2, 0), { n_steps: 3 }).available,
    false,
  );
  assert.match(
    targetHitSummary(metrics(2, 2, 0), { n_steps: 3 }).text,
    /no target configured/,
  );
  assert.equal(targetHitSummary(metrics(2, 2, 0), config).rate, 0);
});
test("legacy JSON or mixed old/new run metrics stay unavailable with rerun guidance in either order", () => {
  const legacy = JSON.parse(
    JSON.stringify({
      ...emptyStudyMetrics(),
      signals: 2,
      evaluated: 2,
      wins: 2,
      win_rate: 100,
    }),
  );
  assert.equal(targetHitSummary(legacy, config).available, false);
  assert.match(targetHitSummary(legacy, config).text, /rerun/);
  for (const parts of [
    [legacy, metrics(10, 10, 5)],
    [metrics(10, 10, 5), legacy],
    [metrics(0, 0, 0), legacy, metrics(1, 1, 1)],
  ]) {
    const total = parts.reduce(mergeStudyMetrics, emptyStudyMetrics());
    assert.equal(total.target_hits, undefined);
    assert.equal(targetHitSummary(total, config).available, false);
  }
  const noEvents = { ...emptyStudyMetrics() };
  const current = mergeStudyMetrics(metrics(1, 1, 1), noEvents);
  assert.equal(current.target_hits, 1);
  assert.equal(targetHitSummary(current, config).rate, 100);
  assert.equal(legacy.target_hits, undefined);
});
