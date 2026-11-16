const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const ESBUILD =
  process.env.SIGNALGEN_DEPS ||
  "/private/tmp/signalgen-coordinator-frontend-o6v9sw1u/deps";

function loadTypeScript(file) {
  const { transformSync } = require(path.join(ESBUILD, "esbuild"));
  const source = fs.readFileSync(file, "utf8");
  const code = transformSync(source, {
    format: "cjs",
    loader: "ts",
    platform: "node",
    target: "es2022",
    sourcemap: false,
  }).code;
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded._compile(code, file);
  return loaded.exports;
}

const root = path.resolve(__dirname, "..");
const policy = loadTypeScript(
  path.join(root, "src/analysis/adaptive-study-policy.ts"),
);
const { SignalStudyEngine } = loadTypeScript(
  path.join(root, "src/analysis/signal-study-engine.ts"),
);

class FakeWorker {
  static all = [];

  constructor({ delay = 0, mode = "normal" } = {}) {
    this.delay = delay;
    this.mode = mode;
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
    this.active = 0;
    this.terminated = false;
    FakeWorker.all.push(this);
  }

  postMessage(message) {
    if (this.terminated) throw Error("terminated");
    this.active++;
    FakeWorker.peak = Math.max(
      FakeWorker.peak,
      FakeWorker.all.filter((w) => w.active).length,
    );
    if (this.mode === "stall") return;
    setTimeout(() => {
      this.active--;
      if (this.mode === "errorEvent") {
        this.onerror?.({ message: "worker error" });
      } else if (this.mode === "messageerror") {
        this.onmessageerror?.({ data: "worker message error" });
      } else if (this.mode === "error") {
        this.onmessage?.({ data: { jobId: message.jobId, error: "boom" } });
      } else if (this.mode === "malformed") {
        this.onmessage?.({ data: { jobId: message.jobId } });
      } else {
        if (this.mode === "stale")
          this.onmessage?.({
            data: { jobId: message.jobId - 1, result: "stale" },
          });
        this.onmessage?.({
          data: { jobId: message.jobId, result: { ok: true } },
        });
      }
    }, this.delay);
  }

  terminate() {
    this.terminated = true;
    this.active = 0;
  }
}

function freshEngine(options = {}) {
  FakeWorker.all = [];
  FakeWorker.peak = 0;
  return new SignalStudyEngine({
    workerFactory: () => new FakeWorker(options),
    timeoutMs: 50,
    ...options,
  });
}

function signal() {
  return new AbortController().signal;
}

test("policy uses hardware, memory, catalog, candles, and operands", () => {
  const work = {
    catalogSize: 40,
    batchSize: 10,
    candleCount: 6000,
    requiredOperands: 2,
  };
  assert.equal(policy.getAdaptiveStudyWorkerPolicy(work).maxWorkers, 1);
  assert.equal(
    policy.getAdaptiveStudyWorkerPolicy({
      ...work,
      hardwareConcurrency: 2,
    }).maxWorkers,
    2,
  );
  assert.equal(
    policy.getAdaptiveStudyWorkerPolicy({
      ...work,
      hardwareConcurrency: 4,
    }).maxWorkers,
    3,
  );
  assert.equal(
    policy.getAdaptiveStudyWorkerPolicy({
      ...work,
      hardwareConcurrency: 8,
    }).maxWorkers,
    4,
  );
  assert.equal(
    policy.getAdaptiveStudyWorkerPolicy({
      ...work,
      hardwareConcurrency: 8,
      deviceMemory: 2,
    }).maxWorkers,
    1,
  );
  assert.equal(
    policy.getAdaptiveStudyWorkerPolicy({
      ...work,
      hardwareConcurrency: 8,
      candleCount: 1500,
      requiredOperands: 1,
    }).maxWorkers,
    2,
  );
  assert.equal(
    policy.getAdaptiveStudyWorkerPolicy({
      ...work,
      hardwareConcurrency: 8,
      candleCount: 200,
    }).maxWorkers,
    1,
  );
});

test("pool overlaps jobs, retires surplus workers, and grows again", async () => {
  const engine = freshEngine({ delay: 5, maxWorkers: 4 });
  const controller = new AbortController();
  const jobs = Array.from({ length: 8 }, () =>
    engine.features([], [], controller.signal, 10),
  );
  await Promise.all(jobs);
  assert.equal(engine.workerCount, 4);
  assert.ok(FakeWorker.peak > 1);
  engine.setMaxWorkers(1);
  assert.equal(engine.workerCount, 1);
  engine.setMaxWorkers(4);
  await Promise.all(
    Array.from({ length: 4 }, () =>
      engine.features([], [], controller.signal, 10),
    ),
  );
  assert.equal(engine.workerCount, 4);
  engine.dispose();
});

test("payload and queue budgets reject excess work without deadlock", async () => {
  const engine = freshEngine({
    delay: 10,
    maxWorkers: 1,
    maxQueuedJobs: 2,
    maxQueuedPayloadBytes: 100,
  });
  const controller = new AbortController();
  const first = engine.features([], [], controller.signal, 80);
  await assert.rejects(
    engine.features([], [], controller.signal, 80),
    /queue budget/,
  );
  await first;
  await engine.features([], [], controller.signal, 120);
  engine.dispose();
});

test("worker errors and malformed responses fail every pending job", async () => {
  for (const mode of ["error", "malformed", "errorEvent", "messageerror"]) {
    const engine = freshEngine({ mode, maxWorkers: 2 });
    const controller = new AbortController();
    const jobs = [
      engine.features([], [], controller.signal),
      engine.features([], [], controller.signal),
    ];
    await assert.rejects(Promise.all(jobs));
    assert.equal(engine.activeJobs, 0);
    assert.equal(engine.queuedJobs, 0);
    assert.equal(engine.workerCount, 0);
  }
});

test("initialize and timeout dispose the pool without late writes", async () => {
  const ready = freshEngine();
  const initialized = await ready.initialize(signal());
  assert.deepEqual(initialized, { ok: true });
  ready.dispose();

  const stalled = freshEngine({ mode: "stall", timeoutMs: 5 });
  await assert.rejects(stalled.initialize(signal()), /exceeded 5 milliseconds/);
  assert.equal(stalled.workerCount, 0);
  assert.equal(stalled.activeJobs, 0);
});

test("stale results are ignored and abort rejects active and queued jobs", async () => {
  const engine = freshEngine({ mode: "stale", maxWorkers: 1 });
  await engine.features([], [], signal());
  engine.dispose();

  const stalled = freshEngine({ mode: "stall", maxWorkers: 1 });
  const controller = new AbortController();
  const active = stalled.features([], [], controller.signal);
  const queued = stalled.features([], [], controller.signal);
  controller.abort();
  await assert.rejects(active, /cancel/i);
  await assert.rejects(queued, /cancel/i);
  assert.equal(stalled.workerCount, 0);
});

test("constructor rejects invalid numeric options", () => {
  assert.throws(
    () => new SignalStudyEngine({ maxWorkers: Number.NaN }),
    /finite numbers/,
  );
  assert.throws(
    () => new SignalStudyEngine({ timeoutMs: Number.POSITIVE_INFINITY }),
    /finite numbers/,
  );
});
