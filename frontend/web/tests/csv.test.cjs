const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const path = require("node:path");
const output = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/lib/csv.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  { exports: output },
);
test("CSV escapes quotes, preserves numeric negatives and neutralizes formulas", () => {
  assert.equal(output.csvCell('A,"B"'), '"A,""B"""');
  assert.equal(output.csvCell(" =SUM(1,2)"), '"\' =SUM(1,2)"');
  assert.equal(output.csvCell(-10), '"-10"');
  assert.equal(
    output.toCsv([
      ["Saham", "Buka"],
      ["BBCA", null],
    ]),
    '\uFEFF"Saham","Buka"\r\n"BBCA",""',
  );
});
