// Isolated fixture only. No real authentication, stock data, or account writes.
async (page) => {
  await page.goto(
    "http://127.0.0.1:5174/tests/browser/stock-catalog.fixture.html",
  );
  await page.getByText("962 stocks available", { exact: false }).waitFor();
  const search = page.getByRole("searchbox", { name: "Search stocks" });
  const choices = page.locator(".stock-catalog-picker__table button");
  const categories = page.getByRole("group", { name: "Stock categories" });
  if ((await choices.count()) !== 12) throw Error("Unbounded catalog DOM");
  await categories.getByRole("button", { name: "Banks", exact: true }).click();
  if ((await choices.count()) !== 2) throw Error("Banks category not applied");
  await page.getByRole("button", { name: /Add BBCA Bank Central/ }).click();
  await categories
    .getByRole("button", { name: "Blue chip", exact: true })
    .click();
  if ((await choices.count()) !== 3)
    throw Error("Blue chip category not applied");
  await search.fill("Astra");
  await page.getByRole("button", { name: /Add ASII Astra/ }).click();
  await search.fill("bank");
  await page.getByRole("button", { name: /Add BBRI Bank Rakyat/ }).click();
  if (
    (await page.getByLabel("Selected stocks").getByRole("button").count()) !== 3
  )
    throw Error("Selection lost across categories");
  await categories.getByRole("button", { name: "Energy", exact: true }).click();
  await page.getByText("No matching stocks", { exact: true }).waitFor();
  await categories
    .getByRole("button", { name: "All stocks", exact: true })
    .click();
  for (let i = 0; i < 7; i++) {
    await search.fill(`FIXTURE${i}.JK`);
    await choices.first().click();
  }
  await search.fill("");
  if (
    (await page
      .locator(
        '.stock-catalog-picker__table button:not([aria-pressed="true"]):enabled',
      )
      .count()) !== 0
  )
    throw Error("Selection limit not enforced");
  await page.getByRole("button", { name: "Next stock page" }).click();
  if (
    (await page.getByLabel("Selected stocks").getByRole("button").count()) !==
    10
  )
    throw Error("Selection lost across pages");
  await page
    .getByRole("button", { name: "Remove ASII from selection" })
    .click();
  if ((await choices.filter({ visible: true }).count()) !== 12)
    throw Error("Catalog not paginated");
  if (
    (await page
      .locator(".stock-catalog-picker__table button:enabled")
      .count()) !== 12
  )
    throw Error("Deselect did not unlock choices");
  await search.fill("no-such-company");
  await page.getByText("No matching stocks", { exact: true }).waitFor();
  await search.fill("ASII");
  if ((await choices.count()) !== 1)
    throw Error("Search did not reset pagination");
  await choices.first().focus();
  await page.keyboard.press("Enter");
  if (
    (await page.getByLabel("Selected stocks").getByRole("button").count()) !==
    10
  )
    throw Error("Keyboard selection failed");
  await page.getByRole("button", { name: "Toggle loading" }).click();
  if (await search.isEnabled()) throw Error("Loading search is not disabled");
  if (
    !(await page.getByRole("button", { name: "Next stock page" }).isDisabled())
  )
    throw Error("Loading paging is not disabled");
  await page.getByRole("button", { name: "Toggle loading" }).click();
  await page.getByRole("button", { name: "Toggle empty" }).click();
  await page.getByText("Catalog unavailable", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Toggle empty" }).click();
  await search.fill("");
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (let theme = 0; theme < 2; theme++) {
      await page.getByRole("button", { name: "Toggle theme" }).click();
      if (
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        )
      )
        throw Error(`Overflow ${width}`);
      const round = await page
        .locator(".stock-catalog-picker__table")
        .evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
      if (round < 12) throw Error("Table rounded container missing");
      await page.screenshot({
        path: `/private/tmp/signalgen-idx-catalog-${width}-${theme}.png`,
        fullPage: true,
      });
    }
  }
  await page.evaluate(() =>
    document.body.setAttribute("data-signalgen-catalog-tests", "complete"),
  );
  console.log(
    "PASS: categories, search, bounded DOM, 10 selections, limit, paging, keyboard, empty/loading, 1440/900/390px and both themes.",
  );
}
