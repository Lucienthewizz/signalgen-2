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
  await page.locator(".landing-background--gradient").waitFor();
  if (await page.locator(".gradient-ascii-canvas").count())
    throw Error("ASCII background remains after hero");
  await page.waitForTimeout(2500);
  if (await page.locator(".hero-data-note").count())
    throw Error("Local preview label remains");
  if (!(await page.locator(".market-hero h2 .shiny-text").count()))
    throw Error("Shiny headline is missing");
  const verify = page.locator(".market-hero h2 em .shiny-text");
  await verify.waitFor();
  const initialShine = await verify.evaluate((el) => el.style.backgroundImage);
  await page.waitForFunction(
    (previous) =>
      document.querySelector(".market-hero h2 em .shiny-text")?.style
        .backgroundImage !== previous,
    initialShine,
    { timeout: 6000 },
  );
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
  const gradient = await page
    .locator(".landing-background--gradient")
    .evaluate((el) => getComputedStyle(el).backgroundImage);
  if (
    !gradient.includes("linear-gradient") ||
    !gradient.includes("rgb(2, 11, 7)") ||
    !gradient.includes("rgb(6, 26, 17)") ||
    !gradient.includes("rgb(2, 8, 5)")
  )
    throw Error("Agreed forest gradient is missing");
  if ((await page.locator(".landing-background canvas").count()) !== 1)
    throw Error("Expected only the hero background canvas");
  await page.screenshot({ path: "/tmp/signalgen-footer-background.png" });
  await page.locator("#reviews").scrollIntoViewIfNeeded();
  if (!(await page.locator("#reviews .pixel-card").count()))
    throw Error("Testimonial pixel cards are missing");
  await page.locator("#reviews .testimonial-marquee").hover();
  const visibleIndex = await page
    .locator("#reviews .testimonial-pixels")
    .evaluateAll((nodes) =>
      nodes.findIndex((node) => {
        const r = node.getBoundingClientRect();
        return r.left > 40 && r.right < innerWidth - 40;
      }),
    );
  if (visibleIndex < 0) throw Error("No visible testimonial to hover");
  const card = page.locator("#reviews .testimonial-pixels").nth(visibleIndex);
  const pixelSizeBefore = await card
    .locator("canvas")
    .evaluate((el) => `${el.width}x${el.height}`);
  await card.hover();
  await page.waitForFunction((index) => {
    const el = document.querySelectorAll("#reviews .testimonial-pixels")[index];
    return new DOMMatrixReadOnly(getComputedStyle(el).transform).a > 1.03;
  }, visibleIndex);
  if (
    (await page
      .locator("#reviews .testimonial-pixels")
      .evaluateAll(
        (nodes) =>
          nodes.filter(
            (el) =>
              new DOMMatrixReadOnly(getComputedStyle(el).transform).a > 1.01,
          ).length,
      )) !== 1
  )
    throw Error("More than the hovered card was magnified");
  if (
    (await card
      .locator("canvas")
      .evaluate((el) => `${el.width}x${el.height}`)) !== pixelSizeBefore
  )
    throw Error("Hover zoom resized the pixel buffer");
  await page.screenshot({ path: "/tmp/signalgen-testimonial-pixels.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(
    (index) =>
      getComputedStyle(
        document.querySelectorAll("#reviews .testimonial-pixels")[index],
      ).transform === "none",
    visibleIndex,
  );
  if ((await card.evaluate((el) => getComputedStyle(el).transform)) !== "none")
    throw Error("Reduced motion still zooms testimonials");
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.waitForTimeout(500);
  await page.locator(".market-hero").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/signalgen-landing-effects-light.png" });
  for (const width of [1456, 390]) {
    await page.setViewportSize({ width, height: 853 });
    await page.goto(baseURL + "/#home");
    const workflow = page.getByRole("button", {
      name: "Explore the workflow",
      exact: true,
    });
    await workflow.click();
    await page.waitForURL((url) => url.hash === "#login");
    await page.goto(baseURL + "/#home");
    const demoLinks = page.getByRole("link", { name: "Demo", exact: true });
    if (
      (
        await demoLinks.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("href")),
        )
      ).some((href) => href !== "#login")
    )
      throw Error("Guest Demo link bypasses login");
    await page
      .locator(".landing-footer")
      .getByRole("link", { name: "Demo", exact: true })
      .click();
    await page.waitForURL((url) => url.hash === "#login");
    if (width === 1456) {
      await page.goto(baseURL + "/#home");
      await page
        .locator(".landing-header__nav")
        .getByRole("link", { name: "Demo", exact: true })
        .click();
      await page.waitForURL((url) => url.hash === "#login");
    }
  }
  if (errors.length) throw Error(errors.join("\n"));
  console.log(
    "PASS: landing effects, pricing, features, mobile, reduced motion/light rendering and guest workflow/Demo login routes",
  );
} finally {
  await browser.close();
}
