async (page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("http://127.0.0.1:5174/#app/subscription");
  await page
    .getByRole("heading", { name: "Pilihan paket", exact: true })
    .waitFor();
  await page.getByText("10 rule pribadi", { exact: true }).waitFor();
  await page.getByText("50 rule pribadi", { exact: true }).waitFor();
  const capacities = await page.locator(".plan-capacity").allTextContents();
  if (
    !capacities.some(
      (text) =>
        text.includes("10 rule pribadi") && text.includes("5 stock universe"),
    )
  )
    throw new Error("Analyst capacity missing");
  if (
    !capacities.some(
      (text) =>
        text.includes("50 rule pribadi") && text.includes("20 stock universe"),
    )
  )
    throw new Error("Pro capacity missing");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const closeMenu = page.getByRole("button", { name: "Close menu", includeHidden: true });
    const closeBounds = await closeMenu.count() ? await closeMenu.boundingBox() : null;
    if (closeBounds && closeBounds.x >= 0 && closeBounds.x + closeBounds.width <= width)
      await closeMenu.click({ timeout: 5000 });
    const theme = page.getByRole("button", { name: /Switch to .* mode/ });
    for (let variant = 0; variant < 1; variant++) {
      if(await theme.count()) throw Error("Theme toggle must be hidden in dark-only mode");
      await page.locator(".plan-columns").screenshot({ animations: "disabled", path: `.playwright-cli/pro-quotas-${width}-${variant}.png` });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      if (overflow) throw new Error(`Horizontal overflow at ${width}px`);
      const cardsOutsideViewport = await page.locator('.plan-columns').evaluate(el => el.getBoundingClientRect().right > innerWidth + 1);
      if (cardsOutsideViewport) throw new Error(`Plan cards outside viewport at ${width}px`);
    }
  }
  console.log(
    "PASS: Analyst 10/5, Pro 50/20; desktop/mobile; dark theme; no horizontal page overflow.",
  );
}
