const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadStorageModule(mockIdb) {
  const exports = {};
  const code = fs.readFileSync(
    path.join(__dirname, "../src/analysis/signal-study-storage.ts"),
    "utf8",
  );
  const transpiled = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  vm.runInNewContext(transpiled, {
    exports,
    require: () => ({}),
    indexedDB: mockIdb,
    IDBKeyRange: mockIdb?.IDBKeyRange,
    TextEncoder,
    TextDecoder,
    DOMException,
    AbortController,
    JSON,
    Date,
    Error,
    Promise,
    Number,
    Array,
    Math,
  });
  return exports;
}

class MockIDBKeyRange {
  constructor(lower, upper, lowerOpen = false, upperOpen = false) {
    this.lower = lower;
    this.upper = upper;
    this.lowerOpen = lowerOpen;
    this.upperOpen = upperOpen;
  }
  static bound(lower, upper, lowerOpen = false, upperOpen = false) {
    return new MockIDBKeyRange(lower, upper, lowerOpen, upperOpen);
  }
  includes(key) {
    if (this.lower !== undefined) {
      if (this.lowerOpen ? key <= this.lower : key < this.lower) return false;
    }
    if (this.upper !== undefined) {
      if (this.upperOpen ? key >= this.upper : key > this.upper) return false;
    }
    return true;
  }
}

class MockIDB {
  IDBKeyRange = MockIDBKeyRange;
  databases = new Map();

  open(name, version) {
    const req = {
      result: null,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      onblocked: null,
    };

    setImmediate(() => {
      let db = this.databases.get(name);
      const isNew = !db;
      if (!db) {
        db = new MockDatabase(name, version);
        this.databases.set(name, db);
      }
      req.result = db;
      if (isNew && req.onupgradeneeded) {
        req.onupgradeneeded();
      }
      if (req.onsuccess) req.onsuccess();
    });

    return req;
  }
}

class MockDatabase {
  constructor(name, version) {
    this.name = name;
    this.version = version;
    this.stores = new Map();
    this.txQueue = [];
    this.runningTx = null;
    this.objectStoreNames = {
      contains: (n) => this.stores.has(n),
    };
  }
  createObjectStore(name, options = {}) {
    const store = new MockStoreData(name, options);
    this.stores.set(name, store);
    return store;
  }
  deleteObjectStore(name) {
    this.stores.delete(name);
  }
  transaction(storeNames, mode = "readonly") {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const tx = new MockTransaction(this, names, mode);
    this.txQueue.push(tx);
    this._drainQueue();
    return tx;
  }
  _drainQueue() {
    if (this.runningTx || this.txQueue.length === 0) return;
    const next = this.txQueue.shift();
    this.runningTx = next;
    next._start();
  }
  _txDone(tx) {
    if (this.runningTx === tx) {
      this.runningTx = null;
    }
    this._drainQueue();
  }
  close() {}
}

class MockStoreData {
  constructor(name, options = {}) {
    this.name = name;
    this.keyPath = options.keyPath;
    this.records = new Map();
  }
}

class MockTransaction {
  constructor(db, storeNames, mode) {
    this.db = db;
    this.storeNames = storeNames;
    this.mode = mode;
    this.started = false;
    this.active = true;
    this.aborted = false;
    this.error = null;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this.pendingOps = 0;
    this.checkTimer = null;
    this.queuedRequests = [];
    this.snapshots = new Map();
  }

  _start() {
    this.started = true;
    for (const name of this.storeNames) {
      const store = this.db.stores.get(name);
      if (store) {
        this.snapshots.set(name, new Map(store.records));
      }
    }
    const q = this.queuedRequests.slice();
    this.queuedRequests.length = 0;
    for (const fn of q) {
      setImmediate(fn);
    }
    this._scheduleCommit();
  }

  _beginReq() {
    this.pendingOps++;
    if (this.checkTimer) {
      clearImmediate(this.checkTimer);
      this.checkTimer = null;
    }
  }

  _endReq() {
    this.pendingOps--;
    this._scheduleCommit();
  }

  _scheduleCommit() {
    if (this.checkTimer) clearImmediate(this.checkTimer);
    this.checkTimer = setImmediate(() => {
      if (this.active && !this.aborted && this.pendingOps <= 0) {
        this.active = false;
        if (this.oncomplete) this.oncomplete();
        this.db._txDone(this);
      }
    });
  }

  objectStore(name) {
    const store = this.db.stores.get(name);
    if (!store) throw Error(`Store ${name} not found`);
    return new MockObjectStore(this, store);
  }

  abort() {
    if (this.aborted) return;
    this.aborted = true;
    this.active = false;
    if (this.checkTimer) {
      clearImmediate(this.checkTimer);
      this.checkTimer = null;
    }
    for (const [name, snapshot] of this.snapshots.entries()) {
      const store = this.db.stores.get(name);
      if (store) {
        store.records = new Map(snapshot);
      }
    }
    setImmediate(() => {
      if (this.onabort) this.onabort();
      this.db._txDone(this);
    });
  }
}

class MockObjectStore {
  constructor(tx, data) {
    this.tx = tx;
    this.data = data;
  }

  _enqueue(fn) {
    this.tx._beginReq();
    if (this.tx.started) {
      setImmediate(fn);
    } else {
      this.tx.queuedRequests.push(fn);
    }
  }

  get(key) {
    const req = {
      readyState: "pending",
      result: undefined,
      onsuccess: null,
      onerror: null,
    };
    this._enqueue(() => {
      if (this.tx.aborted) {
        this.tx._endReq();
        return;
      }
      req.result = this.data.records.get(key);
      req.readyState = "done";
      if (req.onsuccess) req.onsuccess();
      this.tx._endReq();
    });
    return req;
  }

  put(value, key) {
    const actualKey = this.data.keyPath ? value[this.data.keyPath] : key;
    if (actualKey === undefined) throw Error("Key is undefined for put");
    const req = { readyState: "pending", onsuccess: null, onerror: null };
    this._enqueue(() => {
      if (this.tx.aborted) {
        this.tx._endReq();
        return;
      }
      this.data.records.set(actualKey, JSON.parse(JSON.stringify(value)));
      req.readyState = "done";
      if (req.onsuccess) req.onsuccess();
      this.tx._endReq();
    });
    return req;
  }

  delete(key) {
    const req = { readyState: "pending", onsuccess: null, onerror: null };
    this._enqueue(() => {
      if (this.tx.aborted) {
        this.tx._endReq();
        return;
      }
      this.data.records.delete(key);
      req.readyState = "done";
      if (req.onsuccess) req.onsuccess();
      this.tx._endReq();
    });
    return req;
  }

  clear() {
    const req = { readyState: "pending", onsuccess: null, onerror: null };
    this._enqueue(() => {
      if (this.tx.aborted) {
        this.tx._endReq();
        return;
      }
      this.data.records.clear();
      req.readyState = "done";
      if (req.onsuccess) req.onsuccess();
      this.tx._endReq();
    });
    return req;
  }

  openCursor(range) {
    const req = { readyState: "pending", result: null, onsuccess: null };
    this._enqueue(() => {
      const sortedKeys = Array.from(this.data.records.keys())
        .filter((k) => !range || range.includes(k))
        .sort();
      let idx = 0;

      const step = () => {
        if (this.tx.aborted) {
          this.tx._endReq();
          return;
        }
        if (idx < sortedKeys.length) {
          const k = sortedKeys[idx++];
          req.result = {
            key: k,
            value: JSON.parse(JSON.stringify(this.data.records.get(k))),
            delete: () => {
              this.data.records.delete(k);
            },
            continue: () => {
              this.tx._beginReq();
              setImmediate(step);
            },
          };
        } else {
          req.result = null;
        }
        req.readyState = "done";
        if (req.onsuccess) req.onsuccess();
        this.tx._endReq();
      };

      step();
    });
    return req;
  }
}

function makeStudyResult(symbol, eventsCount = 5) {
  const events = [];
  for (let i = 0; i < eventsCount; i++) {
    events.push({
      symbol,
      timestamp: `2026-01-0${(i % 9) + 1}T10:00:00Z`,
      signal_type: i % 2 === 0 ? "BUY" : "SELL",
      reference_price: 150.5 + i,
      outcomes: [
        {
          basis: "close",
          step: 1,
          status: "evaluated",
          price: 153.25,
          return_pct: 1.83,
          timestamp: `2026-01-0${(i % 9) + 1}T11:00:00Z`,
        },
        {
          basis: "high",
          step: 2,
          status: "take_profit",
          price: 158.0,
          return_pct: 4.98,
        },
      ],
      swing: {
        basis: "barrier",
        step: 3,
        status: "evaluated",
        price: 160.0,
        return_pct: 6.31,
      },
    });
  }
  return {
    schema_version: "signal-study-1",
    policy_version: "signal-close-independent-1",
    config: { from: "2026-01-01", to: "2026-01-31", n_steps: 3 },
    events,
    horizons: [],
    swing: {
      target_hits: eventsCount,
      signals: eventsCount,
      evaluated: eventsCount,
      missing: 0,
      wins: eventsCount,
      losses: 0,
      flats: 0,
      sum_return_pct: eventsCount * 5,
      mean_return_pct: 5,
      win_rate: 100,
    },
    by_symbol: [],
    by_day: [],
    warnings: [],
  };
}

test("study storage preserves exact outcomes, horizon steps, full numbers and stable order", async () => {
  const mock = new MockIDB();
  const storage = loadStorageModule(mock);

  const owner = "test-user-1";
  const run = "test-run-1";
  const abort = new AbortController();

  await storage.storeStudySymbol(owner, run, "BBCA.JK", makeStudyResult("BBCA.JK", 3), abort.signal);
  await storage.storeStudySymbol(owner, run, "AAPL", makeStudyResult("AAPL", 2), abort.signal);
  await storage.storeStudySymbol(owner, run, "TLKM.JK", makeStudyResult("TLKM.JK", 4), abort.signal);

  const page = await storage.studyEventPage(owner, run, 0, 50);
  assert.equal(page.total, 9);
  assert.equal(page.rows.length, 9);

  assert.equal(page.rows[0].symbol, "AAPL");
  assert.equal(page.rows[1].symbol, "AAPL");
  assert.equal(page.rows[2].symbol, "BBCA.JK");
  assert.equal(page.rows[3].symbol, "BBCA.JK");
  assert.equal(page.rows[4].symbol, "BBCA.JK");
  assert.equal(page.rows[5].symbol, "TLKM.JK");

  const first = page.rows[0];
  assert.equal(first.reference_price, 150.5);
  assert.equal(first.outcomes.length, 2);
  assert.equal(first.outcomes[0].basis, "close");
  assert.equal(first.outcomes[0].step, 1);
  assert.equal(first.outcomes[0].status, "evaluated");
  assert.equal(first.outcomes[0].price, 153.25);
  assert.equal(first.outcomes[0].return_pct, 1.83);
  assert.equal(first.outcomes[0].timestamp, "2026-01-01T11:00:00Z");

  assert.equal(first.outcomes[1].basis, "high");
  assert.equal(first.outcomes[1].step, 2);
  assert.equal(first.outcomes[1].status, "take_profit");
  assert.equal(first.outcomes[1].price, 158.0);
  assert.equal(first.outcomes[1].return_pct, 4.98);

  assert.equal(first.swing.basis, "barrier");
  assert.equal(first.swing.step, 3);
  assert.equal(first.swing.price, 160.0);
  assert.equal(first.swing.return_pct, 6.31);
});

test("50-row pagination slices events accurately across multiple pages", async () => {
  const mock = new MockIDB();
  const storage = loadStorageModule(mock);

  const owner = "test-user-paging";
  const run = "run-paging";
  const abort = new AbortController();

  for (let s = 1; s <= 6; s++) {
    const sym = "SYM" + s;
    await storage.storeStudySymbol(owner, run, sym, makeStudyResult(sym, 20), abort.signal);
  }

  const p0 = await storage.studyEventPage(owner, run, 0, 50);
  assert.equal(p0.total, 120);
  assert.equal(p0.rows.length, 50);
  assert.equal(p0.rows[0].symbol, "SYM1");
  assert.equal(p0.rows[19].symbol, "SYM1");
  assert.equal(p0.rows[20].symbol, "SYM2");
  assert.equal(p0.rows[39].symbol, "SYM2");
  assert.equal(p0.rows[40].symbol, "SYM3");
  assert.equal(p0.rows[49].symbol, "SYM3");

  const p1 = await storage.studyEventPage(owner, run, 1, 50);
  assert.equal(p1.total, 120);
  assert.equal(p1.rows.length, 50);
  assert.equal(p1.rows[0].symbol, "SYM3");
  assert.equal(p1.rows[9].symbol, "SYM3");
  assert.equal(p1.rows[10].symbol, "SYM4");
  assert.equal(p1.rows[29].symbol, "SYM4");
  assert.equal(p1.rows[30].symbol, "SYM5");
  assert.equal(p1.rows[49].symbol, "SYM5");

  const p2 = await storage.studyEventPage(owner, run, 2, 50);
  assert.equal(p2.total, 120);
  assert.equal(p2.rows.length, 20);
  assert.equal(p2.rows[0].symbol, "SYM6");
  assert.equal(p2.rows[19].symbol, "SYM6");

  const p3 = await storage.studyEventPage(owner, run, 3, 50);
  assert.equal(p3.total, 120);
  assert.equal(p3.rows.length, 0);
});

test("legacy run initialization: existing A(7) and B(9) without metadata then new C(5) retains all in pagination and CSV", async () => {
  const mock = new MockIDB();
  const storage = loadStorageModule(mock);

  const owner = "legacy-owner";
  const run = "legacy-run";
  const abort = new AbortController();

  await storage.storeStudySymbol(owner, run, "A", makeStudyResult("A", 7), abort.signal);
  await storage.storeStudySymbol(owner, run, "B", makeStudyResult("B", 9), abort.signal);

  const db = mock.databases.get("signalgen-study-temporary-1");
  const sizesStore = db.stores.get("sizes");
  sizesStore.records.delete(`meta:${owner}\0${run}\0`);

  const beforeNewSymbol = await storage.studyEventPage(owner, run, 0, 50);
  assert.equal(beforeNewSymbol.total, 16);
  assert.equal(beforeNewSymbol.rows.length, 16);

  await storage.storeStudySymbol(owner, run, "C", makeStudyResult("C", 5), abort.signal);

  const afterNewSymbol = await storage.studyEventPage(owner, run, 0, 50);
  assert.equal(afterNewSymbol.total, 21);
  assert.equal(afterNewSymbol.rows.length, 21);

  const symbolsFound = afterNewSymbol.rows.map((r) => r.symbol);
  assert.equal(symbolsFound.filter((s) => s === "A").length, 7);
  assert.equal(symbolsFound.filter((s) => s === "B").length, 9);
  assert.equal(symbolsFound.filter((s) => s === "C").length, 5);

  await storage.storeStudySymbol(owner, run, "A", makeStudyResult("A", 12), abort.signal);
  const afterGreater = await storage.studyEventPage(owner, run, 0, 50);
  assert.equal(afterGreater.total, 26);

  await storage.storeStudySymbol(owner, run, "A", makeStudyResult("A", 3), abort.signal);
  const afterLess = await storage.studyEventPage(owner, run, 0, 50);
  assert.equal(afterLess.total, 17);

  await storage.storeStudySymbol(owner, run, "A", makeStudyResult("A", 0), abort.signal);
  const afterZero = await storage.studyEventPage(owner, run, 0, 50);
  assert.equal(afterZero.total, 14);
  assert.equal(afterZero.rows.filter((r) => r.symbol === "A").length, 0);
  assert.equal(afterZero.rows.filter((r) => r.symbol === "B").length, 9);
  assert.equal(afterZero.rows.filter((r) => r.symbol === "C").length, 5);
});

test("two concurrent writers on different symbols complete without data loss or corruption", async () => {
  const mock = new MockIDB();
  const storage = loadStorageModule(mock);

  const owner = "concurrent-owner";
  const run = "concurrent-run";
  const abort = new AbortController();

  await Promise.all([
    storage.storeStudySymbol(owner, run, "CONC_1", makeStudyResult("CONC_1", 10), abort.signal),
    storage.storeStudySymbol(owner, run, "CONC_2", makeStudyResult("CONC_2", 15), abort.signal),
  ]);

  const p = await storage.studyEventPage(owner, run, 0, 50);
  assert.equal(p.total, 25);
  assert.equal(p.rows.length, 25);
  assert.equal(p.rows.filter((r) => r.symbol === "CONC_1").length, 10);
  assert.equal(p.rows.filter((r) => r.symbol === "CONC_2").length, 15);
});

test("quota exceeded rolls back atomically without modifying existing records", async () => {
  const mock = new MockIDB();
  const storage = loadStorageModule(mock);

  const owner = "owner-quota";
  const run = "run-quota";
  const abort = new AbortController();

  await storage.storeStudySymbol(owner, run, "VALID1", makeStudyResult("VALID1", 5), abort.signal);
  const initial = await storage.studyEventPage(owner, run, 0, 50);
  assert.equal(initial.total, 5);

  const db = mock.databases.get("signalgen-study-temporary-1");
  const sizesStore = db.stores.get("sizes");
  sizesStore.records.set(owner, 127 * 1024 * 1024);

  const bigEvents = [];
  const chunk = "Y".repeat(2000);
  for (let i = 0; i < 1100; i++) {
    bigEvents.push({
      symbol: "BREACH",
      timestamp: "2026-01-01T00:00:00Z",
      signal_type: "BUY",
      reference_price: 100,
      outcomes: [{ basis: "close", step: 1, status: "evaluated", price: 100, return_pct: 0, timestamp: chunk }],
      swing: { basis: "barrier", step: 1, status: "evaluated", price: 100, return_pct: 0 },
    });
  }

  await assert.rejects(
    storage.storeStudySymbol(
      owner,
      run,
      "BREACH",
      {
        schema_version: "signal-study-1",
        policy_version: "signal-close-independent-1",
        config: { from: "2026-01-01", to: "2026-01-31", n_steps: 1 },
        events: bigEvents,
        horizons: [],
        swing: { signals: 0, evaluated: 0, missing: 0, wins: 0, losses: 0, flats: 0, sum_return_pct: 0, mean_return_pct: 0, win_rate: 0 },
        by_symbol: [],
        by_day: [],
        warnings: [],
      },
      abort.signal,
    ),
    /128\s*MiB/i,
  );

  const afterQuota = await storage.studyEventPage(owner, run, 0, 50);
  assert.equal(afterQuota.total, 5);
  assert.equal(afterQuota.rows.length, 5);
  assert.equal(afterQuota.rows[0].symbol, "VALID1");
});

test("cancellation aborts write transaction and preserves previous results", async () => {
  const mock = new MockIDB();
  const storage = loadStorageModule(mock);

  const owner = "owner-cancel";
  const run = "run-cancel";
  const liveAbort = new AbortController();

  await storage.storeStudySymbol(owner, run, "INIT", makeStudyResult("INIT", 8), liveAbort.signal);

  const preAborted = new AbortController();
  preAborted.abort();

  await assert.rejects(
    storage.storeStudySymbol(owner, run, "ABORTED", makeStudyResult("ABORTED", 10), preAborted.signal),
    (e) => e.name === "AbortError",
  );

  const current = await storage.studyEventPage(owner, run, 0, 50);
  assert.equal(current.total, 8);
  assert.equal(current.rows.length, 8);
  assert.equal(current.rows[0].symbol, "INIT");
});

test("owner cleanup isolates users and removes only targeted owner data", async () => {
  const mock = new MockIDB();
  const storage = loadStorageModule(mock);

  const userA = "user-alice";
  const userB = "user-bob";
  const run = "shared-run-id";
  const abort = new AbortController();

  await storage.storeStudySymbol(userA, run, "STOCKA", makeStudyResult("STOCKA", 12), abort.signal);
  await storage.storeStudySymbol(userB, run, "STOCKB", makeStudyResult("STOCKB", 18), abort.signal);

  const aBefore = await storage.studyEventPage(userA, run, 0, 50);
  const bBefore = await storage.studyEventPage(userB, run, 0, 50);
  assert.equal(aBefore.total, 12);
  assert.equal(bBefore.total, 18);

  await storage.clearStudyOwner(userA);

  const aAfter = await storage.studyEventPage(userA, run, 0, 50);
  const bAfter = await storage.studyEventPage(userB, run, 0, 50);
  assert.equal(aAfter.total, 0);
  assert.equal(aAfter.rows.length, 0);
  assert.equal(bAfter.total, 18);
  assert.equal(bAfter.rows.length, 18);

  await storage.clearAllStudyResults();
  const bFinal = await storage.studyEventPage(userB, run, 0, 50);
  assert.equal(bFinal.total, 0);
});

test("readonly transaction abort rejects rather than returning silently empty results", async () => {
  const mock = new MockIDB();
  const storage = loadStorageModule(mock);
  const owner = "owner-ro-fail";
  const run = "run-ro-fail";
  const abort = new AbortController();

  await storage.storeStudySymbol(owner, run, "VALID1", makeStudyResult("VALID1", 5), abort.signal);

  const db = mock.databases.get("signalgen-study-temporary-1");
  const origTx = db.transaction.bind(db);
  db.transaction = function (storeNames, mode) {
    const tx = origTx(storeNames, mode);
    if (mode === "readonly") {
      setImmediate(() => tx.abort());
    }
    return tx;
  };

  await assert.rejects(
    storage.studyEventPage(owner, run, 0, 50),
    (err) => err?.message === "Could not read study results.",
  );
});
