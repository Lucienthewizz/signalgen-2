const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const exportsMonitor = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      require("node:path").join(
        __dirname,
        "../src/analysis/screener-monitor.ts",
      ),
      "utf8",
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { exports: exportsMonitor, AbortController, setTimeout, clearTimeout, Date },
);
const { ScreenerMonitor, screenerIntervals } = exportsMonitor;
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  let now = 0,
    id = 0;
  const timers = new Map(),
    states = [],
    results = [],
    errors = [];
  const clock = {
    now: () => now,
    set: (fn, delay) => {
      timers.set(++id, { fn, delay });
      return id;
    },
    clear: (id) => timers.delete(id),
  };
  return {
    monitor: new ScreenerMonitor(clock),
    timers,
    states,
    results,
    errors,
    events: (task) => ({
      task,
      result: (value) => results.push(value),
      error: (e, retrying) => errors.push({ e, retrying }),
      state: (s) => states.push(s),
    }),
    advance: () => {
      now += 600000;
      const entry = timers.entries().next().value;
      if (entry) {
        timers.delete(entry[0]);
        entry[1].fn();
      }
    },
  };
}
test("interval policies retain the agreed cadence and automatic history", () => {
  assert.deepEqual(
    Array.from(screenerIntervals, (x) => x.periodMs),
    [60000, 300000, 900000, 900000, 900000],
  );
  assert.match(screenerIntervals[0].range, /3 calendar/);
});
test("Start is immediate, double Start is ignored, cycles cannot overlap", async () => {
  const f = fixture();
  let resolve,
    calls = 0;
  const task = () => {
    calls++;
    return new Promise((r) => (resolve = r));
  };
  assert.equal(f.monitor.start(60000, f.events(task)), true);
  assert.equal(calls, 1);
  assert.equal(f.monitor.start(60000, f.events(task)), false);
  assert.equal(f.timers.size, 0);
  resolve("one");
  await flush();
  assert.deepEqual(f.results, ["one"]);
  assert.equal(f.timers.size, 1);
  f.advance();
  assert.equal(calls, 2);
  assert.equal(f.timers.size, 0);
  f.monitor.stop();
  resolve("late");
  await flush();
  assert.deepEqual(f.results, ["one"]);
  assert.equal(f.timers.size, 0);
});
test("Stop aborts an in-flight cycle and late responses cannot overwrite a restart", async () => {
  const f = fixture();
  let old, signal;
  f.monitor.start(
    60000,
    f.events((s) => {
      signal = s;
      return new Promise((r) => (old = r));
    }),
  );
  f.monitor.stop();
  assert.equal(signal.aborted, true);
  f.monitor.start(
    60000,
    f.events(async () => "new"),
  );
  await flush();
  old("old");
  await flush();
  assert.deepEqual(f.results, ["new"]);
  assert.equal(f.timers.size, 1);
  f.monitor.stop();
  assert.equal(f.timers.size, 0);
});
test("transient failures preserve results, honor Retry-After, and never spin", async () => {
  const f = fixture();
  f.monitor.start(
    60000,
    f.events(async () => {
      throw { status: 429, retryAfterMs: 180000 };
    }),
  );
  await flush();
  assert.equal(f.errors[0].retrying, true);
  assert.equal([...f.timers.values()][0].delay, 180000);
  f.advance();
  await flush();
  assert.equal(f.timers.size, 1);
  f.monitor.stop();
});
test("permission and unsupported-data errors stop without another request", async () => {
  for (const status of [401, 403, 409, 422]) {
    const f = fixture();
    f.monitor.start(
      60000,
      f.events(async () => {
        throw { status };
      }),
    );
    await flush();
    assert.equal(f.errors[0].retrying, false);
    assert.equal(f.timers.size, 0);
    assert.equal(f.states.at(-1).active, false);
  }
});
