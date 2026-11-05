const { test } = require("node:test");
const assert = require("node:assert/strict");
test("bundle traversal counts shared imports once, includes CSS and excludes dynamic routes", async () => {
  const { staticAssets } =
    await import("../scripts/check-performance-budgets.mjs");
  const files = staticAssets(
    {
      root: {
        file: "root.js",
        imports: ["shared"],
        dynamicImports: ["journal"],
        css: ["root.css"],
      },
      shared: { file: "shared.js", imports: ["root"] },
      journal: { file: "journal.js" },
    },
    "root",
  );
  assert.deepEqual(files, ["root.js", "root.css", "shared.js"]);
});
test("budget gate rejects growth, missing metrics and unsupported lab reports", async () => {
  const { assertBudgets, checkLab } =
    await import("../scripts/check-performance-budgets.mjs");
  assert.throws(
    () => assertBudgets({ size: 101 }, { size: 100 }, ["size"]),
    /exceeded/,
  );
  assert.throws(() => assertBudgets({}, { size: 100 }, ["size"]), /exceeded/);
  assert.doesNotThrow(() =>
    assertBudgets({ size: 100 }, { size: 100 }, ["size"]),
  );
  assert.throws(() => checkLab({ scenario: "desktop" }, {}), /mobile/);
  assert.throws(
    () => checkLab({ scenario: "mobile emulation", labMetrics: {} }, {}),
    /Incomplete/,
  );
});
