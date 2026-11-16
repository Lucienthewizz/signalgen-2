import assert from "node:assert/strict";
import fs from "node:fs";

const [adaptivePath, baselinePath] = process.argv.slice(2);
if (!adaptivePath || !baselinePath)
  throw Error("usage: node compare-signal-study-evidence.mjs adaptive.json baseline.json");

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const adaptive = read(adaptivePath);
const baseline = read(baselinePath);
const canonical = (value) => JSON.stringify(value.canonical.canonical);
const csv = (value) => JSON.stringify(value.canonical.csvCells);

assert.equal(adaptive.canonical.hash, baseline.canonical.hash);
assert.equal(canonical(adaptive), canonical(baseline));
assert.equal(csv(adaptive), csv(baseline));
assert.notEqual(adaptive.canonical.hash, adaptive.canonical.mutationHash);
assert.notEqual(baseline.canonical.hash, baseline.canonical.mutationHash);
assert.equal(adaptive.canonical.canonical.meta.total, 92);
assert.equal(adaptive.canonical.canonical.records.length, 23);
assert.equal(adaptive.canonical.csvCells.length, 922);
assert.equal(adaptive.adaptiveWorkers.stats.live, 0);
assert.equal(baseline.adaptiveWorkers.stats.live, 0);
assert.equal(adaptive.adaptiveWorkers.aggregate.active, 0);
assert.equal(baseline.adaptiveWorkers.aggregate.active, 0);
console.log("canonical adaptive/baseline event, summary, and CSV cells match");
