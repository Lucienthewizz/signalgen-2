const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { webcrypto } = require("node:crypto");

function load(name, context) {
  const exports = {};
  const source = fs
    .readFileSync(path.join(__dirname, `../src/analysis/${name}.ts`), "utf8")
    .replaceAll(
      "import.meta.url",
      '"https://example.test/src/analysis/screener-engine.ts"',
    );
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    { exports, TextEncoder, URL, AbortController, crypto: webcrypto, performance, ...context },
  );
  return exports;
}
function group(symbol, count) {
  return {
    engine_version: "core-0.5.0",
    feature_schema_version: "screener-features-1",
    execution: "client_go_features",
    candle_count: count,
    warnings: [],
    candidates: Array.from({ length: count }, (_, i) => ({
      symbol,
      timestamp: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
      features: { price: 100, ema9: 90, ema20: 80, rsi14: 60 },
    })),
  };
}
const pack = load("screener-batches").packCandidateBatches;
test("batch packing reduces three stock messages to one without dropping chronology", () => {
  const groups = [
    group("BBCA.JK", 40),
    group("BBRI.JK", 40),
    group("TLKM.JK", 40),
  ];
  const packed = pack(groups, 1000);
  assert.equal(packed.length, 1);
  assert.equal(packed[0].candidates.length, 120);
  assert.equal(groups[0].candidates.length, 40);
  assert.equal(packed[0].candidates[40].symbol, "BBRI.JK");
});
test("larger batches split only between stocks, preserving per-stock cooldown history", () => {
  const packed = pack([group("BBCA.JK", 600), group("BBRI.JK", 600)], 1000);
  assert.equal(packed.length, 2);
  assert.equal(packed[0].candidates.length, 600);
  assert.equal(packed[1].candidates.length, 600);
  assert.throws(() => pack([group("BBCA.JK", 1001)], 1000), /cannot be split/);
  assert.throws(() => pack([group("BBCA.JK", 5)], 0), /Invalid/);
  assert.throws(() => pack([group("BBCA.JK", 5)], 1000, 10), /cannot be split/);
});

function harness(stockCount = 3) {
  const counts = {
    workers: 0,
    terminated: 0,
    grants: 0,
    tickets: 0,
    sockets: 0,
    sent: 0,
  };
  let hold = false,
    socketMode = "ok",
    maximum = 1000,
    timers = new Map(),
    timerId = 0;
  const clock = {
    setTimeout(fn) {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }
  const symbols = Array.from({ length: stockCount }, (_, i) => ["BBCA.JK", "BBRI.JK", "TLKM.JK"][i] ?? `TEST${i}.JK`);
  const series = symbols.map((symbol) => ({
    symbol,
    candles: [{ open: 95, close: 100 }],
  }));
  const api = {
    ensureAppSession: async () => "fixture",
    prepareDataset: async () => ({ dataset_id: "fixture" }),
    getRule: async () => ({ id: "rule", version: 1 }),
    getDatasetContent: async () => ({ series }),
    createComputeGrant: async () => {
      counts.grants++;
      return { id: "grant" };
    },
    createScreenerSocketTicket: async () => {
      counts.tickets++;
      return {
        max_candidates: maximum,
        websocket_path: "/ws",
        ticket: "fixture",
        protocol: "screener-private-1",
        feature_schema_version: "screener-features-1",
      };
    },
  };
  class Worker {
    constructor() {
      counts.workers++;
    }
    postMessage(message) {
      if (!hold)
        queueMicrotask(() =>
          this.onmessage?.({
            data: {
              type: "result",
              jobId: message.jobId,
              results: message.series.map((s) => group(s.symbol, 40)),
            },
          }),
        );
    }
    terminate() {
      counts.terminated++;
    }
  }
  class Socket {
    static CONNECTING = 0;
    static OPEN = 1;
    readyState = 0;
    constructor() {
      counts.sockets++;
      queueMicrotask(() => {
        this.readyState = 1;
        this.onopen?.();
      });
    }
    send(raw) {
      counts.sent++;
      const msg = JSON.parse(raw);
      queueMicrotask(() => {
        if (socketMode === "close") return this.onclose?.({ wasClean: true });
        if (socketMode === "null") return this.onmessage?.({ data: "null" });
        const results = msg.candidates.map((c) => ({
          symbol: c.symbol,
          timestamp: c.timestamp,
          matched: true,
          reason_codes: ["RULE_MATCHED"],
        }));
        if (socketMode === "mismatch") results[0].symbol = "WRONG";
        this.onmessage?.({
          data: JSON.stringify({
            type: "screener.result",
            protocol: msg.protocol,
            request_id: msg.request_id,
            decision_version: "fixture",
            results,
          }),
        });
      });
    }
    close() {
      this.readyState = 3;
    }
  }
  const client = {
    api,
    ApiError,
    websocketURL: () => "ws://example.test/fixture",
  };
  const base = {
    require: () => client,
    window: { ...clock, addEventListener() {}, removeEventListener() {} },
    ...clock,
    Worker,
    WebSocket: Socket,
  };
  const engine = load("screener-engine", base);
  const socket = load("screener-socket", base);
  const run = load("screener", {
    ...base,
    require(name) {
      if (name === "@/lib/stock-catalog") return { universeSelectionLimit: 10 };
      if (name === "./screener-dataset") return { loadScreenerDataset: () => api.getDatasetContent() };
      if (name === "../data/historical-cache") return { CACHE_RESET_EVENT: "signalgen:historical-cache-reset" };
      return name === "./screener-engine"
        ? engine
        : name === "./screener-batches"
          ? { packCandidateBatches: pack }
          : name === "./screener-socket"
            ? socket
            : client;
    },
  });
  return {
    counts,
    engine,
    run,
    series,
    hold(value) {
      hold = value;
    },
    socketMode(value) {
      socketMode = value;
    },
    max(value) {
      maximum = value;
    },
    expire() {
      for (const fn of [...timers.values()]) fn();
    },
  };
}
test("three-stock run uses one worker, one grant/ticket/socket and a warm second run reuses the engine", async () => {
  const h = harness();
  const first = await h.run.runLiveScreener(
    "r",
    "u",
    new AbortController().signal,
    () => {},
  );
  assert.equal(first.rows.length, 3);
  assert.equal(first.metrics.candidates, 120);
  assert.deepEqual(h.counts, {
    workers: 1,
    terminated: 0,
    grants: 1,
    tickets: 1,
    sockets: 1,
    sent: 1,
  });
  await h.run.runLiveScreener("r", "u", new AbortController().signal, () => {});
  assert.equal(h.counts.workers, 1);
  h.engine.disposeScreenerEngine();
});
test("ten stocks share one warm worker, one grant and one bounded scoring socket", async () => {
  const h = harness(10);
  const run = await h.run.runLiveScreener("r", "u", new AbortController().signal, () => {});
  assert.equal(run.rows.length, 10);
  assert.equal(run.result.results.length, 400);
  assert.equal(h.counts.workers, 1);
  assert.equal(h.counts.grants, 1);
  assert.equal(h.counts.sockets, 1);
  assert.deepEqual(Array.from(run.rows, r => r.decision.symbol), h.series.map(s => s.symbol));
  h.engine.disposeScreenerEngine();
});
test("an eleventh stock is rejected before starting a worker or consuming a grant", async () => {
  const h = harness(11);
  await assert.rejects(h.run.runLiveScreener("r", "u", new AbortController().signal, () => {}), /1–10/);
  assert.equal(h.counts.workers, 0);
  assert.equal(h.counts.grants, 0);
});
test("a pre-cancelled run never begins access checks, compute, or scoring", async () => {
  const h = harness(10);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(h.run.runLiveScreener("r", "u", controller.signal, () => {}), /cancelled/);
  assert.equal(h.counts.workers, 0);
  assert.equal(h.counts.grants, 0);
  assert.equal(h.counts.sockets, 0);
});
test("candidate limits use sequential bounded sockets and still only one grant", async () => {
  const h = harness();
  h.max(50);
  const run = await h.run.runLiveScreener(
    "r",
    "u",
    new AbortController().signal,
    () => {},
  );
  assert.equal(run.rows.length, 3);
  assert.equal(h.counts.workers, 1);
  assert.equal(h.counts.grants, 1);
  assert.equal(h.counts.sockets, 3);
  h.engine.disposeScreenerEngine();
});
test("cancellation terminates compute, rejects promptly and permits a fresh worker", async () => {
  const h = harness();
  h.hold(true);
  const controller = new AbortController();
  const pending = h.engine.extractDatasetFeatures(h.series, controller.signal);
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(h.counts.terminated, 1);
  h.hold(false);
  await h.engine.extractDatasetFeatures(h.series, new AbortController().signal);
  assert.equal(h.counts.workers, 2);
  h.engine.disposeScreenerEngine();
});
test("worker timeout cleans up, concurrent jobs are rejected and pre-aborted jobs create no worker", async () => {
  const h = harness();
  h.hold(true);
  const aborted = new AbortController();
  aborted.abort();
  assert.throws(() =>
    h.engine.extractDatasetFeatures(h.series, aborted.signal),
  );
  assert.equal(h.counts.workers, 0);
  const pending = h.engine.extractDatasetFeatures(
    h.series,
    new AbortController().signal,
  );
  await assert.rejects(
    h.engine.extractDatasetFeatures(h.series, new AbortController().signal),
    /computation is running/,
  );
  h.expire();
  await assert.rejects(pending, /45-second/);
  assert.equal(h.counts.terminated, 1);
});
test("clean early socket close and mismatched decisions fail instead of showing incomplete results", async () => {
  for (const mode of ["close", "mismatch", "null"]) {
    const h = harness();
    h.socketMode(mode);
    await assert.rejects(
      h.run.runLiveScreener("r", "u", new AbortController().signal, () => {}),
      /before all results|does not match|is invalid/,
    );
    h.engine.disposeScreenerEngine();
  }
});
