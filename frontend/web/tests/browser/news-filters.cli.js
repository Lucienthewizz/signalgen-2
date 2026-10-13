async (page) => {
  // Isolated public-news fixtures; no account credentials or provider writes.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/news", route => route.fulfill({
    json: { articles: [
      { title: "BBCA membagikan dividen", url: "https://example.org/bbca" },
      { title: "Bank Central Asia melaporkan laba", url: "https://example.org/bca" },
      { title: "Telkom memperluas jaringan", url: "https://example.org/telkom" },
    ] },
  }));
  await page.goto("http://127.0.0.1:5174/#app/news");
  await page.getByLabel("Cari berita", { exact: true }).waitFor({ timeout: 10000 });
  await page.getByRole("link", { name: "BBCA membagikan dividen" }).waitFor({ timeout: 10000 });
  await page.getByLabel("Saham watchlist", { exact: true }).click({ timeout: 5000 });
  await page.getByRole("option", { name: "BBCA", exact: true }).click({ timeout: 5000 });
  if (await page.locator(".news-feed li").count() !== 2) throw Error("Ticker filter failed");
  await page.getByLabel("Cari berita", { exact: true }).fill("laba");
  if (await page.locator(".news-feed li").count() !== 1) throw Error("Combined search failed");
  await page.getByLabel("Cari berita", { exact: true }).fill("tidak ditemukan");
  await page.getByText("Tidak ada judul yang cocok", { exact: true }).waitFor({ timeout: 5000 });
  await page.getByRole("button", { name: "Reset filter" }).click({ timeout: 5000 });
  if (await page.locator(".news-feed li").count() !== 3) throw Error("Reset failed");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const close = page.getByRole("button", { name: "Close menu" });
    const bounds = await close.boundingBox();
    if (bounds && bounds.x >= 0 && bounds.x + bounds.width <= width) await close.click({ timeout: 5000 });
    for (let theme = 0; theme < 2; theme++) {
      await page.getByRole("button", { name: /Switch to .* mode/ }).click({ timeout: 5000 });
      await page.locator(".news-feed").screenshot({ path: `/private/tmp/signalgen-news-${width}-${theme}.png`, animations: "disabled", timeout: 5000 });
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error("News page overflow");
    }
  }
}
