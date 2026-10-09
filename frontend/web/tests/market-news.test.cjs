const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const path = require("node:path");
function news(fetch, clock = Date) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs
        .readFileSync(path.join(__dirname, "../src/lib/market-news.ts"), "utf8")
        .replace(/import\.meta\.env\.VITE_API_ORIGIN/g, '""'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText,
    { exports, URL, URLSearchParams, fetch, Date: clock, Set },
  );
  return exports;
}
test("news normalizes metadata, rejects unsafe links and removes duplicates", () => {
  const n = news();
  const items = n.parseMarketNews({
    articles: [
      {
        title: "IHSG",
        url: "https://example.org/stock",
        published_at: "2026-10-07T12:00:00Z",
      },
      { title: "Duplicate", url: "https://example.org/stock" },
      { title: "Bad", url: "javascript:alert(1)" },
      { title: "Credentials", url: "https://user:secret@example.org/" },
      null,
    ],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].source, "example.org");
  assert.equal(items[0].indexedAt, "2026-10-07T12:00:00Z");
  assert.throws(
    () => n.parseMarketNews({ error: "provider failure" }),
    /Format/,
  );
});
test("news caches successful responses and sends no account credentials", async () => {
  let count = 0;
  const n = news(async (url, options) => {
    count++;
    assert.equal(options.credentials, "omit");
    assert.equal(url, "/api/news");
    return { ok: true, status: 200, json: async () => ({ articles: [] }) };
  });
  await n.fetchMarketNews(new AbortController().signal);
  await n.fetchMarketNews(new AbortController().signal);
  assert.equal(count, 1);
});
test("news rate-limit cooldown prevents immediate repeated provider requests", async () => {
  let count = 0;
  const n = news(async () => {
    count++;
    return { ok: false, status: 429 };
  });
  await assert.rejects(
    n.fetchMarketNews(new AbortController().signal),
    /satu menit/,
  );
  await assert.rejects(
    n.fetchMarketNews(new AbortController().signal),
    /satu menit/,
  );
  assert.equal(count, 1);
});
test("network failures are readable and do not repeatedly call the provider", async () => {
  let count = 0;
  const n = news(async () => {
    count++;
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(
    n.fetchMarketNews(new AbortController().signal),
    /Koneksi ke sumber/,
  );
  await assert.rejects(
    n.fetchMarketNews(new AbortController().signal),
    /satu menit/,
  );
  assert.equal(count, 1);
});
test("a forced refresh preserves cached real headlines on network failure", async () => {
  let count = 0;
  const n = news(async () => {
    count++;
    if (count > 1) throw new TypeError("offline");
    return {
      ok: true,
      json: async () => ({
        articles: [
          { title: "IHSG", url: "https://www.antaranews.com/berita/1/ihsg" },
        ],
      }),
    };
  });
  await n.fetchMarketNews(new AbortController().signal);
  const stale = await n.fetchMarketNews(new AbortController().signal, true);
  assert.equal(stale.items[0].title, "IHSG");
  assert.match(stale.warning, /Daftar terakhir/);
  await n.fetchMarketNews(new AbortController().signal, true);
  assert.equal(count, 2);
});
test("abort does not cause cooldown or replace a valid cache", async () => {
  let count = 0;
  const n = news(async () => {
    count++;
    if (count === 1) throw new Error("aborted");
    return { ok: true, json: async () => ({ articles: [] }) };
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(n.fetchMarketNews(controller.signal), /aborted/);
  await n.fetchMarketNews(new AbortController().signal);
  assert.equal(count, 2);
});
test("cache expires after one day and server stale metadata is explicit", async () => {
  let now = Date.now();
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  const n = news(
    async () => ({
      ok: true,
      json: async () => ({
        articles: [
          { title: "IHSG", url: "https://www.antaranews.com/berita/1/ihsg" },
        ],
        fetched_at: new Date(now - 600_000).toISOString(),
        stale: true,
      }),
    }),
    Clock,
  );
  const result = await n.fetchMarketNews(new AbortController().signal);
  assert.match(result.warning, /Daftar terakhir/);
  assert.equal(n.getCachedMarketNews().items.length, 1);
  now += 86_400_001;
  assert.equal(n.getCachedMarketNews(), null);
});
