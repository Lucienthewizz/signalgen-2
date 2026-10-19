const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { webcrypto } = require("node:crypto");

function moduleFrom(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(path.join(__dirname, "../src", file + ".ts"), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      exports,
      require: (name) => {
        if (!(name in dependencies))
          throw Error(`Unexpected dependency ${name}`);
        return dependencies[name];
      },
      crypto: webcrypto,
      TextEncoder,
      TextDecoder,
      Blob,
      CompressionStream,
      DecompressionStream,
      DOMException,
      Uint8Array,
      Date,
      JSON,
      setTimeout,
      clearTimeout,
    },
  );
  return exports;
}
const codec = moduleFrom("data/historical-crypto");
const storeModule = moduleFrom("data/historical-store", {
  "./historical-crypto": codec,
});
const { HistoricalCache, historicalScope } = moduleFrom(
  "data/historical-cache",
  {
    "./historical-crypto": codec,
    "./historical-store": storeModule,
  },
);

class MemoryStore {
  records = new Map();
  keys = new Map();
  epoch = "initial";
  async begin(scope, active) {
    const epoch = this.epoch;
    const key = this.keys.get(scope) ?? (await codec.newCacheKey());
    if (!active() || epoch !== this.epoch) throw Error("Inactive lease");
    this.keys.set(scope, key);
    return { epoch, key };
  }
  async read(id) {
    return structuredClone(this.records.get(id));
  }
  async write(epoch, record) {
    if (epoch === this.epoch)
      this.records.set(record.id, structuredClone(record));
  }
  async current(epoch) {
    return epoch === this.epoch;
  }
  async remove(id) {
    this.records.delete(id);
  }
  async clear() {
    this.epoch = webcrypto.randomUUID();
    this.records.clear();
    this.keys.clear();
  }
  async stats(scope) {
    const rows = [...this.records.values()].filter((r) => r.scope === scope);
    return {
      entries: rows.length,
      bytes: rows.reduce((sum, r) => sum + r.ciphertext.byteLength, 0),
    };
  }
}
async function fixture() {
  const data = {
    schema_version: "ohlcv-multi-1",
    purpose: "screen",
    market: "IDX",
    currency: "IDR",
    timeframe: "1d",
    timezone: "UTC",
    adjustment: "none",
    series: [
      {
        symbol: "BBCA.JK",
        timezone: "UTC",
        candles: [
          {
            timestamp: "2026-01-01T00:00:00Z",
            open: 100,
            high: 110,
            low: 90,
            close: 105,
            volume: 123,
          },
        ],
      },
    ],
  };
  // Whitespace is intentional: verify original response bytes, never re-serialized JSON.
  const text = JSON.stringify(data, null, 2);
  const bytes = new TextEncoder().encode(text);
  const manifest = {
    dataset_id: "snapshot-1",
    version: "version-1",
    ...data,
    series: undefined,
    symbols: ["BBCA.JK"],
    candle_count: 1,
    decoded_bytes: bytes.byteLength,
    checksum: `sha256:${await codec.sha256(bytes)}`,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  };
  const scope = await historicalScope(
    "https://api.test",
    "owner-a",
    "installation-a",
  );
  const store = new MemoryStore();
  const cache = new HistoricalCache(store);
  let requests = 0;
  const fetchText = async () => {
    requests++;
    return text;
  };
  const load = (nextManifest = manifest, nextScope = scope) =>
    cache.load(
      nextScope,
      nextManifest,
      fetchText,
      new AbortController().signal,
    );
  return {
    data,
    text,
    bytes,
    manifest,
    scope,
    store,
    cache,
    load,
    fetchText,
    requests: () => requests,
  };
}

test("OHLCV round trips as compressed AES-256-GCM ciphertext with a non-extractable scoped key", async () => {
  const f = await fixture();
  assert.deepEqual(await f.load(), f.data);
  assert.deepEqual(await f.load(), f.data);
  assert.equal(f.requests(), 1);
  const record = [...f.store.records.values()][0];
  assert.equal(record.iv.byteLength, 12);
  assert.equal(record.format, "ohlcv-gzip-aes256gcm-1");
  assert.equal(
    new TextDecoder().decode(record.ciphertext).includes('"candles"'),
    false,
  );
  assert.equal("series" in record, false);
  const key = f.store.keys.get(f.scope);
  assert.equal(key.algorithm.length, 256);
  assert.equal(key.extractable, false);
  await assert.rejects(webcrypto.subtle.exportKey("raw", key));
  assert.equal((await f.cache.stats(f.scope)).entries, 1);
});

test("each encryption uses a fresh IV and authenticated metadata rejects wrong owner/version/checksum/expiry", async () => {
  const f = await fixture();
  await f.load();
  const record = [...f.store.records.values()][0];
  const key = f.store.keys.get(f.scope);
  const second = await codec.sealSnapshot(
    record.id,
    record.binding,
    key,
    f.bytes,
  );
  assert.notDeepEqual(record.iv, second.iv);
  for (const field of [
    "scope",
    "datasetId",
    "version",
    "schema",
    "checksum",
    "decodedBytes",
    "expiresAt",
  ]) {
    const changed = {
      ...record.binding,
      [field]:
        typeof record.binding[field] === "number"
          ? record.binding[field] + 1
          : "wrong",
    };
    await assert.rejects(
      codec.openSnapshot({ ...record, binding: changed }, changed, key),
    );
  }
});

test("tampered ciphertext, tag, IV and metadata are evicted and re-downloaded, never used for computation", async () => {
  for (const corrupt of [
    (r) => {
      new Uint8Array(r.ciphertext)[0] ^= 1;
    },
    (r) => {
      new Uint8Array(r.ciphertext)[r.ciphertext.byteLength - 1] ^= 1;
    },
    (r) => {
      r.iv[0] ^= 1;
    },
    (r) => {
      r.binding.schema = "bad";
    },
    (r) => {
      r.binding.expiresAt = Date.now() - 1;
    },
  ]) {
    const f = await fixture();
    await f.load();
    corrupt([...f.store.records.values()][0]);
    assert.deepEqual(await f.load(), f.data);
    assert.equal(f.requests(), 2);
  }
});

test("different owner, installation, API origin, dataset version and checksum cannot reuse a cache entry", async () => {
  const f = await fixture();
  await f.load();
  for (const scope of [
    await historicalScope("https://api.test", "owner-b", "installation-a"),
    await historicalScope("https://api.test", "owner-a", "installation-b"),
    await historicalScope("https://other.test", "owner-a", "installation-a"),
  ])
    await f.load(f.manifest, scope);
  await f.load({ ...f.manifest, version: "version-2" });
  assert.equal(f.requests(), 5);
  await assert.rejects(
    f.load({ ...f.manifest, checksum: `sha256:${"0".repeat(64)}` }),
    /Checksum/,
  );
  await assert.rejects(
    f.load({ ...f.manifest, schema_version: "bad" }),
    /Schema/,
  );
  await assert.rejects(
    f.load({
      ...f.manifest,
      expires_at: new Date(Date.now() - 1).toISOString(),
    }),
    /kedaluwarsa/,
  );
});

test("corrupt network bytes fail closed before any ciphertext is persisted", async () => {
  const f = await fixture();
  await assert.rejects(
    f.cache.load(
      f.scope,
      f.manifest,
      async () => f.text + " ",
      new AbortController().signal,
    ),
    /Checksum/,
  );
  assert.equal(f.store.records.size, 0);
});

test("USD snapshots round trip encrypted, while invalid market/currency pairs fail closed", async () => {
  const f = await fixture();
  const data = {
    ...f.data,
    market: "US",
    currency: "USD",
    series: [{ ...f.data.series[0], symbol: "AAPL" }],
  };
  const text = JSON.stringify(data);
  const bytes = new TextEncoder().encode(text);
  const manifest = {
    ...f.manifest,
    market: "US",
    currency: "USD",
    symbols: ["AAPL"],
    exchanges: ["XNAS"],
    decoded_bytes: bytes.length,
    checksum: `sha256:${await codec.sha256(bytes)}`,
  };
  assert.equal(
    (
      await f.cache.load(
        f.scope,
        manifest,
        async () => text,
        new AbortController().signal,
      )
    ).market,
    "US",
  );
  assert.equal(
    (
      await f.cache.load(
        f.scope,
        manifest,
        async () => {
          throw Error("cache missed");
        },
        new AbortController().signal,
      )
    ).currency,
    "USD",
  );
  await assert.rejects(
    codec.decodeDataset(bytes, { ...manifest, currency: "IDR" }),
    /Schema/,
  );
});

test("oversized plaintext and compressed expansion are bounded before use", async () => {
  const f = await fixture();
  const oversized = new Uint8Array(codec.MAX_DATASET_BYTES + 1);
  await assert.rejects(codec.decodeDataset(oversized, f.manifest), /ukuran/);
  await f.load();
  const original = [...f.store.records.values()][0];
  const key = f.store.keys.get(f.scope);
  const record = await codec.sealSnapshot(
    original.id,
    original.binding,
    key,
    oversized,
  );
  await assert.rejects(
    codec.openSnapshot(record, record.binding, key),
    /too large/,
  );
});

test("unavailable storage and quota errors use verified network data in memory, never plaintext persistence", async () => {
  for (const boundary of ["begin", "write"]) {
    const f = await fixture();
    f.store[boundary] = async () => {
      throw new DOMException("Storage denied", "QuotaExceededError");
    };
    assert.deepEqual(await f.load(), f.data);
    assert.equal(f.store.records.size, 0);
    assert.equal((await f.cache.stats(f.scope)).available, false);
  }
});

test("logout/clear cancels an in-flight download and cannot resurrect data or keys", async () => {
  const f = await fixture();
  let release, started;
  const downloading = new Promise((resolve) => {
    started = resolve;
  });
  const pending = f.cache.load(
    f.scope,
    f.manifest,
    () => {
      started();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    new AbortController().signal,
  );
  await downloading;
  await f.cache.clear();
  release(f.text);
  await assert.rejects(pending, /changed/);
  assert.equal(f.store.records.size, 0);
  assert.equal(f.store.keys.size, 0);
});

test("clear during key creation cannot recreate even an empty key after logout", async () => {
  const f = await fixture();
  let release;
  const begin = f.store.begin.bind(f.store);
  f.store.begin = async (...args) => {
    await new Promise((resolve) => {
      release = resolve;
    });
    return begin(...args);
  };
  const pending = f.load();
  while (!release) await new Promise(setImmediate);
  await f.cache.clear();
  release();
  await assert.rejects(pending, /changed/);
  assert.equal(f.requests(), 0);
  assert.equal(f.store.keys.size, 0);
});

test("an epoch change in another tab prevents a late encrypted write", async () => {
  const f = await fixture();
  await f.load();
  const record = [...f.store.records.values()][0];
  const epoch = f.store.epoch;
  await f.store.clear();
  await f.store.write(epoch, record);
  assert.equal(f.store.records.size, 0);
});

test("online denial/offline manifest checks stop before any cache read; identity changes cannot return data", async () => {
  const f = await fixture();
  let cacheReads = 0,
    revision = 1;
  const api = {
    me: async () => ({ id: "owner-a" }),
    getDatasetManifest: async () => f.manifest,
    getDatasetContentText: f.fetchText,
  };
  const session = {
    getIdentityRevision: () => revision,
    getToken: () => "synthetic",
    getApiOrigin: () => "https://api.test",
    getInstallationId: () => "installation-a",
  };
  const bridge = moduleFrom("analysis/screener-dataset", {
    "@/api/client": { api, session, ApiError: Error },
    "../data/historical-cache": {
      historicalScope,
      historicalCache: {
        load: async () => {
          cacheReads++;
          return f.data;
        },
      },
    },
  });
  for (const message of [
    "401 expired",
    "403 entitlement",
    "404 snapshot",
    "offline",
  ]) {
    api.getDatasetManifest = async () => {
      throw Error(message);
    };
    await assert.rejects(
      bridge.loadScreenerDataset(f.manifest, new AbortController().signal),
      new RegExp(message),
    );
  }
  assert.equal(cacheReads, 0);
  api.getDatasetManifest = async () => {
    revision++;
    return f.manifest;
  };
  await assert.rejects(
    bridge.loadScreenerDataset(f.manifest, new AbortController().signal),
    /Akun berubah/,
  );
  assert.equal(cacheReads, 0);
  api.getDatasetManifest = async () => f.manifest;
  assert.deepEqual(
    await bridge.loadScreenerDataset(f.manifest, new AbortController().signal),
    f.data,
  );
  assert.equal(cacheReads, 1);
});
