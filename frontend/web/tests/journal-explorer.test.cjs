const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  ts = require("typescript");
const lib = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, "../src/lib/journal-explorer.ts"),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { exports: lib, Date, Map, Set, Number },
);
const item = (id, symbol, signal, market, at, rule = "r1") => ({
  id,
  data: {
    symbol,
    signal_type: signal,
    market,
    currency: market === "IDX" ? "IDR" : "USD",
    screened_at: at,
    candle_at: at,
    rule_id: rule,
    rule_name: rule === "r1" ? "Momentum" : "=Hidden formula",
    timeframe: "1d",
    price: 100,
    features: { rsi14: 55, ema9: 99, ema20: 98 },
    reason_codes: ["RULE_MATCHED"],
    dataset_checksum: "check",
  },
});
const rows = [
  item("a", "BBCA.JK", "BUY", "IDX", "2026-11-09T17:00:00Z"),
  item("b", "AAPL", "SELL", "US", "2026-11-09T12:00:00Z", "r2"),
  item("c", "BBCA.JK", undefined, "IDX", "2026-11-10T01:00:00Z"),
];
test("journal filters intersect and use SGT inclusive screening dates", () => {
  const f = {
    ...lib.emptyJournalFilters,
    from: "2026-11-10",
    to: "2026-11-10",
  };
  assert.equal(lib.filterJournal(rows, f).length, 2);
  assert.equal(
    lib.filterJournal(rows, {
      ...f,
      search: " bbca ",
      signal: "BUY",
      market: "IDX",
      rule: "r1",
    })[0].id,
    "a",
  );
  assert.equal(lib.filterJournal(rows, { ...f, market: "US" }).length, 0);
  assert.equal(lib.filterJournal(rows, { ...f, from: "2026-11-11" }).length, 0);
  assert.equal(lib.screeningDay("bad"), "");
});
test("sorting is deterministic, nonmutating and unknown directions are not BUY", () => {
  assert.equal(lib.filterJournal(rows, lib.emptyJournalFilters)[0].id, "c");
  assert.equal(
    lib.filterJournal(rows, { ...lib.emptyJournalFilters, sort: "oldest" })[0]
      .id,
    "b",
  );
  assert.equal(
    lib.filterJournal(rows, { ...lib.emptyJournalFilters, sort: "symbol" })[0]
      .id,
    "b",
  );
  assert.equal(rows[0].id, "a");
  const s = lib.journalSummary(rows);
  assert.equal(s.buy, 1);
  assert.equal(s.sell, 1);
  assert.equal(s.other, 1);
  assert.equal(s.total, 3);
  assert.equal(s.stocks, 2);
  assert.equal(s.rules, 2);
  assert.equal(s.topStock[0], "BBCA.JK");
  assert.equal(lib.journalSummary([]).total, 0);
});
test("CSV exports all filtered rows with evidence and explicit snapshot/UTC/SGT labels", () => {
  const csv = lib.journalCsvRows(rows);
  assert.equal(csv.length, 4);
  assert.equal(csv[1][0], "Screening snapshot");
  assert.equal(csv[0][7], "Candle time (UTC)");
  assert.equal(csv[1][9], "2026-11-10");
  assert.equal(csv[1].at(-1), "check");
});

test("price series separate stocks and currencies, sort by time and preserve exact prices", () => {
  const snapshots = rows.map((row) =>
    row.id === "c" ? { ...row, data: { ...row.data, price: 120 } } : row,
  );
  const series = lib.journalPriceSeries([...snapshots].reverse());
  assert.equal(series.length, 2);
  const idx = series.find((stock) => stock.key === "IDX:BBCA.JK");
  assert.equal(idx.currency, "IDR");
  assert.equal(idx.points.length, 2);
  assert.equal(idx.points[0].id, "a");
  assert.equal(idx.points[1].id, "c");
  assert.equal(idx.points[1].data.price, 120);
  assert.equal(idx.points[1].data.signal_type, undefined);
  assert.equal(series.find((stock) => stock.key === "US:AAPL").currency, "USD");
  assert.equal(snapshots[0].id, "a");
  const filtered = lib.filterJournal(rows, {
    ...lib.emptyJournalFilters,
    signal: "BUY",
  });
  assert.equal(lib.journalPriceSeries(filtered)[0].points.length, 1);
  assert.equal(lib.journalPriceSeries([]).length, 0);
  assert.equal(
    lib.journalPriceSeries([item("bad", "BBCA.JK", "BUY", "IDX", "bad")])
      .length,
    0,
  );
  assert.equal(
    lib.journalPriceSeries([
      { ...rows[0], data: { ...rows[0].data, price: NaN } },
    ]).length,
    0,
  );
});
