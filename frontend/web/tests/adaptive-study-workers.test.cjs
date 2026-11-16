const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const policySource = fs.readFileSync(
  "src/analysis/adaptive-study-policy.ts",
  "utf8",
);
const engineSource = fs.readFileSync(
  "src/analysis/signal-study-engine.ts",
  "utf8",
);
const orchestrationSource = fs.readFileSync(
  "src/analysis/signal-study.ts",
  "utf8",
);

test("adaptive policy is conservative and bounded", () => {
  assert.match(policySource, /maxWorkers: 1/);
  assert.match(policySource, /Math\.min\(4/);
  assert.match(policySource, /hardware concurrency is unavailable/);
  assert.match(policySource, /deviceMemory/);
  assert.match(policySource, /requiredOperands/);
});

test("the real study orchestration applies policy and overlaps feature jobs", () => {
  assert.match(orchestrationSource, /getAdaptiveStudyWorkerPolicy/);
  assert.match(orchestrationSource, /engine\.setMaxWorkers\(policy\.maxWorkers\)/);
  assert.match(orchestrationSource, /Promise\.all\(/);
  assert.match(orchestrationSource, /engine\.features\(/);
});

test("pool lifecycle bounds workers and rejects queued work on disposal", () => {
  assert.match(engineSource, /Math\.min\(4/);
  assert.match(engineSource, /this\.queue\.length = 0/);
  assert.match(engineSource, /slot\.worker\.terminate\(\)/);
  assert.match(engineSource, /data\?\.jobId !== job\.id/);
  assert.match(engineSource, /Study worker exceeded 60 seconds/);
});
