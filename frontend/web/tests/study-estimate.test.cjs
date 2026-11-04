const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const estimate = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(`${__dirname}/../src/lib/study-estimate.ts`, "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  { exports: estimate },
);
test("study ETA waits for measured work and ignores stalled batches", () => {
  assert.equal(estimate.estimateStudyRemaining([], 100, 0), null);
  assert.equal(
    estimate.estimateStudyRemaining([{ at: 0, completed: 0 }], 100, 1000),
    null,
  );
  const samples = [
    { at: 0, completed: 0 },
    { at: 10000, completed: 20 },
  ];
  assert.equal(estimate.estimateStudyRemaining(samples, 80, 10000), 40000);
  assert.equal(estimate.estimateStudyRemaining(samples, 80, 15000), 35000);
  assert.equal(estimate.estimateStudyRemaining(samples, 80, 60000), null);
  assert.equal(estimate.estimateStudyRemaining(samples, 80, 110000), null);
  assert.equal(estimate.estimateStudyRemaining(samples, 0, 110000), 0);
});
test("study ETA does not accept reversed counters or zero-time samples", () => {
  assert.equal(
    estimate.estimateStudyRemaining(
      [
        { at: 0, completed: 10 },
        { at: 10000, completed: 5 },
      ],
      80,
      10000,
    ),
    null,
  );
  assert.equal(
    estimate.estimateStudyRemaining(
      [
        { at: 0, completed: 0 },
        { at: 0, completed: 20 },
      ],
      80,
      0,
    ),
    null,
  );
  assert.equal(estimate.studyDuration(1000), "about 1 min");
  assert.equal(estimate.studyDuration(3660000), "about 1 h 1 min");
});
