import { chromium } from "playwright";
// Synthetic public plans; external providers and account writes are blocked.
const baseURL = process.env.SIGNALGEN_TEST_BASE_URL || "http://127.0.0.1:5174";
const origin = new URL(baseURL).origin;
const executablePath = process.env.SIGNALGEN_TEST_BROWSER_EXECUTABLE;
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const context = await browser.newContext({
    viewport: { width: 1456, height: 853 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== origin) return route.abort();
    if (u.pathname === "/api/v1/subscription/plans")
      return route.fulfill({
        json: {
          items: ["free", "analyst", "pro"].map((code, i) => ({
            code,
            name: ["Free", "Analyst", "Pro"][i],
            description: "Screening and historical analysis",
            pricing: { amount: [0, 49000, 99000][i] },
            features: i ? ["screener", "backtest"] : [],
            limits: {
              custom_rules: [0, 10, 50][i],
              stock_universes: [1, 5, 20][i],
            },
          })),
        },
      });
    if (u.pathname.startsWith("/api")) return route.fulfill({ json: {} });
    return route.continue();
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(baseURL + "/#home");
  await page.locator(".ghost-fibers-canvas").waitFor();
  await page.locator(".gradient-ascii-canvas").waitFor();
  await page.waitForTimeout(2500);
  if (await page.locator(".hero-data-note").count())
    throw Error("Local preview label remains");
  if (!(await page.locator(".market-hero h2 .shiny-text").count()))
    throw Error("Shiny headline is missing");
  if (await page.locator(".market-hero__chart, .signal-lattice").count())
    throw Error("Old landing chart remains");
  if (await page.locator("#pricing .pixel-card").count())
    throw Error("Pixel pricing styling must be removed");
  if ((await page.locator(".feature-figure__art").count()) !== 4)
    throw Error("Original feature artwork must be restored");
  if ((await page.locator(".pricing-plan").count()) !== 3)
    throw Error("Pricing must contain three original cards");
  for (const width of [1456, 390]) {
    await page.setViewportSize({ width, height: 853 });
    await page.locator(".market-hero").scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".market-hero__copy"))
          .opacity === "1",
    );
    const copy = await page.locator(".market-hero__copy").boundingBox();
    if (!copy || copy.width > width)
      throw Error("Hero copy does not fit the viewport");
    await page.screenshot({
      path: `/tmp/signalgen-landing-effects-${width}.png`,
    });
    await page.locator("#pricing").scrollIntoViewIfNeeded();
    await page.locator(".pricing-plan").first().hover();
    await page.waitForTimeout(700);
    await page.screenshot({
      path: `/tmp/signalgen-pricing-effects-${width}.png`,
    });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      )
    )
      throw Error("Landing overflow " + width);
  }
  await page.setViewportSize({ width: 1456, height: 853 });
  await page.locator(".feature-gallery").scrollIntoViewIfNeeded();
  await page.locator(".feature-gallery__item").first().hover();
  await page.waitForTimeout(700);
  await page.screenshot({ path: "/tmp/signalgen-feature-instruments.png" });
  console.log(
    "background canvases",
    await page.locator(".landing-background canvas").evaluateAll((xs) =>
      xs.map((x) => ({
        width: x.width,
        height: x.height,
        gl: !!x.getContext("webgl2"),
      })),
    ),
  );
  await page.locator(".landing-footer").scrollIntoViewIfNeeded();
  const bounds = await page.evaluate(() => ({
    flow: document
      .querySelector(".landing-product-flow")
      .getBoundingClientRect().bottom,
    footer: document.querySelector(".landing-footer").getBoundingClientRect()
      .bottom,
  }));
  if (bounds.flow < bounds.footer - 1)
    throw Error("Background ends before the footer");
  const before = await page.locator(".gradient-ascii-canvas").screenshot();
  await page.waitForTimeout(1000);
  const after = await page.locator(".gradient-ascii-canvas").screenshot();
  if (before.equals(after))
    throw Error("ASCII background is static when motion is enabled");
  await page.screenshot({ path: "/tmp/signalgen-footer-background.png" });
  await page.locator("#reviews").scrollIntoViewIfNeeded();
  if (!(await page.locator("#reviews .pixel-card").count()))
    throw Error("Testimonial pixel cards are missing");
  await page.screenshot({ path: "/tmp/signalgen-testimonial-pixels.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.waitForTimeout(500);
  await page.locator(".market-hero").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/signalgen-landing-effects-light.png" });
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "PASS: landing effects, pricing, features, mobile and reduced motion/light rendering",
  );
} finally {
  await browser.close();
}
