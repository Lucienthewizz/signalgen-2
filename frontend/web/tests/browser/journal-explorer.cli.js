// Synthetic archive only; never contact a real provider or account.
async (page) => {
  const origin = new URL(page.url()).origin;
  const user = {
    id: "11111111-1111-4111-8111-111111111119",
    full_name: "Journal QA",
    email: "journal@example.test",
    role: "user",
    status: "active",
  };
  const items = Array.from({ length: 31 }, (_, i) => ({
    id: `qa-${i}`,
    version: 1,
    bytes: 1000,
    data: {
      schema_version: "screening-journal-1",
      source: "screening",
      symbol: i === 0 ? "AAPL" : i === 2 ? "QA01.JK" : `QA${String(i).padStart(2, "0")}.JK`,
      market: i === 0 ? "US" : "IDX",
      currency: i === 0 ? "USD" : "IDR",
      rule_id: i === 0 ? "sell-rule" : "buy-rule",
      rule_name: i === 0 ? "=SELL example" : "Momentum confirmation",
      definition_hash: "qa-hash",
      timeframe: "1d",
      candle_at: "2026-11-09T09:00:00Z",
      screened_at: i === 0 ? "2026-11-09T12:00:00Z" : i === 2 ? "2026-11-10T01:00:00Z" : "2026-11-09T17:00:00Z",
      signal_type: i === 0 ? "SELL" : "BUY",
      matched: true,
      price: i === 2 ? 110 : 100,
      features: {
        price: 100,
        rsi14: 55,
        ema9: 99,
        ema20: 98,
        values: { ATR14: 2 },
      },
      reason_codes: ["RULE_MATCHED"],
      dataset_checksum: "qa-checksum",
    },
  }));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    sessionStorage.setItem("signalgen.access-token", "synthetic-journal-token");
    sessionStorage.setItem("signalgen.app-session", "synthetic-session");
    sessionStorage.setItem("signalgen.app-session-origin", "same-origin");
  });
  await page.route("**/*", (route) => {
    const req = route.request(),
      u = new URL(req.url()),
      p = u.pathname;
    if (u.origin !== origin) return route.abort();
    if (!p.startsWith("/api") && p !== "/ready") return route.continue();
    if (!["GET", "OPTIONS"].includes(req.method()))
      throw Error("Read-only explorer attempted a write");
    const body =
      p === "/api/auth/me"
        ? user
        : p === "/api/v1/account/me"
          ? { user, features: ["screener"], session: { id: "qa" } }
          : p === "/api" || p === "/ready"
            ? { status: "ready", version: "test" }
            : p === "/api/v1/journal/screenings"
              ? { schema_version: "screening-journal-1", items }
              : p === "/api/v1/subscription"
                ? { subscription: null }
                : { items: [] };
    return route.fulfill({ json: body });
  });
  await page.goto(origin + "/#app/journal");
  await page.reload();
  await page
    .getByRole("heading", { name: "Saved screening results", exact: true })
    .waitFor();
  await page.locator(".journal-ledger tbody tr").first().waitFor();
  const rows = page.locator(".journal-ledger tbody tr");
  if ((await rows.count()) !== 25) throw Error("Initial page is not bounded");
  const chart = page.getByRole("region", { name: "Screening price history", exact: true });
  await chart.waitFor();
  await chart.getByRole("combobox", {name: "Chart stock", exact: true}).click();
  await page.getByRole("option", {name: "AAPL · US", exact: true}).click();
  if (await chart.locator(".journal-price-chart__point").count() !== 1 || await chart.locator("polyline").count()) throw Error("Single snapshot should show one real price point");
  await chart.getByRole("combobox", {name: "Chart stock", exact: true}).click();
  await page.getByRole("option", {name: "QA01 · IDX", exact: true}).click();
  if (await chart.locator(".journal-price-chart__point").count() !== 2 || await chart.locator("polyline").count() !== 1) throw Error("Stock price chart did not connect its saved snapshots");
  await chart.locator(".journal-price-chart__point").first().click();
  if (!(await chart.getByLabel("Selected screening price").innerText()).includes("IDR 100")) throw Error("Selected point does not show the saved price");
  await chart.locator(".journal-price-chart__point").last().focus();
  await page.keyboard.press("Enter");
  if (!(await chart.getByLabel("Selected screening price").innerText()).includes("IDR 110")) throw Error("Keyboard point selection failed");
  await chart.getByRole("combobox", {name: "Chart stock", exact: true}).click();
  await page.getByRole("option", {name: "AAPL · US", exact: true}).click();
  await chart.getByRole("button", {name: "Filter selected date", exact: true}).click();
  if ((await rows.count()) !== 1 || !await rows.first().innerText().then(text => text.includes("AAPL"))) throw Error("Chart date selection did not filter journal");
  if (await page.locator("#journal-from").inputValue() !== "2026-11-09" || await page.locator("#journal-to").inputValue() !== "2026-11-09") throw Error("Chart date filter did not use SGT date");
  await page.getByRole("button", {name: "Clear filters", exact: true}).click();
  await page.getByRole("button", { name: "Next results", exact: true }).click();
  if ((await rows.count()) !== 6) throw Error("Next page incorrect");
  await page.locator("#journal-search").fill("AAPL");
  if ((await rows.count()) !== 1) throw Error("Search did not reset paging");
  const details = page.getByRole("button", {
    name: "View AAPL details",
    exact: true,
  });
  await details.click();
  const panel = page.getByRole("region", {
    name: "Screening snapshot details",
    exact: true,
  });
  await panel.waitFor();
  if (
    !(await panel.innerText()).includes("55") ||
    !(await panel.innerText()).includes("ATR14")
  )
    throw Error("Stored indicators missing");
  await panel
    .getByText("Snapshot verification metadata", { exact: true })
    .click();
  await panel.getByText("qa-checksum", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  if (!(await details.evaluate((el) => document.activeElement === el)))
    throw Error("Detail close lost keyboard focus");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export filtered CSV", exact: true })
    .click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream) csv += chunk.toString();
  if (
    !csv.includes("AAPL") ||
    csv.includes("QA01.JK") ||
    !csv.includes("'=SELL example") ||
    !csv.includes("Screening snapshot")
  )
    throw Error("CSV was unfiltered or formula unsafe");
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  async function select(id, label) {
    await page.locator("#journal-" + id).click();
    await page.getByRole("option", { name: label, exact: true }).click();
  }
  await select("signal", "SELL");
  if ((await rows.count()) !== 1) throw Error("Signal filter incorrect");
  await select("market", "IDX · IDR");
  await page
    .getByText("No results match these filters", { exact: true })
    .waitFor();
  if (
    !(await page
      .getByRole("button", { name: "Export filtered CSV", exact: true })
      .isDisabled())
  )
    throw Error("Empty export allowed");
  await page
    .getByRole("button", { name: "Reset journal filters", exact: true })
    .click();
  await page.locator("#journal-from").fill("2026-11-10");
  await page.locator("#journal-from").press("Tab");
  await page
    .getByText(
      "30 of 31 saved results · date filters use screening time in SGT",
      { exact: true },
    )
    .waitFor();
  await select("rule", "Momentum confirmation");
  await select("sort", "Stock symbol");
  if (!(await rows.first().innerText()).includes("QA01"))
    throw Error("Symbol sorting incorrect");
  for (const width of [1440, 390, 320])
    for (const theme of ["dark", "light"]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.addStyleTag({
        content:
          "*,*::before,*::after{transition:none!important;animation:none!important;}",
      });
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.classList.toggle("dark", theme === "dark");
      }, theme);
      await page.locator("#journal-search").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `output/playwright/journal-explorer-${width}-${theme}.png`,
        fullPage: true,
      });
      const calendarControl = page.locator(".signalgen-date-control").filter({ has: page.locator("#journal-from") });
      await calendarControl.getByRole("button", { name: "Open calendar", exact: true }).click();
      const calendar = page.getByRole("dialog", { name: "Choose date", exact: true });
      await calendar.waitFor();
      const calendarBox = await calendar.boundingBox();
      if (!calendarBox || calendarBox.width > 318 || calendarBox.x < 0 || calendarBox.x + calendarBox.width > width + 1) throw Error("Calendar is too wide or clipped");
      const month = calendar.getByRole("combobox", { name: "Choose the Month", exact: true });
      const year = calendar.getByRole("combobox", { name: "Choose the Year", exact: true });
      if (await month.evaluate(el => parseFloat(getComputedStyle(el).fontSize)) > 14) throw Error("Calendar month label is oversized");
      await month.click();
      const options = page.getByRole("listbox");
      await options.waitFor();
      const popup = page.locator(".calendar-caption-options");
      const dropdownBox = await popup.boundingBox();
      if (!dropdownBox || dropdownBox.height > 170) throw Error("Calendar dropdown obscures too many date rows");
      await page.screenshot({ path: `output/playwright/calendar-month-${width}-${theme}.png` });
      await page.getByRole("option", { name: "January", exact: true }).click();
      await year.click();
      await page.getByRole("option", { name: "2025", exact: true }).click();
      if (await page.locator("#journal-from").inputValue() !== "2026-11-10") throw Error("Browsing calendar months changed the filter date");
      await page.keyboard.press("Escape");
      await calendar.waitFor({state: "hidden"});
      if (
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        )
      )
        throw Error("Journal document overflow");
    }
  await page.locator("#journal-from").fill("");
  await page.locator("#journal-from").press("Tab");
  await page.locator("#journal-search").fill("does-not-exist");
  await page
    .getByText("No results match these filters", { exact: true })
    .waitFor();
  if (errors.length) throw Error(errors.join("; "));
  await page.evaluate(() =>
    document.body.setAttribute(
      "data-signalgen-journal-explorer-tests",
      "complete",
    ),
  );
};
