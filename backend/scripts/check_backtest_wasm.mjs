import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';

const [artifact, runtime] = process.argv.slice(2);
if (!artifact || !runtime) throw new Error('usage: node scripts/check_backtest_wasm.mjs artifact.wasm wasm_exec.js');
globalThis.crypto ??= webcrypto;
createRequire(import.meta.url)(runtime);
const go = new globalThis.Go();
const { instance } = await WebAssembly.instantiate(readFileSync(artifact), go.importObject);
void go.run(instance);
const fixture = JSON.parse(readFileSync('core/testdata/backtest_next_open_v1.json', 'utf8'));

function compare(got, expected, path = 'result') {
  if (typeof expected === 'number') {
    assert.equal(typeof got, 'number', path);
    assert.ok(Number.isFinite(got) && Math.abs(got - expected) <= 1e-9 + Math.abs(expected) * 1e-12, `${path}: ${got} != ${expected}`);
  } else if (expected !== null && typeof expected === 'object') {
    assert.deepEqual(Object.keys(got), Object.keys(expected), `${path} keys`);
    for (const key of Object.keys(expected)) compare(got[key], expected[key], `${path}.${key}`);
  } else assert.equal(got, expected, path);
}

for (const mode of ['manual', 'rule']) {
  const request = structuredClone(fixture);
  request.config.mode = mode;
  const native = JSON.parse(execFileSync('go', ['run', './cmd/backtest'], { input: JSON.stringify(request), encoding: 'utf8', maxBuffer: 16 << 20 }));
  const wasm = JSON.parse(globalThis.signalgenRunBacktest(JSON.stringify(request)));
  assert.equal(wasm.ok, true, JSON.stringify(wasm.error));
  compare(wasm.result, native);
  console.log(`${mode}: native/WASM match, ${native.horizons.length} independent horizons`);
}
const series = fixture.series[0];
const features = JSON.parse(globalThis.signalgenComputeBacktestFeatures(JSON.stringify({ purpose: 'backtest', symbol: series.symbol, candles: series.candles })));
assert.equal(features.ok, true);
assert.equal(features.result.candidates.length, series.candles.length - 19);
const invalid = structuredClone(fixture); invalid.entries[0].signal_type = 'SELL';
assert.equal(JSON.parse(globalThis.signalgenRunBacktest(JSON.stringify(invalid))).ok, false);
assert.equal(JSON.parse(globalThis.signalgenRunBacktest('{}')).ok, false);
assert.equal(JSON.parse(globalThis.signalgenBacktestCapabilities()).policy_version, 'holding-next-open-1');
assert.deepEqual(JSON.parse(globalThis.signalgenCapabilities()).purposes, ['screen']);
console.log('Feature export, capabilities, invalid input and SELL rejection verified');
process.exit(0);
