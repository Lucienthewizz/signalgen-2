const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function harness({
  remote = [],
  local = {},
  meta = {},
  save,
  offline = false,
} = {}) {
  const values = new Map(Object.entries(local)),
    metadata = new Map(Object.entries(meta));
  const states = [],
    effects = [],
    listeners = new Map(),
    timers = new Map(),
    calls = [];
  class ApiError extends Error {
    constructor(status) {
      super("api");
      this.status = status;
    }
  }
  const api = {
    workspace: async () => {
      if (offline) throw Error("offline");
      return { items: remote };
    },
    saveWorkspace: async (kind, version, data) => {
      calls.push({ kind, version, data });
      return save
        ? save(kind, version, data, ApiError)
        : { kind, version: version + 1, data };
    },
  };
  const storage = {
    workspaceKinds: [
      "rule-draft",
      "screener-preferences",
      "monitor-history",
      "watchlist",
    ],
    readWorkspaceData: (_, kind) => values.get(kind) ?? null,
    writeWorkspaceData: (_, kind, data) => {
      values.set(kind, data);
      return true;
    },
    syncMeta: (_, kind) => metadata.get(kind) ?? { version: 0, dirty: false },
    setSyncMeta: (_, kind, version, dirty) =>
      metadata.set(kind, { version, dirty }),
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(
        path.join(__dirname, "../src/lib/use-workspace-sync.ts"),
        "utf8",
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      exports,
      require: (name) =>
        name === "react"
          ? {
              useState: (initial) => {
                const i = states.length;
                states.push(initial);
                return [
                  initial,
                  (next) => {
                    states[i] =
                      typeof next === "function" ? next(states[i]) : next;
                  },
                ];
              },
              useRef: (value) => ({ current: value }),
              useEffect: (effect) => effects.push(effect),
            }
          : name.includes("api/client")
            ? { api, ApiError }
            : storage,
      window: {
        addEventListener: (name, fn) => listeners.set(name, fn),
        removeEventListener: (name) => listeners.delete(name),
      },
      setTimeout: (fn) => {
        const key = {};
        timers.set(key, fn);
        return key;
      },
      clearTimeout: (key) => timers.delete(key),
    },
  );
  const hook = exports.useWorkspaceSync("owner-a");
  const cleanup = effects[0]();
  return {
    states,
    values,
    metadata,
    calls,
    hook,
    cleanup,
    edit: (kind, data, owner = "owner-a") => {
      values.set(kind, data);
      metadata.set(kind, {
        ...(metadata.get(kind) ?? { version: 0 }),
        dirty: true,
      });
      listeners.get("signalgen:workspace-change")?.({
        detail: { userId: owner, kind },
      });
    },
    flush: async () => {
      const work = [...timers.values()];
      timers.clear();
      for (const fn of work) fn();
      await settle();
    },
  };
}
test("clean device restores account state without writing it back", async () => {
  const h = harness({
    remote: [{ kind: "watchlist", version: 3, data: ["BBCA"] }],
  });
  await settle();
  assert.equal(h.states[0], "saved");
  assert.equal(h.states[1], true);
  assert.deepEqual(h.values.get("watchlist"), ["BBCA"]);
  assert.equal(h.calls.length, 0);
  assert.equal(h.metadata.get("watchlist").version, 3);
  h.cleanup();
});
test("dirty local state is uploaded with its known version", async () => {
  const h = harness({
    remote: [{ kind: "watchlist", version: 2, data: ["BBCA"] }],
    local: { watchlist: ["TLKM"] },
    meta: { watchlist: { version: 2, dirty: true } },
  });
  await settle();
  assert.equal(h.calls[0].version, 2);
  assert.equal(h.metadata.get("watchlist").version, 3);
  assert.equal(h.states[0], "saved");
  h.cleanup();
});
test("concurrent-device changes require an explicit choice and never auto-overwrite", async () => {
  const h = harness({
    remote: [{ kind: "watchlist", version: 4, data: ["BBCA"] }],
    local: { watchlist: ["TLKM"] },
    meta: { watchlist: { version: 2, dirty: true } },
  });
  await settle();
  assert.equal(h.states[0], "conflict");
  assert.equal(h.calls.length, 0);
  await h.hook.useAccount();
  await settle();
  assert.deepEqual(h.values.get("watchlist"), ["BBCA"]);
  assert.equal(h.states[0], "saved");
  assert.equal(h.states[2], 1);
  h.cleanup();
});
test("choosing this device uses the latest remote version, not the stale version", async () => {
  const h = harness({
    remote: [{ kind: "watchlist", version: 4, data: ["BBCA"] }],
    local: { watchlist: ["TLKM"] },
    meta: { watchlist: { version: 2, dirty: true } },
  });
  await settle();
  await h.hook.useDevice();
  await settle();
  assert.equal(h.calls[0].version, 4);
  assert.deepEqual(h.calls[0].data, ["TLKM"]);
  h.cleanup();
});
test("edits during an in-flight write receive a trailing versioned save", async () => {
  let release;
  const h = harness({
    local: { watchlist: ["BBCA"] },
    meta: { watchlist: { version: 0, dirty: true } },
    save: (kind, version, data) =>
      version === 0
        ? new Promise((resolve) => {
            release = () => resolve({ kind, version: 1, data });
          })
        : Promise.resolve({ kind, version: version + 1, data }),
  });
  await settle();
  h.edit("watchlist", ["TLKM"]);
  await h.flush();
  release();
  await settle();
  await h.flush();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].version, 1);
  assert.deepEqual(h.calls[1].data, ["TLKM"]);
  assert.equal(h.states[0], "saved");
  h.cleanup();
});
test("offline startup retains the device copy and still opens the workspace", async () => {
  const h = harness({ offline: true, local: { watchlist: ["BBCA"] } });
  await settle();
  assert.equal(h.states[0], "local");
  assert.equal(h.states[1], true);
  assert.deepEqual(h.values.get("watchlist"), ["BBCA"]);
  h.cleanup();
});
test("a 409 during upload enters conflict state without a retry loop", async () => {
  const h = harness({
    local: { watchlist: [] },
    meta: { watchlist: { version: 0, dirty: true } },
    save: (_, __, ___, ApiError) => {
      throw new ApiError(409);
    },
  });
  await settle();
  await h.flush();
  assert.equal(h.states[0], "conflict");
  assert.equal(h.calls.length, 1);
  h.cleanup();
});
test("events for another owner and edits after unmount cannot upload", async () => {
  const h = harness();
  await settle();
  h.edit("watchlist", ["BBCA"], "owner-b");
  await h.flush();
  assert.equal(h.calls.length, 0);
  h.cleanup();
  h.edit("watchlist", ["TLKM"]);
  await h.flush();
  assert.equal(h.calls.length, 0);
});
