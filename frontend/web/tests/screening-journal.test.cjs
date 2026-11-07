const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ts = require("typescript");
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/lib/screening-journal.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: api });
test("journal list excludes trades, no-match and malformed market/time data", () => {
  const valid = { id: "record", data: { schema_version: "screening-journal-1", source: "screening", symbol: "BBCA.JK", rule_name: "Rule A", market: "IDX", currency: "IDR", timeframe: "5m", matched: true, signal_type: "BUY", price: 4000, candle_at: "2026-11-05T01:00:00Z", screened_at: "2026-11-05T01:10:00Z" } };
  assert.equal(api.isScreeningJournalRecord(valid), true);
  for (const change of [{ source: "manual" }, { matched: false }, { price: 0 }, { price: NaN }, { candle_at: "bad" }, { currency: "USD" }, { timeframe: "2m" }, { symbol: null }, { signal_type: "UNKNOWN" }]) {
    assert.equal(api.isScreeningJournalRecord({ ...valid, data: { ...valid.data, ...change } }), false);
  }
  assert.equal(api.isScreeningJournalRecord({ data: { symbol: "BBCA", quantity: 100, net_pl: 20 } }), false);
  assert.equal(api.isScreeningJournalRecord(null), false);
});
