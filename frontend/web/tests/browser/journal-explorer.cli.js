// Synthetic journal and portfolio API; no real account writes.
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
  const trades = [];
  let allowTradeWrites = false;
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
    if (allowTradeWrites && p.startsWith("/api/v1/portfolio/transactions/") && req.method() === "PUT") {
      const { version, data } = req.postDataJSON();
      const id = p.split("/").at(-1);
      if (version !== 0 || trades.some((trade) => trade.id === id))
        throw Error("New transaction is duplicated or has an invalid version");
      const trade = { id, version: 1, data };
      trades.push(trade);
      return route.fulfill({ json: trade, status: 201 });
    }
    if (!["GET", "OPTIONS"].includes(req.method()))
      throw Error("Read-only explorer attempted a write");
    if (p === "/api/v1/portfolio/transactions")
      return route.fulfill({ json: { items: trades } });
    const body =
      p === "/api/auth/me"
        ? user
        : p === "/api/v1/account/me"
          ? { user, features: ["screener"], session: { id: "qa" } }
          : p === "/api" || p === "/ready"
            ? { status: "ready", version: "test" }
            : p === "/api/v1/portfolio"
              ? {
                  transaction_count: trades.length,
                  positions: [],
                  totals: trades.length === 2 ? [
                    { market: "IDX", currency: "IDR", book: "Screening journal", cost_basis: "0", realized_pnl: "985", fees: "15" },
                  ] : [],
                }
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
    .getByRole("heading", { name: "Screening journal", exact: true })
    .waitFor();
  await page.locator(".journal-ledger tbody tr").first().waitFor();
  const rows = page.locator(".journal-ledger tbody tr");
  if ((await rows.count()) !== 25) throw Error("Initial page is not bounded");
  await page.getByRole("region", {name:"Portfolio performance",exact:true}).waitFor();
  if(await page.locator(".journal-bento .magic-bento__card").count()!==6)throw Error("Missing portfolio bento cards");
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
      await page.locator(".journal-bento").scrollIntoViewIfNeeded();
      const clipped = await page.locator(".journal-bento .magic-bento__card").evaluateAll(cards => cards.some(card => card.scrollHeight > card.clientHeight + 2 || card.scrollWidth > card.clientWidth + 2));
      if (clipped) throw Error(`Bento content clipped at ${width}px in ${theme}`);
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

  allowTradeWrites = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#journal-search").fill("QA03");
  await page.getByRole("button", { name: "Record QA03 trade", exact: true }).click();
  const tradeForm = page.getByRole("dialog", { name: "Record transaction", exact: true });
  await tradeForm.waitFor();
  const field = (label) => tradeForm.getByLabel(label, { exact: true });
  if ((await field("Stock symbol").inputValue()) !== "QA03.JK" ||
      (await field("Executed price (IDR)").inputValue()) !== "100" ||
      trades.length) throw Error("Screening trade did not open a prefilled draft");
  await tradeForm.getByRole("button", { name: "Cancel", exact: true }).click();
  await tradeForm.waitFor({ state: "hidden" });
  if (trades.length) throw Error("Cancel recorded a transaction");

  const portfolio = page.getByRole("region", { name: "Portfolio performance", exact: true });
  for (const [side, price, fee, date] of [
    ["BUY", "105", "10", "2026-11-10"],
    ["SELL", "115", "5", "2026-11-11"],
  ]) {
    await page.getByRole("button", { name: "Record QA03 trade", exact: true }).click();
    if (side === "SELL") {
      await tradeForm.getByRole("combobox", { name: "Transaction side", exact: true }).click();
      await page.getByRole("option", { name: "SELL · close shares", exact: true }).click();
    }
    await field("Executed price (IDR)").fill(price);
    await field("Fee (IDR)").fill(fee);
    await field("Execution date (SGT)").fill(date);
    await field("Execution time (SGT)").fill("10:00:00");
    await tradeForm.getByRole("button", { name: "Save transaction", exact: true }).click();
    await tradeForm.waitFor({ state: "hidden" });
    await portfolio.getByRole("button", { name: side === "BUY" ? "Transactions (1)" : "Transactions (2)", exact: true }).waitFor();
    const data = trades.at(-1)?.data;
    if (data?.symbol !== "QA03.JK" || data.side !== side || data.quantity !== "100" ||
        data.price !== price || data.fee !== fee || data.executed_at !== date + "T02:00:00.000Z")
      throw Error("Journal transaction request did not preserve execution values");
    if (side === "BUY") await portfolio.getByText("No realized P&L yet", { exact: true }).waitFor();
  }
  await portfolio.locator(".journal-portfolio__value").filter({ hasText: /985/ }).waitFor();
  await portfolio.getByRole("button", { name: /Trade 1.*QA03.*985/ }).waitFor();
  const tradeCsv = page.waitForEvent("download");
  await portfolio.getByRole("button", { name: "Export transactions CSV", exact: true }).click();
  let exported = "";
  for await (const chunk of await (await tradeCsv).createReadStream()) exported += chunk.toString();
  for (const side of ["BUY", "SELL"])
    if (!exported.includes(`"QA03.JK","IDX","IDR","Screening journal","${side}"`))
      throw Error("Trade CSV omitted the " + side + " transaction");
  if (errors.length) throw Error(errors.join("; "));
  await page.evaluate(() =>
    document.body.setAttribute(
      "data-signalgen-journal-explorer-tests",
      "complete",
    ),
  );
}
