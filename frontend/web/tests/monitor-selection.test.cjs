const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
function setup(storage = new Map()) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(`${__dirname}/../src/lib/monitor-selection.ts`, "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText,
    {
      exports,
      localStorage: {
        getItem: (key) => storage.get(key),
        setItem: (key, value) => storage.set(key, value),
      },
    },
  );
  return { ...exports, storage };
}
test("monitor selection survives reload and is isolated by account", () => {
  const p = setup();
  p.saveMonitorSelection("one", "universe-one", "BBCA");
  assert.equal(setup(p.storage).readMonitorSelection("one").ticker, "BBCA");
  assert.equal(p.readMonitorSelection("two"), null);
  assert.equal(p.readMonitorSelection(), null);
});
test("monitor selection rejects malformed, oversized and invalid values", () => {
  const p = setup();
  for (const value of [
    "broken",
    JSON.stringify({ universeId: "one", ticker: "<script>" }),
    JSON.stringify({ universeId: 4, ticker: "BBCA" }),
    "x".repeat(1025),
  ]) {
    p.storage.set("signalgen.monitor-selection.v1.one", value);
    assert.equal(p.readMonitorSelection("one"), null);
  }
});
test("unavailable preference storage never prevents the monitor from opening", () => {
  const p = setup({
    get() {
      throw Error("blocked");
    },
    set() {
      throw Error("quota");
    },
  });
  assert.equal(p.readMonitorSelection("one"), null);
  assert.doesNotThrow(() => p.saveMonitorSelection("one", "watchlist", "TLKM"));
});
