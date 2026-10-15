// playwright-cli run-code --filename tests/browser/historical-cache.cli.js
// Uses a separate browser context: no real account/provider/database changes.
async (page) => {
  await page.unrouteAll({ behavior: "wait" });
  let denied = false,
    owner = "synthetic-owner-a",
    contentRequests = 0,
    manifestRequests = 0;
  const fixtures = Object.fromEntries(
    [3, 10].map((count) => {
      const symbols = Array.from(
        { length: count },
        (_, i) => ["BBCA.JK", "BBRI.JK", "TLKM.JK"][i] ?? `FIXTURE${i}.JK`,
      );
      const data = {
        schema_version: "ohlcv-multi-1",
        purpose: "screen",
        market: "IDX",
        currency: "IDR",
        timeframe: "1d",
        timezone: "UTC",
        adjustment: "none",
        series: symbols.map((symbol) => ({
          symbol,
          timezone: "UTC",
          candles: Array.from({ length: 100 }, (_, i) => ({
            timestamp: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
            open: 100 + i,
            high: 103 + i,
            low: 99 + i,
            close: 102 + i,
            volume: 1000 + i,
          })),
        })),
      };
      const text = JSON.stringify(data, null, 2);
      const manifest = {
        ...data,
        series: undefined,
        dataset_id: `fixture-${count}`,
        version: "v1",
        symbols,
        candle_count: count * 100,
        decoded_bytes: text.length,
        checksum: "",
        expires_at: new Date(Date.now() + 600_000).toISOString(),
      };
      return [count, { data, text, manifest }];
    }),
  );
  await page.route("**/fixture-manifest-*", (route) =>
    route.fulfill({
      json: fixtures[Number(route.request().url().split("-").at(-1))].manifest,
    }),
  );
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/auth/me"))
      return route.fulfill({
        json: { id: owner, email: "fixture@example.test" },
      });
    const count = Number(pathname.match(/fixture-(\d+)/)?.[1]);
    if (pathname.endsWith("/content")) {
      contentRequests++;
      return route.fulfill({
        body: fixtures[count].text,
        contentType: "application/json",
      });
    }
    if (pathname.includes("/datasets/")) {
      manifestRequests++;
      return route.fulfill(
        denied
          ? { status: 403, json: { error: { code: "ENTITLEMENT_REQUIRED" } } }
          : { json: fixtures[count].manifest },
      );
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(
    "http://127.0.0.1:5175/tests/browser/historical-cache.fixture.html",
  );
  for (const fixture of Object.values(fixtures)) {
    fixture.manifest.checksum = await page.evaluate(async (text) => {
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return "sha256:" + Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
    }, fixture.text);
  }
  await page.getByRole("button", { name: "Run 3", exact: true }).click();
  await page
    .getByLabel("Hasil fixture")
    .filter({ hasText: /3 saham.*client Go/ })
    .waitFor();
  await page.getByText(/1 snapshot.*ciphertext/).waitFor();
  const first = await page.getByLabel("Hasil fixture").textContent();
  await page.getByRole("button", { name: "Run 3", exact: true }).click();
  await page
    .getByRole("button", { name: "Run 3", exact: true })
    .waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("button")?.disabled);
  if (
    (await page.getByLabel("Hasil fixture").textContent()) !== first ||
    contentRequests !== 1 ||
    manifestRequests !== 2
  )
    throw Error("Cache hit changed compute or skipped online check");

  // Native IndexedDB persistence + real CryptoKey structured clone, never simulated.
  const inspect = () =>
    page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("signalgen-historical-cache-v1", 1);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        const tx = db.transaction(["keys", "snapshots"], "readonly");
        const read = (store) =>
          new Promise((resolve) => {
            const r = tx.objectStore(store).getAll();
            r.onsuccess = () => resolve(r.result);
          });
        const [keys, rows] = await Promise.all([
          read("keys"),
          read("snapshots"),
        ]);
        let exportBlocked = true;
        if (keys[0]) {
          try {
            await crypto.subtle.exportKey("raw", keys[0]);
            exportBlocked = false;
          } catch {}
        }
        return {
          keys: keys.length,
          rows: rows.length,
          exportBlocked,
          extractable: keys[0]?.extractable,
          ciphertextOnly: rows.every(
            (r) =>
              r.ciphertext instanceof ArrayBuffer &&
              !new TextDecoder().decode(r.ciphertext).includes('"candles"') &&
              !("series" in r),
          ),
        };
      } finally {
        db.close();
      }
    });
  const stored = await inspect();
  if (
    stored.keys !== 1 ||
    stored.rows !== 1 ||
    stored.extractable ||
    !stored.exportBlocked ||
    !stored.ciphertextOnly
  )
    throw Error("Plaintext/key persistence boundary failed");
  await page.reload();
  await page.getByRole("button", { name: "Run 3", exact: true }).click();
  await page
    .getByLabel("Hasil fixture")
    .filter({ hasText: /3 saham.*client Go/ })
    .waitFor();
  if (contentRequests !== 1)
    throw Error("Encrypted cache/key did not survive page reload");

  denied = true;
  await page.getByRole("button", { name: "Run 3", exact: true }).click();
  await page
    .getByLabel("Hasil fixture")
    .filter({ hasText: /belum memiliki akses/ })
    .waitFor();
  if (contentRequests !== 1) throw Error("Denied cache hit downloaded content");
  denied = false;
  await page.getByRole("button", { name: "Run 10", exact: true }).click();
  await page
    .getByLabel("Hasil fixture")
    .filter({ hasText: /10 saham.*client Go/ })
    .waitFor();
  await page.getByText(/2 snapshot.*ciphertext/).waitFor();

  // Same-user/installation but different verified owner must NOT reuse data.
  owner = "synthetic-owner-b";
  await page.getByRole("button", { name: "Run 3", exact: true }).click();
  await page
    .getByLabel("Hasil fixture")
    .filter({ hasText: /3 saham.*client Go/ })
    .waitFor();
  if (contentRequests !== 3) throw Error("Cross-user cache reused");

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (let theme = 0; theme < 2; theme++) {
      await page.getByRole("button", { name: "Ganti tema" }).click();
      if (
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        )
      )
        throw Error("Cache panel overflow");
      await page.screenshot({
        path: `output/playwright/encrypted-cache-${width}-${theme}.png`,
        fullPage: true,
      });
    }
  }
  await page.getByRole("button", { name: "Hapus cache" }).click();
  await page.getByText(/snapshot dan kunci lokal sudah dihapus/).waitFor();
  let empty = await inspect();
  if (empty.rows || empty.keys)
    throw Error("Clear button did not remove keys AND snapshots");
  await page.getByRole("button", { name: "Run 3", exact: true }).click();
  await page
    .getByLabel("Hasil fixture")
    .filter({ hasText: /3 saham.*client Go/ })
    .waitFor();
  const otherTab = await page.context().newPage();
  await otherTab.goto("http://127.0.0.1:5175/tests/browser/stock-catalog.fixture.html");
  await otherTab.evaluate(async () => {
    const { startHistoricalCacheLifecycle } = await import("/src/data/historical-lifecycle.ts");
    startHistoricalCacheLifecycle();
    document.body.dataset.cacheResets = "0";
    window.addEventListener("signalgen:historical-cache-reset", () => {
      document.body.dataset.cacheResets = String(Number(document.body.dataset.cacheResets) + 1);
    });
  });
  await page.getByRole("button", { name: "Logout fixture" }).click();
  await otherTab.waitForFunction(() => Number(document.body.dataset.cacheResets) > 0);
  await otherTab.close();
  await page.waitForFunction(async () => {
    const { historicalCache } = await import("/src/data/historical-cache.ts");
    await historicalCache.stats("unused");
    return true;
  });
  empty = await inspect();
  if (empty.rows || empty.keys)
    throw Error("Logout did not remove keys AND snapshots");
  const storageChecks = await page.evaluate(async () => {
    const { IndexedHistoricalStore } = await import("/src/data/historical-store.ts");
    const store = new IndexedHistoricalStore();
    await store.clear();
    const lease = await store.begin("synthetic-store-scope", () => true);
    const record = { id: "", scope: "synthetic-store-scope", format: "ohlcv-gzip-aes256gcm-1", iv: new Uint8Array(12),
      ciphertext: new ArrayBuffer(16), createdAt: Date.now(), binding: { expiresAt: Date.now() + 60000 } };
    for (let i = 0; i < 35; i++) await store.write(lease.epoch, { ...record, id: `entry-${i}` });
    if ((await store.stats(record.scope)).entries !== 32) throw Error("Entry quota not enforced");
    await store.clear();
    const fresh = await store.begin(record.scope, () => true);
    for (let i = 0; i < 18; i++) await store.write(fresh.epoch, { ...record, id: `large-${i}`, ciphertext: new ArrayBuffer(1024 * 1024) });
    const large = await store.stats(record.scope);
    if (large.bytes > 16 * 1024 * 1024 || large.entries > 16) throw Error("Byte quota not enforced");
    await store.write(fresh.epoch, { ...record, id: "expired", binding: { expiresAt: Date.now() - 1 } });
    await store.stats(record.scope);
    if (await store.read("expired")) throw Error("Expired record was not pruned");
    await store.clear();
    await store.write(fresh.epoch, { ...record, id: "stale" });
    if (await store.read("stale")) throw Error("Cross-tab stale write resurrected data");
    try { await store.begin(record.scope, () => false); throw Error("Inactive key creation succeeded"); }
    catch (error) { if (error.message === "Inactive key creation succeeded") throw error; }
    await store.clear();
    document.body.dataset.cacheTests = "passed";
    return { entries: 32, byteLimit: 16777216, expiryPruned: true, staleWriteRejected: true, crossTabReset: true };
  });
  console.log("CACHE_STORAGE_CHECKS=" + JSON.stringify(storageChecks));
  console.log(
    "PASS: native IndexedDB/Web Crypto gzip+AES-256-GCM, non-exportable key, reload hit, per-run online denial, user isolation, 3/10 actual Go/WASM compute, real clear/logout, 390/1440px light/dark. Synthetic API only.",
  );
}
