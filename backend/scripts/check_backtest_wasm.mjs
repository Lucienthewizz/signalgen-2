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

const cases = ['manual', 'rule'].map(mode => {
  const request = structuredClone(fixture);
  request.config.mode = mode;
  return { label: mode, request };
});
const dailySessions = structuredClone(fixture);
dailySessions.config.n_steps = 1;
const other = structuredClone(dailySessions.series[0]);
other.symbol = 'OTHER';
for (const candle of other.candles) candle.timestamp = candle.timestamp.replace('T00:', 'T01:');
dailySessions.series.push(other);
dailySessions.entries = [dailySessions.entries[0], { symbol: 'OTHER', timestamp: other.candles[19].timestamp, signal_type: 'BUY' }];
cases.push({ label: 'different daily timestamp hours', request: dailySessions });
const fractionalSignals = structuredClone(fixture);
fractionalSignals.config.n_steps = 1;
const fractionalOther = structuredClone(fractionalSignals.series[0]);
fractionalOther.symbol = 'AAA';
fractionalOther.candles[19].timestamp = '2026-01-20T00:00:00.001Z';
fractionalSignals.series.push(fractionalOther);
fractionalSignals.entries = [{ symbol: 'AAA', timestamp: fractionalOther.candles[19].timestamp, signal_type: 'BUY' }, fractionalSignals.entries[0]];
cases.push({ label: 'fractional signal priority', request: fractionalSignals });
for (const { label, request } of cases) {
  const native = JSON.parse(execFileSync('go', ['run', './cmd/backtest'], { input: JSON.stringify(request), encoding: 'utf8', maxBuffer: 16 << 20 }));
  const wasm = JSON.parse(globalThis.signalgenRunBacktest(JSON.stringify(request)));
  assert.equal(wasm.ok, true, JSON.stringify(wasm.error));
  compare(wasm.result, native);
  if (request.config.n_steps === 1) {
    assert.equal(wasm.result.horizons[0].trades.length, 1);
    assert.equal(wasm.result.horizons[0].trades[0].symbol, 'TEST');
    assert.equal(wasm.result.horizons[0].skipped[0].reason, 'POSITION_OPEN');
    assert.equal(wasm.result.horizons[0].equity_curve.length, fixture.series[0].candles.length + 1);
  } else {
    const openTrade = wasm.result.horizons[2].trades.find(trade => trade.status === 'open');
    assert.ok(Math.abs(openTrade.return_pct - (125 / 120 - 1) * 100) < 1e-9);
  }
  console.log(`${label}: native/WASM match, ${native.horizons.length} independent horizons`);
}
const series = fixture.series[0];
const features = JSON.parse(globalThis.signalgenComputeBacktestFeatures(JSON.stringify({ purpose: 'backtest', symbol: series.symbol, candles: series.candles })));
assert.equal(features.ok, true);
assert.equal(features.result.candidates.length, series.candles.length - 19);
const intraday = structuredClone(series.candles.slice(0, 20));
for (let i = 0; i < intraday.length; i++) intraday[i].timestamp = `2026-01-01T${String(i).padStart(2, '0')}:00:00Z`;
assert.equal(JSON.parse(globalThis.signalgenComputeBacktestFeatures(JSON.stringify({ purpose: 'backtest', symbol: series.symbol, candles: intraday }))).ok, false);
const invalid = structuredClone(fixture); invalid.entries[0].signal_type = 'SELL';
assert.equal(JSON.parse(globalThis.signalgenRunBacktest(JSON.stringify(invalid))).ok, false);
const mismatchedInstant = structuredClone(fixture);
mismatchedInstant.series[0].candles[19].timestamp = '2026-01-20T00:00:00.100Z';
mismatchedInstant.entries[0].timestamp = '2026-01-20T00:00:00.200Z';
assert.equal(JSON.parse(globalThis.signalgenRunBacktest(JSON.stringify(mismatchedInstant))).ok, false);
assert.equal(JSON.parse(globalThis.signalgenRunBacktest('{}')).ok, false);
assert.equal(JSON.parse(globalThis.signalgenBacktestCapabilities()).policy_version, 'holding-next-open-1');
assert.deepEqual(JSON.parse(globalThis.signalgenCapabilities()).purposes, ['screen']);
console.log('Feature export, capabilities, invalid input and SELL rejection verified');
process.exit(0);
