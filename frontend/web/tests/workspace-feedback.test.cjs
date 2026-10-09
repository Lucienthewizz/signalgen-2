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
