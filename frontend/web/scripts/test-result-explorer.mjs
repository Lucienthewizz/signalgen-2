// Isolated synthetic accounts/API; real React, Go/WASM and IndexedDB.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origin = process.env.SIGNALGEN_TEST_BASE_URL || "http://127.0.0.1:5174";
const output =
  process.env.SIGNALGEN_TEST_OUTPUT || "/tmp/signalgen-result-explorer";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
const shared = String.raw`
 const explorer = page.getByRole('region', {name:'Result insights and tools'});
 async function inspect(width, study=false) {
  await explorer.waitFor();
  await explorer.locator('summary').click();
  if(study) {
   await explorer.getByRole('button',{name:'Load all saved signals',exact:true}).click();
   await explorer.getByText('Page 1 of 2 · 92 records',{exact:true}).waitFor();
  }
  const tiles = explorer.locator('.result-explorer__heatmap button');
  if(!await tiles.count())throw Error('Missing heatmap');
  const tile=tiles.first();await tile.click();
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  await dialog.getByText(study?'Reference close':'Entry fee',{exact:true}).waitFor();
  if(!await dialog.locator('dd').filter({hasText:'SGT'}).count())throw Error('SGT detail timestamps missing');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  if(!await tile.evaluate(el=>el===document.activeElement))throw Error('Dialog lost trigger focus');
  if(study){
   const tones=await tiles.evaluateAll(els=>els.map(el=>el.dataset.valueTone));
   if(!tones.includes('positive')||!tones.includes('negative'))throw Error('Signed heatmap values missing');
   await explorer.getByRole('button',{name:'Next tiles',exact:true}).click();
   if(await tiles.count()!==32)throw Error('Heatmap pagination lost records');
   await explorer.getByRole('button',{name:'Previous tiles',exact:true}).click();
  }
  await explorer.getByRole('button',{name:'By stock',exact:true}).click();
  const target=study?'study-result-stocks':'bt-result-stocks';
  if(await page.evaluate(()=>document.activeElement.id)!==target)throw Error('Section navigation did not move focus');
  if(study&&!await page.locator('#study-result-stocks').evaluate(el=>el.open))throw Error('Navigation left section collapsed');
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Page overflow at '+width);
  await explorer.screenshot({path:output+'/'+(study?'study':'portfolio')+'-'+width+'.png'});
  const pending=page.waitForEvent('popup');
  await explorer.getByRole('button',{name:'Export PDF',exact:true}).click();
  const report=await pending;await report.locator('#print-report').waitFor();
  if(study&&await report.locator('tbody tr').count()!==92)throw Error('Report omitted paginated records');
  if(!await report.locator('svg polyline').count())throw Error('Report chart missing');
  await report.pdf({path:output+'/'+(study?'study':'portfolio')+'-'+width+'.pdf',format:'A4',printBackground:true});
  await report.close();
  console.log('PASS',study?'study':'portfolio',width,'insights, heatmap, keyboard, details, full PDF report');
 }
`;
try {
  for (const name of ["backtest", "signal-study"]) {
    const page = await browser.newPage({
      viewport: { width: 1218, height: 852 },
      reducedMotion: "reduce",
    });
    await page.goto(origin + "/#home");
    let source = readFileSync(
      path.join(root, "tests/browser/" + name + ".cli.js"),
      "utf8",
    );
    const marker =
      name === "backtest"
        ? "  for (const width of [1440, 390])"
        : " // Empty configuration layout";
    const boundary = source.indexOf(marker);
    if (boundary < 0) throw Error("Fixture setup marker missing");
    source = source
      .slice(0, boundary)
      .replace("close:101+i,volume:1000", "close:101+i+(i%2?8:-8),volume:1000");
    const tail =
      name === "backtest"
        ? String.raw`
   for(const width of [1218,1456,390]){
    await page.setViewportSize({width,height:852});mode='healthy';await ready();await dates();
    await page.getByRole('button',{name:'Run backtest',exact:true}).click();await result();await inspect(width);
   }
   mode='no-signals';await ready();await dates();await page.getByRole('button',{name:'Run backtest',exact:true}).click();await result();
   await explorer.locator('summary').click();await explorer.getByText('No records in this scope.',{exact:true}).waitFor();
   console.log('PASS portfolio empty results');
  `
        : String.raw`
   async function configure(){
    await page.goto(origin+'/#app/backtest');await page.reload();
    await page.getByLabel('Stock source',{exact:true}).selectOption('US');
    await page.getByLabel('Screening rule',{exact:true}).selectOption('qa-rule');
    await page.getByLabel('From (daily session, SGT)',{exact:true}).fill('2026-01-20');
    await page.getByLabel('To (inclusive, SGT)',{exact:true}).fill('2026-01-23');
   }
   partial=false;
   for(const width of [1218,1456,390]){
    await page.setViewportSize({width,height:852});await configure();
    await page.getByRole('button',{name:'Start signal study',exact:true}).click();
    await page.getByText('Completed the frozen catalog. Review data-quality limits before interpreting results.',{exact:true}).waitFor({timeout:60000});
    await explorer.locator('[data-coverage="Complete"]').waitFor();await inspect(width,true);
   }
   await page.evaluate(async owner => (await import('/src/analysis/signal-study-storage.ts')).clearStudyOwner(owner), user.id);
   await explorer.getByRole('button',{name:'Export PDF',exact:true}).click();
   await explorer.getByRole('alert').filter({hasText:'Local signal details are incomplete'}).waitFor();
   console.log('PASS missing local data cannot produce a complete report');
   partial=false;await configure();await page.getByLabel('Trading candles after signal',{exact:false}).fill('100');
   await page.getByRole('button',{name:'Start signal study',exact:true}).click();
   await explorer.locator('[data-coverage="Partial"]').waitFor({timeout:60000});
   if(!await explorer.getByRole('status').textContent().then(t=>t.includes('signals lack future data')))throw Error('Missing future-data coverage');
   console.log('PASS missing future data coverage');
   partial=true;await configure();await page.getByRole('button',{name:'Start signal study',exact:true}).click();
   await explorer.locator('[data-coverage="Partial"]').waitFor({timeout:60000});
   if(!await explorer.getByRole('status').textContent().then(t=>t.includes('1 failed')))throw Error('Missing failed-stock coverage');
   console.log('PASS partial coverage');
   partial=false;hold=true;await configure();
   const waiting=new Promise(r=>entered=r);
   await page.getByRole('button',{name:'Start signal study',exact:true}).click();await waiting;
   await explorer.locator('[data-coverage="Processing"]').waitFor();
   if(!await explorer.getByRole('button',{name:'Export PDF',exact:true}).isDisabled())throw Error('Processing export enabled');
   await page.getByRole('button',{name:'Stop study',exact:true}).click();release?.();hold=false;
   await explorer.locator('[data-coverage="Stopped"]').waitFor();console.log('PASS processing and stopped coverage');
  `;
    await eval(
      "(" +
        source +
        shared +
        tail +
        "if(errors.length)throw Error(JSON.stringify(errors));})",
    )(page);
    await page.close();
  }
} finally {
  await browser.close();
}
