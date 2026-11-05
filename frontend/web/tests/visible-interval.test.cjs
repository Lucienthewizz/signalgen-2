const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
test("presentation clock pauses when hidden, resumes once, and cleans up", () => {
  const exports = {},
    timers = new Map(),
    handlers = new Map();
  let next = 0,
    ticks = 0;
  const document = {
    visibilityState: "visible",
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener: (name) => handlers.delete(name),
  };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(`${__dirname}/../src/lib/visible-interval.ts`, "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText,
    {
      exports,
      document,
      window: {
        setInterval: (fn) => {
          timers.set(++next, fn);
          return next;
        },
        clearInterval: (id) => timers.delete(id),
      },
    },
  );
  const stop = exports.visibleInterval(() => ticks++, 60000);
  assert.equal(ticks, 1);
  assert.equal(timers.size, 1);
  document.visibilityState = "hidden";
  handlers.get("visibilitychange")();
  assert.equal(timers.size, 0);
  assert.equal(ticks, 1);
  document.visibilityState = "visible";
  handlers.get("visibilitychange")();
  assert.equal(ticks, 2);
  assert.equal(timers.size, 1);
  stop();
  assert.equal(timers.size, 0);
  assert.equal(handlers.size, 0);
});
