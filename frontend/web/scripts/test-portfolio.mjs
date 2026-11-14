import { chromium } from "playwright";
const baseURL = process.env.SIGNALGEN_TEST_BASE_URL || "http://127.0.0.1:5174",
  origin = new URL(baseURL).origin;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.SIGNALGEN_TEST_BROWSER_EXECUTABLE
    ? { executablePath: process.env.SIGNALGEN_TEST_BROWSER_EXECUTABLE }
    : {}),
});
const user = {
  id: "11111111-1111-4111-8111-111111111119",
  full_name: "Portfolio QA",
  email: "portfolio@example.test",
  role: "user",
  status: "active",
};
const snapshot = {
  id: "snapshot-1",
  version: 1,
  data: {
    schema_version: "screening-journal-1",
    source: "screening",
    symbol: "BBCA.JK",
    market: "IDX",
    currency: "IDR",
    rule_id: "qa-rule",
    rule_name: "Portfolio QA rule",
    definition_hash: "qa",
    timeframe: "1d",
    candle_at: "2026-11-09T01:00:00Z",
    screened_at: "2026-11-09T02:00:00Z",
    signal_type: "BUY",
    matched: true,
    price: 100,
    features: { price: 100, rsi14: 55, ema9: 99, ema20: 98, values: {} },
    reason_codes: ["RULE_MATCHED"],
    dataset_checksum: "qa",
  },
};
let items = [],
  accountB = false,
  writes = 0;
const summary = () => ({
  schema_version: "portfolio-ledger-1",
  cost_policy: "weighted-average-fees-1",
  transaction_count: accountB ? 0 : items.length,
  positions: [],
  totals:
    accountB || !items.length
      ? []
      : [
          {
            book: "Testing",
            market: "IDX",
            currency: "IDR",
            cost_basis: items.length === 1 ? "10010" : "0",
            realized_pnl:
              items.length === 1 ? "0" : items[1].version > 1 ? "2980" : "1980",
            fees: items.length === 1 ? "10" : "20",
          },
        ],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => {
    if (location.hostname !== "127.0.0.1") return;
    sessionStorage.setItem(
      "signalgen.access-token",
      "synthetic-portfolio-token",
    );
    sessionStorage.setItem("signalgen.app-session", "synthetic-session");
    sessionStorage.setItem("signalgen.app-session-origin", "same-origin");
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    const req = route.request(),
      u = new URL(req.url()),
      p = u.pathname;
    if (u.origin !== origin) return route.abort();
    if (!p.startsWith("/api") && p !== "/ready") return route.continue();
    if (p.startsWith("/api/v1/journal/trades"))
      throw Error("Retired trade API must not be called");
    if (
      req.method() === "PUT" &&
      p.startsWith("/api/v1/portfolio/transactions/")
    ) {
      const body = req.postDataJSON();
      if (
        typeof body.data.quantity !== "string" ||
        "net_pl" in body.data ||
        "user_id" in body.data
      )
        throw Error("Invalid transaction payload");
      const id = p.split("/").at(-1),
        old = items.find((t) => t.id === id);
      if ((old?.version ?? 0) !== body.version)
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: "VERSION_CONFLICT",
              message: "Reload before editing",
            },
          },
        });
      const tx = { id, version: body.version + 1, data: body.data };
      items = items.filter((t) => t.id !== id).concat(tx);
      writes++;
      return route.fulfill({ json: tx });
    }
    if (!["GET", "OPTIONS"].includes(req.method()))
      throw Error("Unexpected API mutation " + p);
    let body = { items: [] };
    if (p === "/api/auth/me")
      body = accountB
        ? {
            ...user,
            id: "22222222-2222-4222-8222-222222222222",
            full_name: "Other account",
          }
        : user;
    else if (p === "/api/v1/account/me")
      body = { user, features: ["screener"], session: { id: "qa" } };
    else if (p === "/api" || p === "/ready")
      body = { status: "ready", version: "test" };
    else if (p === "/api/v1/journal/screenings")
      body = {
        schema_version: "screening-journal-1",
        items: accountB ? [] : [snapshot],
      };
    else if (p === "/api/v1/portfolio") body = summary();
    else if (p === "/api/v1/portfolio/transactions")
      body = {
        schema_version: "portfolio-ledger-1",
        items: accountB ? [] : items,
      };
    else if (p === "/api/v1/subscription") body = { subscription: null };
    return route.fulfill({ json: body });
  });
  await page.goto(baseURL + "/#app/journal");
  await page
    .getByRole("button", { name: "Preview test data", exact: true })
    .click();
  const example = page.getByLabel("Portfolio chart example", { exact: true });
  await example.getByText("IDR 60,000", { exact: true }).waitFor();
  if ((await example.locator(".journal-chart-point").count()) !== 4)
    throw Error("Expected start plus three completed example trades");
  if (writes !== 0 || items.length !== 0)
    throw Error("Chart preview wrote account data");
  for (const width of [1440, 1218, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width > 860) {
      const edges = await page
        .locator(".journal-bento .magic-bento__card")
        .evaluateAll((nodes) => [
          nodes[0].getBoundingClientRect().bottom,
          nodes.at(-1).getBoundingClientRect().bottom,
        ]);
      if (Math.abs(edges[0] - edges[1]) > 2)
        throw Error(
          `Portfolio does not align with Most used rule at ${width}: ${edges}`,
        );
    }
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      )
    )
      throw Error("Preview overflow at " + width);
    await example.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `/tmp/signalgen-journal-example-${width}.png`,
      fullPage: true,
    });
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.screenshot({
    path: "/tmp/signalgen-journal-example-light.png",
    fullPage: true,
  });
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    )
  )
    throw Error("Light preview overflow");
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await example.getByRole("button", { name: /^Trade 3 / }).click();
  await example
    .getByRole("region", { name: "Selected trade details", exact: true })
    .getByText(/TLKM/)
    .waitFor();
  const point = example.getByRole("button", { name: /^Trade 3 / });
  await point.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await example
    .getByRole("region", { name: "Selected trade details", exact: true })
    .getByText(/BBCA/)
    .waitFor();
  await page.setViewportSize({ width: 1218, height: 1000 });
  const detailEdges = await page
    .locator(".journal-bento .magic-bento__card")
    .evaluateAll((nodes) => [
      nodes[0].getBoundingClientRect().bottom,
      nodes.at(-1).getBoundingClientRect().bottom,
    ]);
  if (Math.abs(detailEdges[0] - detailEdges[1]) > 2)
    throw Error("Expanded chart details break the card alignment");
  await page
    .getByRole("button", { name: "Show my portfolio", exact: true })
    .click();
  await page.getByText("No realized P&L yet", { exact: true }).waitFor();
  if (writes !== 0 || items.length !== 0)
    throw Error("Example records leaked into the account ledger");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const emptyEdges = await page
    .locator(".journal-bento .magic-bento__card")
    .evaluateAll((nodes) => [
      nodes[0].getBoundingClientRect().bottom,
      nodes.at(-1).getBoundingClientRect().bottom,
    ]);
  if (Math.abs(emptyEdges[0] - emptyEdges[1]) > 2)
    throw Error("Empty portfolio does not extend to Most used rule");

  await page
    .getByRole("button", { name: "Record BBCA trade", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Record BBCA trade", exact: true })
    .click();
  const form = page.getByRole("dialog", {
    name: "Record transaction",
    exact: true,
  });
  await form.waitFor();
  if ((await form.locator("#portfolio-price").inputValue()) !== "100")
    throw Error("Screening price was not used as a draft");
  const fill = async (price, time) => {
    await form.locator("#portfolio-price").fill(price);
    await form.locator("#portfolio-fee").fill("10");
    await form.locator("#portfolio-book").fill("Testing");
    await form.locator("#portfolio-date").fill("2026-11-09");
    await form.locator("#portfolio-date").press("Tab");
    await form.locator("#portfolio-time").fill(time);
  };
  await fill("100", "10:00:00");
  await form
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await form.waitFor({ state: "hidden" });
  await page.getByText("No realized P&L yet", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Record BBCA trade", exact: true })
    .click();
  await form
    .getByRole("combobox", { name: "Transaction side", exact: true })
    .click();
  await page
    .getByRole("option", { name: "SELL · close shares", exact: true })
    .click();
  await fill("120", "10:01:00");
  await form
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await form.waitFor({ state: "hidden" });
  await page
    .locator(".journal-portfolio__value")
    .filter({ hasText: "1,980.00" })
    .waitFor();
  if (writes !== 2 || items[0].data.executed_at !== "2026-11-09T02:00:00.000Z")
    throw Error("Trade save count or SGT timestamp is wrong");
  if ((await page.locator(".journal-pnl-chart polyline").count()) !== 1)
    throw Error("Realized portfolio chart is missing");
  await page.reload();
  await page
    .locator(".journal-portfolio__value")
    .filter({ hasText: "1,980.00" })
    .waitFor();
  // Filter on sale month after reconciling all earlier purchases.
  await page.getByRole("button", { name: "All months", exact: true }).click();
  await page.getByRole("button", { name: "October 2026", exact: true }).click();
  await page.getByText("No realized P&L yet", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Oct 2026", exact: true }).click();
  await page
    .getByRole("button", { name: "November 2026", exact: true })
    .click();
  await page
    .locator(".journal-portfolio__value")
    .filter({ hasText: "1,980.00" })
    .waitFor();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "Export transactions CSV", exact: true })
      .click(),
  ]);
  if (download.suggestedFilename() !== "portfolio-transactions-IDX-2026-11.csv")
    throw Error("Portfolio CSV scope missing");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator(".journal-portfolio").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/signalgen-portfolio-${width}.png` });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      )
    )
      throw Error("Portfolio layout overflow");
  }
  await page
    .getByRole("button", { name: "Transactions (2)", exact: true })
    .click();
  const ledger = page.getByRole("dialog", {
    name: "Recorded transactions",
    exact: true,
  });
  await ledger
    .getByRole("button", { name: "Edit BBCA SELL", exact: true })
    .click();
  const edit = page.getByRole("dialog", {
    name: "Edit transaction",
    exact: true,
  });
  await edit.locator("#portfolio-price").fill("130");
  await edit
    .getByRole("button", { name: "Save transaction", exact: true })
    .click();
  await edit.waitFor({ state: "hidden" });
  await page
    .locator(".journal-portfolio__value")
    .filter({ hasText: "2,980.00" })
    .waitFor();
  await page.goto(baseURL + "/#app/overview");
  await page
    .getByRole("region", { name: "Realized portfolio P&L", exact: true })
    .getByText("IDR 2,980.00", { exact: true })
    .waitFor();
  await page
    .getByText(/^Updated /)
    .filter({ has: page.locator("time") })
    .waitFor();
  const amountFont = await page
    .locator(".overview-portfolio__totals strong > span")
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  if (amountFont < 24)
    throw Error("Animated P&L lost the financial value type scale");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const resources = page.getByRole("region", {
      name: "Workspace overview",
      exact: true,
    });
    const cards = await resources
      .locator(".feature-gallery__item")
      .evaluateAll((nodes) =>
        nodes.map((el) => el.getBoundingClientRect().height),
      );
    if (cards.length !== 4 || cards.some((h) => h < 200 || h > 280))
      throw Error("Dashboard resource card sizes changed");
    if (
      !(await resources
        .locator(".overview-resources__value span")
        .evaluateAll((nodes) =>
          nodes.every((el) => parseFloat(getComputedStyle(el).fontSize) >= 24),
        ))
    )
      throw Error("CountUp lost the resource value type scale");
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      )
    )
      throw Error("Dashboard overflow");
    await resources.screenshot({
      path: `/tmp/signalgen-dashboard-bento-final-${width}.png`,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "/tmp/signalgen-overview-portfolio-final.png",
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.reload();
  await page
    .locator(".overview-portfolio__totals")
    .getByText("IDR 2,980.00", { exact: true })
    .waitFor();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(baseURL + "/#app/news");
  await page.locator(".news-video__poster").waitFor();
  if (await page.locator(".news-video iframe").count())
    throw Error("Video loaded before interaction");
  await page.locator(".news-video__poster").click();
  await page.locator(".news-video iframe").waitFor();
  await page.goto(baseURL + "/#home");
  if (await page.locator(".landing-header__session").count())
    throw Error("Dashboard still appears outside the account dropdown");
  await page
    .getByRole("button", { name: "Open Portfolio QA menu", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Dashboard", exact: true }).click();
  await page.waitForURL((url) => url.hash === "#app/overview");
  accountB = true;
  await page.goto(baseURL + "/#app/journal");
  await page.reload();
  await page.getByText("No realized P&L yet", { exact: true }).waitFor();
  if (
    await page
      .locator(".journal-portfolio__value")
      .innerText()
      .then((t) => t.includes("2,980"))
  )
    throw Error("Portfolio leaked between accounts");
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "PASS: read-only 3-trade preview, keyboard chart selection, aligned cards at 1440/1218px, mobile/light layout, zero preview writes; BUY/SELL, fees, SGT, monthly CSV, reload/edit/dashboard/account isolation. Synthetic API only.",
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await browser.close();
}
