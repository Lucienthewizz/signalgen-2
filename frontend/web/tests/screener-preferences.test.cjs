const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
function preferences(storage = new Map()) {
  const exports = {};
  const localStorage = {getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)};
  const workspace = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(`${__dirname}/../src/lib/workspace-storage.ts`, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText, {exports: workspace, window: {localStorage}, TextEncoder});
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(
        `${__dirname}/../src/lib/screener-preferences.ts`,
        "utf8",
      ),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText,
    {
      exports,
      require: () => workspace,
      localStorage: {
        getItem: (key) => storage.get(key),
        setItem: (key, value) => storage.set(key, value),
      },
    },
  );
  return { ...exports, storage };
}
test("saved selections and filters survive refresh and remain account scoped", () => {
  const p = preferences();
  const value = {
    ruleId: "r1",
    universeId: "u1",
    filter: "matched",
    search: "BBCA",
    sort: "rsi",
  };
  assert.equal(p.saveScreenerPreferences("one", value), true);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(preferences(p.storage).readScreenerPreferences("one")),
    ),
    value,
  );
  assert.equal(p.readScreenerPreferences("two").ruleId, "");
});
test("invalid or unavailable browser storage does not break screening", () => {
  const p = preferences();
  p.storage.set("signalgen.screener-preferences.v1.one", "broken");
  assert.equal(p.readScreenerPreferences("one").filter, "all");
  p.storage.set = () => {
    throw Error("Quota");
  };
  assert.equal(p.saveScreenerPreferences("one", p.defaultPreferences), false);
});
test("search, decision filtering and numeric sorting do not mutate results", () => {
  const p = preferences();
  const rows = [
    {
      decision: { symbol: "TLKM.JK", matched: false },
      latestClose: 2000,
      features: { rsi14: 62 },
    },
    {
      decision: { symbol: "BBCA.JK", matched: true },
      latestClose: 9000,
      features: { rsi14: 50 },
    },
    {
      decision: { symbol: "BBRI.JK", matched: true },
      latestClose: 4000,
      features: { rsi14: 70 },
    },
  ];
  assert.deepEqual(
    Array.from(
      p.filteredRows(rows, "matched", "bb", "rsi"),
      (r) => r.decision.symbol,
    ),
    ["BBRI.JK", "BBCA.JK"],
  );
  assert.equal(p.filteredRows(rows, "all", "unknown", "symbol").length, 0);
  assert.equal(rows[0].decision.symbol, "TLKM.JK");
});
