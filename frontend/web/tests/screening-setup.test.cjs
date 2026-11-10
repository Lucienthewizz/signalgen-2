const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const setup = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(`${__dirname}/../src/lib/screening-setup.ts`, "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    },
  ).outputText,
  { exports: setup },
);
const free = {
  features: ["screener"],
  access: { screening: { max_symbols: 3, system_rules_only: true } },
};
const system = { id: "system", owner_type: "system" };
const personal = { id: "mine", owner_type: "user" };
const universe = (count) => ({
  id: "stocks",
  symbols: Array.from({ length: count }, (_, i) => `S${i}`),
});
test("Free onboarding skips private rule creation and starts with stock selection", () => {
  assert.equal(setup.screeningSetup(free, [system], []).view, "universes");
  assert.equal(
    setup.screeningSetup(free, [system], []).label,
    "Choose your first stocks",
  );
  assert.equal(setup.screeningSetup(free, [system], [universe(3)]).ready, true);
});
test("downgrade does not treat an oversized universe or personal rule as ready", () => {
  const result = setup.screeningSetup(free, [system], [universe(10)]);
  assert.equal(result.ready, false);
  assert.equal(result.label, "Adjust stock universe");
  assert.equal(
    setup.screeningSetup(free, [personal], [universe(3)]).view,
    "rules",
  );
  assert.equal(
    setup.screeningSetup(free, [system], [universe(0)]).ready,
    false,
  );
});
test("paid access accepts personal rules and the server's stock limit", () => {
  const analyst = {
    features: ["screener"],
    access: { screening: { max_symbols: 10, system_rules_only: false } },
  };
  assert.equal(
    setup.screeningSetup(analyst, [personal], [universe(10)]).view,
    "analysis",
  );
  assert.equal(
    setup.screeningSetup({ features: [] }, [system], [universe(3)]).view,
    "subscription",
  );
  assert.equal(setup.screeningSetup(null, [], []).ready, false);
});
