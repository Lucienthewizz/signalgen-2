const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const path = require("node:path");
const data = new Map();
function load(
  localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  },
) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(
        path.join(__dirname, "../src/lib/workspace-storage.ts"),
        "utf8",
      ),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText,
    { exports, TextEncoder, window: { localStorage } },
  );
  return exports;
}
const draft = () => ({
  definition: {
    name: "Momentum",
    logic: "AND",
    signal_type: "BUY",
    cooldown_sec: 300,
    conditions: [{ left: "PRICE", op: ">", right: "EMA20" }],
  },
  editingId: null,
  editingVersion: null,
});
test("drafts survive refresh, stay account scoped, and deliberate blank clears a previous preset", () => {
  const storage = load();
  assert.equal(storage.saveRuleDraft("a", draft()), true);
  assert.equal(load().readRuleDraft("a").definition.name, "Momentum");
  assert.equal(load().readRuleDraft("b"), null);
  storage.saveRuleDraft("a", {
    ...draft(),
    definition: { ...draft().definition, name: "", conditions: [] },
  });
  assert.equal(load().readRuleDraft("a"), null);
  storage.saveRuleDraft("a", draft());
  storage.saveRuleDraft("a", null);
  assert.equal(load().readRuleDraft("a"), null);
});
test("draft import validation rejects corrupt fields and strips extras", () => {
  const storage = load();
  assert.equal(
    storage.validatedRuleDraft({
      ...draft(),
      definition: { ...draft().definition, conditions: [null] },
    }),
    null,
  );
  assert.equal(
    storage.validatedRuleDraft({
      ...draft(),
      editingId: "rule",
      editingVersion: -1,
    }),
    null,
  );
  assert.equal(
    storage.validatedRuleDraft({
      ...draft(),
      definition: { ...draft().definition, cooldown_sec: Infinity },
    }),
    null,
  );
  const valid = storage.validatedRuleDraft({ ...draft(), token: "secret" });
  assert.equal("token" in valid, false);
});
test("unavailable, malformed, oversized and expired storage degrade safely", () => {
  const blocked = load({
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("quota");
    },
  });
  assert.equal(blocked.readRuleDraft("a"), null);
  assert.equal(blocked.saveRuleDraft("a", draft()), false);
  for (const raw of [
    "{bad",
    "x".repeat(513000),
    JSON.stringify({
      version: 1,
      savedAt: Date.now() - 31 * 86400000,
      data: draft(),
    }),
    JSON.stringify({ version: 99, savedAt: Date.now(), data: draft() }),
  ]) {
    assert.equal(load({ getItem: () => raw }).readRuleDraft("a"), null);
  }
});
