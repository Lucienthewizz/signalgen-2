const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const path = require("node:path");
const output = {};
const storage = new Map();
const browser = {
  dispatchEvent() {},
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  },
};
const storageModule = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, "../src/lib/workspace-storage.ts"),
      "utf8",
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  {
    exports: storageModule,
    TextEncoder,
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    window: browser,
  },
);
function loadMonitor() {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(
        path.join(__dirname, "../src/lib/market-monitor.ts"),
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
      require: () => storageModule,
      window: browser,
      Event: class Event {},
    },
  );
  return exports;
}
Object.assign(output, loadMonitor());
function fixture() {
  const decision = {
    symbol: "BBCA",
    timestamp: new Date().toISOString(),
    matched: true,
    reason_codes: ["MATCH"],
  };
  const features = { price: 100, ema9: 90, ema20: 80, rsi14: 60 };
  return {
    result: {
      type: "screener.result",
      protocol: "screener-private-1",
      request_id: "request-1",
      decision_version: "v1",
      results: [decision],
    },
    latestDecision: decision,
    features,
    manifest: {
      dataset_id: "dataset-1",
      version: "1",
      schema_version: "ohlcv-multi-1",
      provider: "yahoo_finance",
      purpose: "screen",
      market: "IDX",
      currency: "IDR",
      symbols: ["BBCA"],
      timeframe: "1d",
      timezone: "UTC",
      requested_range: { from: "2026-01-01", to: "2026-10-01" },
      available_range: { from: "2026-01-01", to: "2026-10-01" },
      warmup_candles: 20,
      adjustment: "split",
      candle_count: 100,
      decoded_bytes: 1000,
      checksum: "hash",
      quality: { status: "complete", warnings: [] },
    },
    latestClose: 100,
    latestOpen: 90,
    rows: [{ decision, features, latestClose: 100, latestOpen: 90 }],
    execution: "client_wasm+server_private_scoring",
  };
}
test("IDX codes normalize without accepting arbitrary widget symbols", () => {
  for (const value of ["bbca", "IDX:BBCA", "BBCA.JK", " BBCA "])
    assert.equal(output.idxTicker(value), "BBCA");
  for (const value of ["", "BTCUSDT", "AAPL<script>", "1234", "IDX:"])
    assert.equal(output.idxTicker(value), null);
});

test("US history, exchange metadata and namespaced watchlists survive reload without becoming IDX", () => {
  const run = fixture();
  const row = run.rows[0];
  row.decision.symbol = "AAPL";
  run.manifest.market = "US";
  run.manifest.currency = "USD";
  run.manifest.symbols = ["AAPL"];
  run.manifest.exchanges = ["XNAS"];
  output.recordMonitorRun("us-owner", "US rule", run);
  const restored = loadMonitor().monitorRuns("us-owner");
  assert.equal(restored.length, 1);
  assert.equal(restored[0].run.manifest.currency, "USD");
  assert.equal(restored[0].run.manifest.exchanges[0], "XNAS");
  assert.equal(output.monitorTicker("AAPL", "US"), "US:AAPL");
  assert.equal(output.watchTicker("US:BRK.B"), "US:BRK-B");
  assert.equal(output.watchTicker("NASDAQ:MSFT"), "US:MSFT");
  assert.equal(output.watchTicker("US:<script>"), null);
  assert.equal(output.watchTicker("US:BBCA.JK"), null);
  const bad = fixture();
  bad.manifest.market = "US";
  bad.manifest.currency = "IDR";
  output.recordMonitorRun("invalid-us", "Bad", bad);
  assert.equal(loadMonitor().monitorRuns("invalid-us").length, 0);
});
test("monitor history is account scoped and bounded to ten completed runs", () => {
  for (let i = 0; i < 12; i++)
    output.recordMonitorRun("account-a", `Rule ${i}`, fixture());
  assert.equal(output.monitorRuns("account-a").length, 10);
  assert.equal(output.monitorRuns("account-a")[0].rule, "Rule 11");
  assert.equal(output.monitorRuns("account-b").length, 0);
  assert.equal(output.monitorRuns().length, 0);
});
test("history restores after refresh and persists only whitelisted result fields", () => {
  const run = fixture();
  run.ticket = "secret-ticket";
  run.manifest.session_token = "secret-session";
  output.recordMonitorRun("restored-account", "Saved rule", run, {
    ruleId: "r1",
    universeId: "u1",
    universeName: "Banks",
    token: "secret-context",
  });
  const restored = loadMonitor().monitorRuns("restored-account");
  assert.equal(restored.length, 1);
  assert.equal(restored[0].context.universeName, "Banks");
  assert.equal(
    JSON.stringify([...storage.values()]).includes("secret-"),
    false,
  );
});
test("invalid and expired persisted history never reaches monitor rows", () => {
  storageModule.writeWorkspaceData("invalid-account", "monitor-history", [
    {
      rule: "Bad",
      recordedAt: new Date().toISOString(),
      run: { rows: [null] },
    },
  ]);
  assert.equal(loadMonitor().monitorRuns("invalid-account").length, 0);
  storageModule.writeWorkspaceData("old-account", "monitor-history", [
    {
      rule: "Old",
      recordedAt: new Date(Date.now() - 31 * 86400000).toISOString(),
      run: fixture(),
    },
  ]);
  assert.equal(loadMonitor().monitorRuns("old-account").length, 0);
});
test("partial or corrupted manifests cannot be restored into screener UI", () => {
  for (const manifest of [
    { market: "IDX", symbols: [] },
    { ...fixture().manifest, available_range: null },
    { ...fixture().manifest, quality: { status: null } },
    { ...fixture().manifest, checksum: 12 },
  ]) {
    storageModule.writeWorkspaceData("partial-manifest", "monitor-history", [
      {
        rule: "Invalid",
        recordedAt: new Date().toISOString(),
        run: { ...fixture(), manifest },
      },
    ]);
    assert.equal(loadMonitor().monitorRuns("partial-manifest").length, 0);
  }
});
test("storage quota failure keeps newly completed runs in memory and bounds snapshot rows", () => {
  const original = browser.localStorage;
  browser.localStorage = {
    getItem() {
      throw Error("blocked");
    },
    setItem() {
      throw Error("quota");
    },
  };
  try {
    const run = fixture();
    run.rows = Array.from({ length: 150 }, () => run.rows[0]);
    const monitor = loadMonitor();
    monitor.recordMonitorRun("blocked-account", "Latest", run);
    assert.equal(monitor.monitorRuns("blocked-account")[0].rule, "Latest");
    assert.equal(
      monitor.monitorRuns("blocked-account")[0].run.rows.length,
      100,
    );
  } finally {
    browser.localStorage = original;
  }
});
test("closing price direction compares against open without inventing missing data", () => {
  assert.equal(output.priceMovement(6000, 6100), "up");
  assert.equal(output.priceMovement(6000, 5900), "down");
  assert.equal(output.priceMovement(6000, 6000), "flat");
  for (const [open, close] of [
    [undefined, 6000],
    [6000, null],
    [NaN, 6000],
    [6000, Infinity],
    [null, null],
  ])
    assert.equal(output.priceMovement(open, close), "unknown");
});
test("history freezes user-rule evidence, strips extras, and never stores private system definitions", () => {
  const rule = {
    version: 3,
    definition_hash: "hash-3",
    owner_type: "user",
    definition: {
      name: "Snapshot",
      logic: "AND",
      signal_type: "BUY",
      cooldown_sec: 60,
      conditions: [
        { left: "PRICE", op: ">", right: "EMA20", token: "secret-condition" },
      ],
      token: "secret-definition",
    },
  };
  output.recordMonitorRun("frozen-rule", "Snapshot", fixture(), {
    ruleId: "rule",
    universeId: "u",
    universeName: "Banks",
    ruleSnapshot: output.frozenRule(rule),
  });
  rule.definition.conditions[0].right = 999;
  const snapshot =
    loadMonitor().monitorRuns("frozen-rule")[0].context.ruleSnapshot;
  assert.equal(snapshot.version, 3);
  assert.equal(snapshot.definition.conditions[0].right, "EMA20");
  assert.equal(JSON.stringify(snapshot).includes("secret-"), false);
  assert.equal(
    output.frozenRule({ ...rule, owner_type: "system" }).definition,
    undefined,
  );
});
test("run comparison only evaluates overlapping symbols, not missing stocks", () => {
  const before = {
    run: fixture(),
    context: { ruleId: "r", ruleSnapshot: { definition_hash: "one" } },
  };
  const after = {
    run: fixture(),
    context: { ruleId: "r", ruleSnapshot: { definition_hash: "two" } },
  };
  before.run.rows[0].decision.matched = false;
  after.run.rows.push({
    ...after.run.rows[0],
    decision: {
      ...after.run.rows[0].decision,
      symbol: "TLKM.JK",
      matched: true,
    },
  });
  const diff = output.compareMonitorRuns(before, after);
  assert.equal(diff.common, 1);
  assert.equal(diff.gained.join(), "BBCA");
  assert.equal(diff.unpaired.join(), "TLKM");
  assert.equal(diff.lost.length, 0);
  assert.equal(diff.sameRule, false);
});
test("open-close percentages never use missing, zero or invalid opening prices", () => {
  assert.equal(output.openCloseChange(100, 110), 10);
  assert.equal(output.openCloseChange(100, 90), -10);
  assert.equal(output.openCloseChange(100, 100), 0);
  for (const [open, close] of [
    [0, 100],
    [-1, 100],
    [null, 100],
    [100, NaN],
    [100, Infinity],
    [100, -5],
  ])
    assert.equal(output.openCloseChange(open, close), null);
});
test("snapshot age uses a conservative seven-calendar-day threshold and rejects future clocks", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  assert.equal(output.snapshotAge("2026-10-09T12:00:00Z", now), "recent");
  assert.equal(output.snapshotAge("2026-10-01T12:00:00Z", now), "old");
  assert.equal(output.snapshotAge("2026-11-01T12:00:00Z", now), "future");
  assert.equal(output.snapshotAge("invalid", now), "unknown");
});
