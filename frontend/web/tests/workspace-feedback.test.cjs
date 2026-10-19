const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const output = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, "../src/lib/workspace-feedback.ts"),
      "utf8",
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  { exports: output },
);
test("screening errors offer permission, rate-limit, missing resource and network recovery", () => {
  for (const [status, action] of [
    [401, "login"],
    [403, "subscription"],
    [404, "resources"],
    [429, "retry"],
    [0, "retry"],
    [500, "retry"],
  ])
    assert.equal(output.screeningFailure({ status }).action, action);
});
test("condition evidence uses real feature values and handles unknown operands", () => {
  const values = { price: 100, ema9: 99, ema20: 100, rsi14: 55 };
  assert.equal(
    output.conditionEvidence({ left: "PRICE", op: ">", right: "EMA20" }, values)
      .passed,
    false,
  );
  assert.equal(
    output.conditionEvidence(
      { left: "PRICE", op: ">=", right: "EMA20" },
      values,
    ).passed,
    true,
  );
  assert.equal(
    output.conditionEvidence({ left: "RSI14", op: "<", right: 60 }, values)
      .passed,
    true,
  );
  assert.equal(
    output.conditionEvidence({ left: "RSI14", op: "<=", right: 55 }, values)
      .passed,
    true,
  );
  assert.equal(
    output.conditionEvidence(
      { left: "PRICE", op: ">", right: "UNKNOWN" },
      values,
    ),
    null,
  );
  // Test persilangan CROSS_UP dan CROSS_DOWN
  const prevValues = { price: 98, ema9: 98, ema20: 101, rsi14: 48 };
  assert.equal(
    output.conditionEvidence(
      { left: "EMA9", op: "CROSS_UP", right: "EMA20" },
      values,
      prevValues,
    ).passed,
    false,
  );
  const crossedValues = { price: 105, ema9: 102, ema20: 100, rsi14: 65 };
  assert.equal(
    output.conditionEvidence(
      { left: "EMA9", op: "CROSS_UP", right: "EMA20" },
      crossedValues,
      prevValues,
    ).passed,
    true,
  );
  assert.equal(
    output.conditionEvidence(
      { left: "EMA9", op: "CROSS_UP", right: "EMA20" },
      crossedValues,
      null,
    ),
    null,
  );
});
test("timeouts and service outages do not claim that the user must sign in again", () => {
  const timeout = output.screeningFailure({
    status: 0,
    code: "REQUEST_TIMEOUT",
  });
  assert.equal(timeout.title, "Request timed out");
  assert.equal(timeout.action, "retry");
  const outage = output.screeningFailure({ status: 503 });
  assert.equal(outage.title, "Service temporarily unavailable");
  assert.equal(outage.action, "retry");
});
test("crossover evidence compares both candles and does not invent missing previous values", () => {
  const current = { price: 100, ema9: 99, ema20: 101, rsi14: 69 };
  const previous = { price: 102, ema9: 102, ema20: 100, rsi14: 71 };
  const down = { left: "RSI14", op: "CROSS_DOWN", right: 70 };
  const evidence = output.conditionEvidence(down, current, previous);
  assert.equal(evidence.passed, true);
  assert.equal(evidence.previous.left, 71);
  assert.equal(evidence.previous.right, 70);
  assert.equal(output.conditionEvidence(down, current), null);
});
test("missing, incomplete, and non-finite prior candles produce unavailable evidence", () => {
  const current = { price: 100, ema9: 99, ema20: 101, rsi14: 69 };
  for (const previous of [
    null,
    undefined,
    {},
    { rsi14: NaN },
    { rsi14: Infinity },
  ])
    assert.equal(
      output.conditionEvidence(
        { left: "RSI14", op: "CROSS_DOWN", right: 70 },
        current,
        previous,
      ),
      null,
    );
  assert.equal(
    output.conditionEvidence(
      { left: "EMA9", op: "CROSS_UP", right: "EMA20" },
      current,
      { ema9: 99 },
    ),
    null,
  );
});
test("crossover equality boundaries match the Go contract", () => {
  const vector = (rsi14) => ({ price: 100, ema9: 99, ema20: 101, rsi14 });
  for (const [op, before, after, expected] of [
    ["CROSS_UP", 30, 31, true],
    ["CROSS_UP", 29, 30, false],
    ["CROSS_UP", 31, 32, false],
    ["CROSS_DOWN", 30, 29, true],
    ["CROSS_DOWN", 31, 30, false],
    ["CROSS_DOWN", 29, 28, false],
  ])
    assert.equal(
      output.conditionEvidence(
        { left: "RSI14", op, right: 30 },
        vector(after),
        vector(before),
      ).passed,
      expected,
    );
});
test("match status, signal direction, and cooldown remain separate without a BUY fallback", () => {
  const decision = { matched: true, reason_codes: ["RULE_MATCHED"] };
  assert.equal(
    output.decisionLabel({ ...decision, signal_type: "BUY" }),
    "BUY",
  );
  assert.equal(
    output.decisionLabel({ ...decision, signal_type: "SELL" }),
    "SELL",
  );
  assert.equal(output.decisionLabel(decision), "Matched");
  assert.equal(
    output.decisionLabel({ ...decision, signal_type: "HOLD" }),
    "Matched",
  );
  assert.equal(
    output.decisionLabel({
      matched: false,
      signal_type: "SELL",
      reason_codes: ["CONDITIONS_NOT_MET"],
    }),
    "Not matched",
  );
  assert.equal(
    output.decisionLabel({ matched: false, reason_codes: ["COOLDOWN_ACTIVE"] }),
    "Cooldown",
  );
});
test("reason text respects AND/OR, unknown legacy rules, and blocked repeat signals", () => {
  assert.equal(
    output.decisionReasons(["RULE_MATCHED"], "AND"),
    "All conditions met.",
  );
  assert.equal(
    output.decisionReasons(["RULE_MATCHED"], "OR"),
    "At least one condition met.",
  );
  assert.equal(output.decisionReasons(["RULE_MATCHED"]), "Rule matched.");
  assert.equal(
    output.decisionReasons(["CONDITIONS_NOT_MET"], "OR"),
    "No conditions met.",
  );
  assert.equal(
    output.decisionReasons(["CONDITIONS_NOT_MET"], "AND"),
    "At least one condition was not met.",
  );
  assert.match(
    output.decisionReasons(["COOLDOWN_ACTIVE"], "OR"),
    /conditions met.*cooldown is active/,
  );
});
test("decision details never imply an automatic order or guess a legacy signal", () => {
  const matched = { matched: true, reason_codes: ["RULE_MATCHED"] };
  assert.equal(
    output.decisionDescription({ ...matched, signal_type: "SELL" }),
    "Matched rule · SELL signal (not an order)",
  );
  assert.equal(
    output.decisionDescription({ ...matched, signal_type: "BUY" }),
    "Matched rule · BUY signal (not an order)",
  );
  assert.equal(
    output.decisionDescription(matched),
    "Matched rule · signal direction unavailable",
  );
  assert.equal(
    output.decisionDescription({
      ...matched,
      matched: false,
      reason_codes: ["COOLDOWN_ACTIVE"],
    }),
    "Rule conditions met · signal withheld by cooldown",
  );
  assert.equal(
    output.decisionDescription({
      ...matched,
      matched: false,
      reason_codes: ["CONDITIONS_NOT_MET"],
    }),
    "Did not match rule",
  );
});
test("expired, canceled and overdue subscriptions never claim usable subscription features", () => {
  const now = Date.parse("2026-10-06T00:00:00Z");
  for (const status of ["expired", "canceled", "past_due"])
    assert.equal(
      output.subscriptionState(
        { status, current_period_end: "2026-11-05T00:00:00Z" },
        now,
      ).usable,
      false,
    );
  assert.equal(
    output.subscriptionState(
      { status: "active", current_period_end: "2026-10-05T00:00:00Z" },
      now,
    ).usable,
    false,
  );
  assert.equal(
    output.subscriptionState(
      { status: "active", current_period_end: "2026-11-05T00:00:00Z" },
      now,
    ).usable,
    true,
  );
});
test("missing crossover history is unavailable, not evidence of a failed condition", () => {
  const current = { price: 100, ema9: 102, ema20: 100, rsi14: 55 };
  const condition = { left: "EMA9", op: "CROSS_UP", right: "EMA20" };
  assert.equal(output.conditionEvidence(condition, current), null);
  const evidence = output.conditionEvidence(condition, current, {
    ...current,
    ema9: 99,
  });
  assert.equal(evidence.available, true);
  assert.equal(evidence.previousLeft, 99);
  assert.equal(evidence.passed, true);
});
