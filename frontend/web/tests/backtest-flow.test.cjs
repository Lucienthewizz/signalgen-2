const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { webcrypto, createHash } = require("node:crypto");

function load(name, modules, extra = {}) {
  const exports = {};
  const source = fs
    .readFileSync(path.join(__dirname, "../src/analysis", name + ".ts"), "utf8")
    .replaceAll("import.meta.url", '"http://localhost/backtest-engine.ts"');
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      require: (id) => {
        if (!(id in modules)) throw Error("Unexpected import " + id);
        return modules[id];
      },
      TextEncoder,
      URL,
      AbortController,
      DOMException,
      Date,
      crypto: webcrypto,
      setTimeout,
      clearTimeout,
      ...extra,
    },
  );
  return exports;
}
class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const config = {
  mode: "rule",
  timeframe: "1d",
  from: "2026-01-20",
  to: "2026-01-23",
  n_steps: 3,
  exit_strategy: "holding_period",
  initial_capital: 10000,
  position_sizing: "percent_equity",
  position_size: 100,
  commission_pct: 0,
  slippage_pct: 0,
};
const versions = {
  BACKTEST_SCHEMA: "backtest-2",
  BACKTEST_POLICY: "holding-next-open-1",
};

function harness() {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "../../../backend/core/testdata/backtest_next_open_v1.json",
      ),
      "utf8",
    ),
  );
  const scope = {
    mode: "rule",
    from: config.from,
    to: config.to,
    n_steps: 3,
    rule_id: "rule-a",
  };
  const dataset = {
    schema_version: "ohlcv-multi-1",
    purpose: "backtest",
    market: "IDX",
    currency: "IDR",
    timeframe: "1d",
    timezone: "UTC",
    adjustment: "none",
    backtest: scope,
    series: fixture.series,
  };
  const text = JSON.stringify(dataset);
  const manifest = {
    dataset_id: "data-a",
    version: "v1",
    purpose: "backtest",
    schema_version: "ohlcv-multi-1",
    market: "IDX",
    currency: "IDR",
    timeframe: "1d",
    timezone: "UTC",
    adjustment: "none",
    symbols: ["TEST"],
    backtest: scope,
    decoded_bytes: Buffer.byteLength(text),
    checksum: "sha256:" + createHash("sha256").update(text).digest("hex"),
  };
  let revision = 1;
  const calls = {
    grants: 0,
    features: 0,
    simulations: 0,
    reads: 0,
    checks: 0,
    prepared: 0,
  };
  const api = {
    ensureAppSession: async () => {},
    account: async () => {
      calls.checks++;
      return { user: { id: "owner" }, features: ["backtest"] };
    },
    backtestCapabilities: async () => ({
      backtest: {
        schema_version: versions.BACKTEST_SCHEMA,
        policy_version: versions.BACKTEST_POLICY,
      },
    }),
    prepareBacktest: async () => {
      calls.prepared++;
      return manifest;
    },
    getDatasetContentText: async () => {
      calls.reads++;
      return text;
    },
    getBacktestManifest: async () => manifest,
    getRule: async () => ({ id: "rule-a", definition: { signal_type: "BUY" } }),
    createBacktestGrant: async () => {
      calls.grants++;
      return { id: "grant-a" };
    },
    backtestSignals: async () => ({
      policy_version: versions.BACKTEST_POLICY,
      entries: [
        {
          symbol: "TEST",
          timestamp: dataset.series[0].candles[19].timestamp,
          signal_type: "BUY",
        },
      ],
    }),
  };
  const session = {
    getToken: () => "synthetic-token",
    getIdentityRevision: () => revision,
  };
  const engine = {
    extractBacktestFeatures: async () => {
      calls.features++;
      return dataset.series.map((series) => ({
        engine_version: "core-0.4.0",
        feature_schema_version: "screener-features-1",
        candidates: series.candles.slice(19).map((candle) => ({
          symbol: series.symbol,
          timestamp: candle.timestamp,
        })),
      }));
    },
    simulateBacktest: async (request) => {
      calls.simulations++;
      return {
        schema_version: versions.BACKTEST_SCHEMA,
        policy_version: versions.BACKTEST_POLICY,
        horizons: Array.from({ length: request.config.n_steps }, () => ({})),
      };
    },
  };
  const module = load("backtest", {
    "@/api/client": { api, session, ApiError },
    "./backtest-types": versions,
    "./backtest-engine": engine,
  });
  return { module, api, calls, manifest, changeIdentity: () => revision++ };
}
const prepare = (h) =>
  h.module.prepareBacktest(
    config,
    "rule-a",
    "univ-a",
    new AbortController().signal,
    () => {},
  );

test("backtest verifies integrity and uses one grant without splitting symbol history", async () => {
  const h = harness();
  const prepared = await prepare(h);
  await h.module.runBacktest(
    prepared,
    config,
    "rule-a",
    [],
    new AbortController().signal,
    () => {},
  );
  assert.deepEqual(h.calls, {
    grants: 1,
    features: 1,
    simulations: 1,
    reads: 1,
    checks: 2,
    prepared: 1,
  });
});
test("invalid form, changed scope and integrity failures never reach computation", async () => {
  const h = harness();
  await assert.rejects(
    h.module.prepareBacktest(
      { ...config, n_steps: 0 },
      "rule-a",
      "univ-a",
      new AbortController().signal,
      () => {},
    ),
    /Holding/,
  );
  assert.equal(h.calls.checks, 0);
  h.manifest.checksum = "sha256:wrong";
  await assert.rejects(prepare(h), /integrity/);
  assert.equal(h.calls.simulations, 0);
  const other = harness();
  other.manifest.backtest = { ...other.manifest.backtest, from: "2020-01-01" };
  await assert.rejects(prepare(other), /selections/);
  assert.equal(other.calls.reads, 0);
});
test("identity change, cancellation and revoked access block retained snapshots", async () => {
  const h = harness();
  const prepared = await prepare(h);
  h.changeIdentity();
  await assert.rejects(
    h.module.runBacktest(
      prepared,
      config,
      "rule-a",
      [],
      new AbortController().signal,
      () => {},
    ),
    /Account changed/,
  );
  assert.equal(h.calls.features, 0);
  const other = harness();
  const second = await prepare(other);
  other.api.getBacktestManifest = async () => {
    throw new ApiError("Access revoked", 403);
  };
  await assert.rejects(
    other.module.runBacktest(
      second,
      config,
      "rule-a",
      [],
      new AbortController().signal,
      () => {},
    ),
    /revoked/,
  );
  assert.equal(other.calls.simulations, 0);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    other.module.runBacktest(
      second,
      config,
      "rule-a",
      [],
      cancelled.signal,
      () => {},
    ),
    { name: "AbortError" },
  );
});
test("invalid server entries and SELL rules cannot reach the financial simulator", async () => {
  const h = harness();
  const prepared = await prepare(h);
  h.api.backtestSignals = async () => ({
    policy_version: versions.BACKTEST_POLICY,
    entries: [
      {
        symbol: "FOREIGN",
        timestamp: "2026-01-20T00:00:00Z",
        signal_type: "BUY",
      },
    ],
  });
  await assert.rejects(
    h.module.runBacktest(
      prepared,
      config,
      "rule-a",
      [],
      new AbortController().signal,
      () => {},
    ),
    /invalid backtest entries/,
  );
  h.api.getRule = async () => ({ definition: { signal_type: "SELL" } });
  await assert.rejects(
    h.module.runBacktest(
      prepared,
      config,
      "rule-a",
      [],
      new AbortController().signal,
      () => {},
    ),
    /BUY/,
  );
  assert.equal(h.calls.simulations, 0);
});
test("manual mode rereads online access without a rule grant", async () => {
  const h = harness();
  const prepared = await prepare(h);
  prepared.manifest.backtest = {
    ...prepared.manifest.backtest,
    mode: "manual",
    rule_id: undefined,
  };
  await h.module.runBacktest(
    prepared,
    { ...config, mode: "manual" },
    "",
    [{ symbol: "TEST", timestamp: "2026-01-20T00:00:00Z", signal_type: "BUY" }],
    new AbortController().signal,
    () => {},
  );
  assert.equal(h.calls.grants, 0);
  assert.equal(h.calls.features, 0);
  assert.equal(h.calls.simulations, 1);
  assert.equal(h.calls.checks, 2);
});
test("schema mismatch stops before historical fetch and asks for refresh", async () => {
  const h = harness();
  h.api.backtestCapabilities = async () => ({
    backtest: {
      schema_version: "backtest-1",
      policy_version: versions.BACKTEST_POLICY,
    },
  });
  await assert.rejects(() => prepare(h), /refresh the app/);
  assert.equal(h.calls.prepared, 0);
  assert.equal(h.calls.simulations, 0);
});
test("archive provenance receives the rule actually bound to the grant", async () => {
  const h = harness();
  const prepared = await prepare(h);
  let observed;
  h.api.getRule = async () => ({
    id: "rule-a",
    name: "Updated rule",
    version: 7,
    definition_hash: "sha256:updated",
    definition: { signal_type: "BUY" },
  });
  await h.module.runBacktest(
    prepared,
    config,
    "rule-a",
    [],
    new AbortController().signal,
    () => {},
    (rule) => {
      observed = rule;
    },
  );
  assert.equal(observed.version, 7);
  assert.equal(observed.definition_hash, "sha256:updated");
  assert.equal(h.calls.simulations, 1);
});
test("backtest worker terminates on success/cancel and ignores late or unrelated jobs", async () => {
  const workers = [];
  class Worker {
    constructor() {
      this.terminated = 0;
      workers.push(this);
    }
    postMessage(message) {
      this.message = message;
    }
    terminate() {
      this.terminated++;
    }
  }
  const m = load(
    "backtest-engine",
    { "@/api/client": { ApiError } },
    { Worker },
  );
  const controller = new AbortController();
  const promise = m.extractBacktestFeatures([], controller.signal);
  const worker = workers[0],
    late = worker.onmessage;
  controller.abort();
  await assert.rejects(promise, { name: "AbortError" });
  assert.equal(worker.terminated, 1);
  late({ data: { jobId: worker.message.jobId, type: "result", result: [] } });
  assert.equal(worker.terminated, 1);
  const next = m.extractBacktestFeatures([], new AbortController().signal),
    second = workers[1];
  second.onmessage({ data: { jobId: "stale-job", type: "error" } });
  assert.equal(second.terminated, 0);
  second.onmessage({
    data: { jobId: second.message.jobId, type: "result", result: [] },
  });
  await next;
  assert.equal(second.terminated, 1);
});
