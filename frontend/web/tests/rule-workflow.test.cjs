const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const path = require("node:path");
function load(name) { const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, `../src/lib/${name}.ts`), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, TextEncoder, require: name => load(name.replace("./", "")) }); return exports; }
const workflow = load("rule-workflow");
const status = load("screening-status");
test("all Claudio operands and canonical periods/history validate", () => {
  const indicators = require("./helpers/indicator-loader.cjs");
  const base = workflow.rulePresets[0].definition;
  assert.equal(Object.keys(indicators.indicatorLabels).length, 78);
  for (const name of [...Object.keys(indicators.indicatorLabels), "EMA250_PREV_250", "RSI7", "ADX250", "REL_VOLUME_8", "MACD_PREV_5"]) {
    assert.equal(indicators.isIndicator(name), true, name);
    const right = name === "PRICE" ? "EMA9" : "PRICE";
    assert.equal(workflow.validateRule({...base, conditions:[{left:name, op:">", right}]}).valid, true, name);
  }
  for (const name of ["EMA0","EMA251","EMA01","EMA20_PREV_251","EMA20_PREV_2_PREV_2","__proto__"]) assert.equal(indicators.isIndicator(name), false, name);
  assert.equal(workflow.validateRule({...base, conditions:[{left:"MACD",op:"<",right:-0.5}]}).valid, true);
  assert.equal(workflow.validateRule({...base, conditions:[{left:"PATTERN_CDLDOJI",op:">",right:0}]}).valid, true);
});
test("rules and screener share all six comparison symbols", () => {
  assert.deepEqual(Object.keys(workflow.operatorSymbols).sort(), Object.keys(workflow.operatorLabels).sort());
  for (const [op, symbol] of Object.entries({ ">": ">", ">=": "≥", "<": "<", "<=": "≤", CROSS_UP: "↗", CROSS_DOWN: "↘" })) assert.equal(workflow.operatorSymbols[op], symbol);
});
test("all six presets are supported, valid editable rules", () => {
  assert.equal(workflow.rulePresets.length, 6);
  for (const preset of workflow.rulePresets) assert.equal(workflow.validateRule(preset.definition).valid, true, preset.name);
});
test("rule validation rejects self comparison, unknown operands and invalid thresholds", () => {
  const base = workflow.rulePresets[0].definition;
  for (const condition of [{ left: "EMA9", op: ">", right: "EMA9" }, { left: "RSI14", op: "<", right: 101 }, { left: "PRICE", op: ">", right: 0 }, { left: "PRICE", op: ">", right: "bad" }]) assert.equal(workflow.validateRule({ ...base, conditions: [condition] }).valid, false);
  for (const cooldown_sec of [-1, 1.5, 86401]) assert.equal(workflow.validateRule({ ...base, cooldown_sec }).valid, false);
  assert.equal(workflow.validateRule({ ...base, name: " " }).valid, false);
  assert.equal(workflow.validateRule({ ...base, name: "😀".repeat(26) }).valid, false);
});
test("summary makes any/all and crossover semantics explicit", () => {
  assert.match(workflow.ruleSummary(workflow.rulePresets[0].definition), /BUY when all.*EMA 9 crosses above EMA 20/);
  assert.match(workflow.ruleSummary({ ...workflow.rulePresets[1].definition, logic: "OR" }), /SELL when any/);
});
test("signal status distinguishes BUY, SELL, rejected and cooldown", () => {
  const decision = { matched: true, reason_codes: ["RULE_MATCHED"] };
  assert.equal(status.screeningStatus(decision), "matched");
  assert.equal(status.screeningStatus({ ...decision, signal_type: "BUY" }), "buy");
  assert.equal(status.screeningStatus({ ...decision, signal_type: "SELL" }), "sell");
  assert.equal(status.screeningStatus({ ...decision, matched: false }), "rejected");
  assert.equal(status.screeningStatus({ ...decision, matched: false, reason_codes: ["COOLDOWN_ACTIVE"] }), "cooldown");
});
