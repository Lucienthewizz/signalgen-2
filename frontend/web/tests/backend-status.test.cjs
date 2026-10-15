const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function monitor() {
  const pending = [];
  const source = fs.readFileSync(
    path.join(__dirname, "../src/api/backend-status.ts"),
    "utf8",
  );
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    {
      exports,
      setTimeout: (callback) => {
        pending.push(callback);
        return callback;
      },
      clearTimeout: (callback) => {
        const index = pending.indexOf(callback);
        if (index !== -1) pending.splice(index, 1);
      },
    },
  );
  return { watch: exports.monitorBackendStatus, pending };
}

test("backend recovery and a later outage update status without page reload", async () => {
  const c = monitor();
  let online = false;
  const statuses = [];
  const stop = c.watch(
    async () => {
      if (!online) throw new Error("offline");
    },
    (value) => statuses.push(value),
  );
  await new Promise(setImmediate);
  assert.deepEqual(statuses, [false]);
  online = true;
  await c.pending.shift()();
  online = false;
  await c.pending.shift()();
  assert.deepEqual(statuses, [false, true, false]);
  stop();
  assert.equal(c.pending.length, 0);
});

test("a disposed or slow monitor neither overlaps probes nor updates state late", async () => {
  const c = monitor();
  let resolve;
  const statuses = [];
  const stop = c.watch(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
    (value) => statuses.push(value),
  );
  assert.equal(c.pending.length, 0);
  stop();
  resolve();
  await new Promise(setImmediate);
  assert.deepEqual(statuses, []);
  assert.equal(c.pending.length, 0);
});
