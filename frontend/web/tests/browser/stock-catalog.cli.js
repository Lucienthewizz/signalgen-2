// Run with playwright-cli run-code on an isolated browser session.
// This tests the real component against a clearly labelled synthetic UI fixture.
async (page) => {
  await page.goto("http://127.0.0.1:5175/tests/browser/stock-catalog.fixture.html");
  await page.getByText("962 saham tersedia", { exact: false }).waitFor();
  const search = page.getByRole("searchbox", { name: "Cari kode atau nama perusahaan" });
  const choices = page.locator(".instrument-choices button");
  if (await choices.count() !== 12) throw Error("Unbounded catalog DOM");
  await search.fill("Astra");
  await page.getByRole("button", { name: /ASII Astra/ }).click();
  await search.fill("bank");
  await page.getByRole("button", { name: /BBCA Bank Central/ }).click();
  await page.getByRole("button", { name: /BBRI Bank Rakyat/ }).click();
  await search.fill("");
  if (await page.locator('.instrument-choices button:not([aria-pressed="true"]):enabled').count() !== 0) throw Error("Selection limit not enforced");
  await page.getByRole("button", { name: "Halaman saham berikutnya" }).click();
  if (await page.getByLabel("Saham yang dipilih").getByRole("button").count() !== 3) throw Error("Selection lost across pages");
  await page.getByRole("button", { name: "Hapus ASII dari pilihan" }).click();
  if (await page.locator(".instrument-choices button:enabled").count() !== 12) throw Error("Deselect did not unlock choices");
  await search.fill("no-such-company");
  await page.getByText(/Tidak ada saham untuk/).waitFor();
  await search.fill("ASII");
  if (await choices.count() !== 1) throw Error("Search did not reset pagination");
  await page.getByRole("button", { name: "Toggle loading" }).click();
  if (await search.isEnabled()) throw Error("Loading search is not disabled");
  await page.getByRole("button", { name: "Toggle loading" }).click();
  await page.getByRole("button", { name: "Toggle empty" }).click();
  await page.getByText(/Katalog belum tersedia/).waitFor();
  await page.getByRole("button", { name: "Toggle empty" }).click();
  await search.fill("");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (let theme = 0; theme < 2; theme++) {
      await page.getByRole("button", { name: "Ganti tema" }).click();
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error(`Overflow ${width}`);
      await page.screenshot({ path: `output/playwright/idx-catalog-${width}-${theme}.png`, fullPage: true });
    }
  }
  console.log("PASS: search, bounded DOM, 3 selections, paging, deselect, empty/loading, 1440/390px and both themes. Synthetic fixture only.");
}
