import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
const base = process.env.SIGNALGEN_TEST_BASE_URL || "http://127.0.0.1:5174";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.SIGNALGEN_TEST_BROWSER_EXECUTABLE
    ? { executablePath: process.env.SIGNALGEN_TEST_BROWSER_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto(base + "/#home");
  const fixture = readFileSync(
    new URL("../tests/browser/workspace-regression.cli.js", import.meta.url),
    "utf8",
  );
  const marker = fixture.indexOf("  // Keep unrelated GETs unresolved:");
  if (marker < 0) throw Error("Fixture boundary missing");
  mkdirSync("/tmp/signalgen-pen-qa", { recursive: true });
  const run =
    fixture.slice(0, marker) +
    `
 await page.route('**/api/v1/portfolio',route=>route.fulfill({json:{schema_version:'portfolio-ledger-1',cost_policy:'weighted-average-fees-1',transaction_count:0,positions:[],totals:[]}}));
 await page.route('**/api/v1/portfolio/transactions',route=>route.fulfill({json:{schema_version:'portfolio-ledger-1',items:[]}}));
 await page.reload();
 await page.goto(origin+'/#app/overview');
 await page.locator('.account-menu__trigger--sidebar').waitFor();
 for(const width of [1440,1218,390]) {
  await page.setViewportSize({width,height:1000});
  for(const view of ['overview','analysis','backtest','journal','rules','universes','realtime','news']) {
   await page.goto(origin+'/#app/'+view);
   await page.locator('.pen-workbench').waitFor();
   await page.locator('.route-loading').waitFor({state:'hidden'});
   await page.evaluate(async()=>{await document.fonts.ready; await document.fonts.load('600 16px "Saira"'); await document.fonts.load('400 13px "IBM Plex Mono"'); await document.fonts.load('400 13px "Inter Variable"');await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
   for(const theme of ['dark']) {
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    const check=await page.locator('.pen-workbench').evaluate(el=>({font:getComputedStyle(el).fontFamily,canvas:getComputedStyle(el).getPropertyValue('--canvas').trim(),overflow:document.documentElement.scrollWidth>innerWidth+1}));
    if(!check.font.includes('Inter Variable'))throw Error('Pen font not applied '+JSON.stringify({view,width,check}));
    if(theme==='dark'&&check.canvas!=='#090a0a')throw Error('Pen canvas token not applied '+view);
    if(check.overflow)throw Error('Page overflow '+view+' '+width+' '+theme);
    await page.screenshot({path:'/tmp/signalgen-pen-qa/'+view+'-'+width+'-'+theme+'.png',fullPage:true,animations:'disabled'});
   }
   await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  }
 }
 if(errors.length)throw Error(errors.join('\\n'));
 console.log('PASS: eight Pen workspace routes, 1440/1218/390px, dark-only, Inter font, canvas tokens, no overflow; synthetic account/API only.');
}`;
  const scenario = eval("(" + run + ")");
  await scenario(page);
} finally {
  await browser.close();
}
