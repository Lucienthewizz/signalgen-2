const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const exportsForTest = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/lib/journal.ts"), "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    },
  ).outputText,
  { exports: exportsForTest },
);
const { journalPerformance, localJournalDate } = exportsForTest;
const { filterJournalMonth, journalTimeline } = exportsForTest;

test("empty and loss-only filters never produce NaN or infinite chart points", () => {
  for (const records of [[], [{ pnl: -32000 }], [{ pnl: 0 }]]) {
    const summary = journalPerformance(records);
    assert.equal(summary.averageWin, 0);
    assert.equal(summary.winRate, 0);
    assert.ok(summary.chartCoordinates.flat().every(Number.isFinite));
  }
});

test("profit factor uses money and the chart follows chronological filtered trades", () => {
  const summary = journalPerformance([
    { pnl: 200 },
    { pnl: -50 },
    { pnl: 100 },
  ]);
  assert.equal(summary.totalPnl, 250);
  assert.equal(summary.averageWin, 150);
  assert.equal(summary.profitFactor, 6);
  assert.equal(summary.chartCoordinates.length, 4);
  assert.ok(summary.chartCoordinates[1][1] < summary.chartCoordinates[2][1]);
  assert.ok(summary.chartCoordinates[3][1] < summary.chartCoordinates[1][1]);
  assert.equal(journalPerformance([{ pnl: 100 }]).profitFactor, null);
});

test("entry date uses local calendar components in ISO input format", () => {
  assert.equal(localJournalDate(new Date(2026, 0, 2, 0, 1)), "2026-01-02");
});

test("month filters drive the same rows, totals and dated P&L points", () => {
  const rows = [
    { id: "later", closedAt: "2026-10-20T09:00:00+07:00", pnl: 250 },
    { id: "earlier", closedAt: "2026-10-02T09:00:00+07:00", pnl: -50 },
    { id: "september", closedAt: "2026-09-30T09:00:00+07:00", pnl: 100 },
  ];
  const filtered = filterJournalMonth(rows, "2026-10");
  assert.equal(filtered.length, 2);
  assert.equal(journalPerformance(filtered).totalPnl, 200);
  const timeline = journalTimeline(filtered);
  assert.equal(timeline[1].record.id, "earlier");
  assert.equal(timeline[1].value, -50);
  assert.equal(timeline[2].value, 200);
  assert.equal(filterJournalMonth(rows, "").length, 3);
  assert.equal(filterJournalMonth(rows, "2026-13").length, 0);
  assert.equal(filterJournalMonth(rows, "2026-11").length, 0);
  assert.equal(journalTimeline([])[0].value, 0);
  assert.equal(rows[0].id, "later", "Chart must not mutate table order");
});
