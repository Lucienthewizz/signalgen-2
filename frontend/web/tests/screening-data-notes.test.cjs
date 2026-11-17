const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const path = require("node:path");
const exportsModule = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, "../src/lib/screening-data-notes.ts"),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { exports: exportsModule },
);
const group = (notes, symbols) =>
  JSON.parse(
    JSON.stringify(exportsModule.groupScreeningDataNotes(notes, symbols)),
  );
test("stock quality metrics stay attached to their reported symbol, including zero", () => {
  const warning =
    "ASII.JK: 5m regular-session closed candles; requested 3 calendar days; 52 null and 0 unfinished/out-of-session rows excluded";
  const notes = group(
    [
      "Provider: Yahoo Finance",
      warning,
      warning,
      "BBRI.JK: Daily history unavailable",
    ],
    ["ASII.JK", "BBRI.JK"],
  );
  assert.deepEqual(notes.general, ["Provider: Yahoo Finance"]);
  assert.equal(notes.stocks.length, 2);
  assert.deepEqual(notes.stocks[0], {
    symbol: "ASII.JK",
    fields: [
      { label: "Candle interval", value: "5m" },
      { label: "Session", value: "Regular session · completed candles" },
      { label: "Requested period", value: "3 calendar days" },
      { label: "Null rows excluded", value: "52" },
      { label: "Unfinished / out-of-session rows excluded", value: "0" },
    ],
  });
  assert.deepEqual(notes.stocks[1].fields, [
    { label: "Provider note", value: "Daily history unavailable" },
  ]);
});
test("unrecognized metrics and unknown symbol prefixes retain the original provider text", () => {
  const unknown = "NEW.JK: 0 missing rows";
  const notes = group(
    ["ASII.JK: 2 gaps require review; no candles fabricated", unknown],
    ["ASII.JK"],
  );
  assert.deepEqual(notes.general, [unknown]);
  assert.deepEqual(notes.stocks[0].fields, [
    {
      label: "Provider note",
      value: "2 gaps require review; no candles fabricated",
    },
  ]);
});
test("absent warnings do not fabricate per-stock counts or success states", () => {
  assert.deepEqual(group([], ["ASII.JK"]), { general: [], stocks: [] });
});
