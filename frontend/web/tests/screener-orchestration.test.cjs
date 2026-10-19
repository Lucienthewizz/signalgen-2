const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const ts = require("typescript");

// Execute the real orchestration, with only its HTTP/worker/socket boundaries
// replaced. No account, provider or cloud database is modified by these tests.
function screener(options = {}) {
  const calls = { grants: 0, tickets: 0, sockets: 0, workers: 0, messages: [] };
  const symbols = ["BBCA", "BBRI", "TLKM"];
  const series = symbols.map((symbol, index) => ({
    symbol,
    candles: [{ close: 100 + index }],
  }));
  class ApiError extends Error {}
  class Worker {
    constructor() {
      calls.workers++;
    }
    postMessage(message) {
      const results = message.series.map(({ symbol }) => {
      const index = symbols.indexOf(symbol);
      const candidates =
        symbol === options.emptySymbol
          ? []
          : [0, 1].map((i) => ({
              symbol,
              timestamp: `2026-10-0${i + 1}T00:00:00Z`,
              features: { price: 100 + index, ema9: 90, ema20: 80, rsi14: 55 },
            }));
      return {
              engine_version: "core-0.3.0",
              feature_schema_version:
                symbol === options.badSchemaSymbol
                  ? "unsupported"
                  : "screener-features-1",
              execution: "client_go_features",
              candidates,
              candle_count: 2,
              warnings: [],
      };
      });
      queueMicrotask(() => this.onmessage?.({data: {type: "result", jobId: message.jobId, results}}));
    }
    terminate() {}
  }
  class WebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor() {
      calls.sockets++;
      this.readyState = WebSocket.CONNECTING;
      queueMicrotask(() => {
        this.readyState = WebSocket.OPEN;
        this.onopen?.();
      });
    }
    send(encoded) {
      const message = JSON.parse(encoded);
      calls.messages.push(message);
      const results = message.candidates.map((candidate) => ({
        symbol: candidate.symbol,
        timestamp: candidate.timestamp,
        matched: candidate.symbol === "BBCA",
        reason_codes: [],
      }));
      queueMicrotask(() =>
        this.onmessage?.({
          data: JSON.stringify({
            type: "screener.result",
            protocol: message.protocol,
            request_id: message.request_id,
            decision_version: "decision-1",
            results: options.results ? options.results(results) : results,
          }),
        }),
      );
    }
    close() {
      this.readyState = 3;
    }
  }
  const api = {
    ensureAppSession: async () => {},
    prepareDataset: async () => ({ dataset_id: "local-fixture" }),
    getRule: async () => ({ id: "default-scalping-v1" }),
    getDatasetContent: async () => {
      options.afterDataset?.();
      return { series };
    },
    createComputeGrant: async () => {
      calls.grants++;
      return { id: "local-grant" };
    },
    createScreenerSocketTicket: async () => {
      calls.tickets++;
      return {
        ticket: "local-one-use",
        websocket_path: "/api/v1/screener/ws",
        protocol: "screener-private-1",
        feature_schema_version: "screener-features-1",
        max_candidates: options.maxCandidates ?? 1000,
      };
    },
  };
  const modules = {};
  function load(name) {
  if (modules[name]) return modules[name];
  const source = fs
    .readFileSync(path.join(__dirname, `../src/analysis/${name}.ts`), "utf8")
    .replaceAll("import.meta.url", '"http://localhost/screener.js"');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (name) => name === "./screener-dataset" ? { loadScreenerDataset: () => api.getDatasetContent() } : name === "../data/historical-cache" ? { CACHE_RESET_EVENT: "signalgen:historical-cache-reset" } : name.startsWith("./") ? load(name.slice(2)) : name === "@/lib/stock-catalog" ? { universeSelectionLimit: 10 } : ({
      api,
      ApiError,
      websocketURL: () => "ws://localhost/test",
    }),
    Worker,
    AbortController,
    WebSocket,
    URL,
    crypto: webcrypto,
    queueMicrotask,
    clearTimeout,
    performance,
    TextEncoder,
    setTimeout: (...args) => { const timer = setTimeout(...args); timer.unref(); return timer; },
    window: { setTimeout, addEventListener() {}, removeEventListener() {} },
  });
  modules[name] = exports;
  return exports;
  }
  return { run: load("screener").runLiveScreener, calls };
}

test("three-symbol screening uses one grant, ticket and socket for the whole batch", async () => {
  const c = screener();
  const run = await c.run(
    "rule",
    "universe",
    new AbortController().signal,
    () => {},
  );
  assert.equal(c.calls.workers, 1);
  assert.equal(c.calls.grants, 1);
  assert.equal(c.calls.tickets, 1);
  assert.equal(c.calls.sockets, 1);
  assert.equal(c.calls.messages.length, 1);
  assert.equal(c.calls.messages[0].candidates.length, 6);
  assert.equal(run.result.results.length, 6);
  assert.deepEqual(
    Array.from(run.rows, (row) => row.decision.symbol),
    ["BBCA", "BBRI", "TLKM"],
  );
  assert.deepEqual(
    Array.from(run.rows, (row) => row.latestClose),
    [100, 101, 102],
  );
  assert.ok(
    run.rows.every((row) => row.decision.timestamp === "2026-10-02T00:00:00Z"),
  );
});

test("combined candidate count respects the ticket limit using sequential sockets", async () => {
  const c = screener({ maxCandidates: 5 });
  const run = await c.run("rule", "universe", new AbortController().signal, () => {});
  assert.equal(run.rows.length, 3);
  assert.equal(c.calls.sockets, 2);
});

test("an empty symbol or mixed worker versions cannot issue a scoring grant", async () => {
  for (const options of [
    { emptySymbol: "BBRI" },
    { badSchemaSymbol: "BBRI" },
  ]) {
    const c = screener(options);
    await assert.rejects(
      c.run("rule", "universe", new AbortController().signal, () => {}),
    );
    assert.equal(c.calls.grants, 0);
    assert.equal(c.calls.sockets, 0);
  }
});

test("missing or reordered decisions never become another symbol's result", async () => {
  for (const results of [(rows) => rows.slice(1), (rows) => rows.reverse()]) {
    const c = screener({ results });
    await assert.rejects(
      c.run("rule", "universe", new AbortController().signal, () => {}),
      /The scoring response does not match this request|tidak cocok/,
    );
  }
});

test("cancelling before a run or after dataset fetch does not start scoring", async () => {
  for (const before of [true, false]) {
    const controller = new AbortController();
    const c = screener({ afterDataset: () => controller.abort() });
    if (before) controller.abort();
    await assert.rejects(
      c.run("rule", "universe", controller.signal, () => {}),
      /Analysis cancelled|dibatalkan/,
    );
    assert.equal(c.calls.grants, 0);
    assert.equal(c.calls.sockets, 0);
  }
});
