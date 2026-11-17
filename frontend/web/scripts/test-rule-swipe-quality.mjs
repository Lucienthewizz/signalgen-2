import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
const origin = process.env.SIGNALGEN_TEST_BASE_URL || "http://127.0.0.1:5174";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.SIGNALGEN_TEST_BROWSER_EXECUTABLE
    ? { executablePath: process.env.SIGNALGEN_TEST_BROWSER_EXECUTABLE }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1218, height: 852 },
    hasTouch: true,
  });
  await page.goto(origin + "/#home");
  const source = readFileSync(
    new URL("../tests/browser/workspace-regression.cli.js", import.meta.url),
    "utf8",
  );
  const boundary = source.indexOf("  // Keep unrelated GETs unresolved:");
  if (boundary < 0) throw Error("Fixture boundary missing");
  mkdirSync("/tmp/signalgen-swipe-quality", { recursive: true });
  const scenario =
    source.slice(0, boundary) +
    `
  const other={...rule,id:'second-swipe-rule',name:'Second saved rule'};
  await page.route('**/api/v1/rules',route=>route.fulfill({json:{items:[rule,other,{...rule,id:'system-swipe-rule',name:'System rule',owner_type:'system',read_only:true}]}}));
  run.manifest.timeframe='5m';
  run.manifest.quality.warnings=[
    'Yahoo Finance data; unofficial source for academic MVP use',
    'BBCA.JK: 5m regular-session closed candles; requested 3 calendar days; 52 null and 0 unfinished/out-of-session rows excluded',
    'BBRI.JK: 5m regular-session closed candles; requested 3 calendar days; 51 null and 2 unfinished/out-of-session rows excluded',
    'BBRI.JK: 2 gap(s) require review; no candles fabricated',
    'Future provider note: retained in full',
  ];
  await page.reload();
  await page.goto(origin+'/#app/rules');
  const row=page.getByRole('group',{name:rule.name,exact:true});
  const otherRow=page.getByRole('group',{name:other.name,exact:true});
  await row.waitFor();
  if(await page.getByRole('button',{name:'Edit '+rule.name,exact:true}).count())throw Error('Edit visible before swipe');
  if(await page.getByRole('button',{name:'Delete '+rule.name,exact:true}).count())throw Error('Delete visible before swipe');
  if(await page.locator('.rule-library__rows article').filter({hasText:'System rule'}).locator('.swipe-row').count())throw Error('System rule exposes swipe actions');
  for(const width of [1218,390]){
    await page.setViewportSize({width,height:852});
    for(const motion of ['no-preference','reduce']){
      await page.emulateMedia({reducedMotion:motion});
      await row.scrollIntoViewIfNeeded();
      const surface=row.locator('.swipe-row__surface');
      const box=await surface.boundingBox();
      await page.mouse.move(box.x+box.width*.85,box.y+box.height/2);
      await page.mouse.down();
      await page.mouse.move(box.x+12,box.y+box.height/2,{steps:12});
      await page.mouse.up();
      await row.getByRole('button',{name:'Delete '+rule.name,exact:true}).waitFor();
      if(ruleDeletes)throw Error('Full swipe deleted without confirmation');
      const actionSizes=await row.locator('.swipe-row__action').evaluateAll(nodes=>nodes.map(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height})));
      if(actionSizes.some(box=>box.w!==48||box.h!==48))throw Error('Swipe actions must remain 48px squares '+JSON.stringify(actionSizes));
      await row.screenshot({path:'/tmp/signalgen-swipe-quality/rule-open-'+width+'-'+motion+'.png'});
      await row.getByRole('button',{name:'Delete '+rule.name,exact:true}).click();
      const confirm=page.getByRole('alertdialog',{name:'Delete this rule?',exact:true});
      await confirm.waitFor();
      if(ruleDeletes)throw Error('Opening confirmation mutated rules');
      await confirm.getByRole('button',{name:'Cancel',exact:true}).click();
      if(ruleDeletes)throw Error('Cancel deleted a rule');
      const toggle=row.getByRole('button',{name:'Actions for '+rule.name,exact:true});
      await toggle.focus();await toggle.press('ArrowLeft');
      await otherRow.getByRole('button',{name:'Actions for '+other.name,exact:true}).focus();
      await page.keyboard.press('Enter');
      if(await row.getByRole('button',{name:'Edit '+rule.name,exact:true}).count())throw Error('Multiple swipe drawers remained open');
      await page.keyboard.press('Escape');
      await toggle.focus();await toggle.press('ArrowLeft');
      await page.keyboard.press('Tab');
      if(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label'))!=='Edit '+rule.name)throw Error('Tab does not reach Edit after revealing row');
      await page.keyboard.press('Enter');
      const dialog=page.getByRole('dialog',{name:'Edit rules',exact:true});await dialog.waitFor();
      if(await dialog.getByLabel('Rule name',{exact:true}).inputValue()!==rule.name)throw Error('Swipe edit loaded wrong rule');
      await page.keyboard.press('Escape');
      await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Actions for Rule fixture');
      await page.mouse.move(0,0);
      await row.screenshot({path:'/tmp/signalgen-swipe-quality/rule-closed-'+width+'-'+motion+'.png'});
    }
  }
  // Trusted touch events exercise horizontal disclosure and native vertical scrolling.
  await page.setViewportSize({width:390,height:852});
  await row.scrollIntoViewIfNeeded();
  await page.locator('.signalgen-confirm__backdrop').waitFor({state:'detached'});
  const cdp=await page.context().newCDPSession(page);
  const touch=async(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y}]});
  let box=await row.boundingBox();
  await touch('touchStart',box.x+box.width-24,box.y+24);
  for(let d=20;d<=160;d+=20)await touch('touchMove',box.x+box.width-24-d,box.y+24);
  await touch('touchEnd');
  await row.getByRole('button',{name:'Edit '+rule.name,exact:true}).waitFor();
  await row.getByRole('button',{name:'Actions for '+rule.name,exact:true}).focus();await page.keyboard.press('Escape');
  box=await row.boundingBox();
  const beforeScroll=await page.evaluate(()=>scrollY);
  await touch('touchStart',box.x+box.width/2,box.y+60);
  for(let d=10;d<=80;d+=10)await touch('touchMove',box.x+box.width/2,box.y+60-d);
  await touch('touchEnd');
  if(await row.getByRole('button',{name:'Edit '+rule.name,exact:true}).count())throw Error('Vertical touch scroll opened swipe actions');
  if(await page.evaluate(()=>scrollY)<=beforeScroll)throw Error('Swipe row blocked vertical touch scrolling');
  await cdp.detach();
  await page.goto(origin+'/#app/analysis');
  await page.getByRole('button',{name:/View data quality/}).click();
  const quality=page.getByRole('dialog',{name:'Data quality',exact:true});
  await quality.waitFor();
  for(const width of [1218,390]){
    await page.setViewportSize({width,height:852});
    const table=quality.getByRole('table',{name:'BBCA.JK data quality',exact:true});await table.waitFor();
    if(!(await table.innerText()).includes('52')||!(await table.innerText()).includes('3 calendar days'))throw Error('BBCA quality fields missing');
    const second=quality.getByRole('table',{name:'BBRI.JK data quality',exact:true});
    if(!(await second.innerText()).includes('51')||!(await second.innerText()).includes('2 gap(s) require review; no candles fabricated'))throw Error('BBRI data or fallback note lost');
    if(!(await quality.innerText()).includes('Future provider note: retained in full'))throw Error('Unclassified provider note lost');
    if(!await quality.evaluate(el=>el.scrollWidth<=el.clientWidth+1&&[...el.querySelectorAll('table')].every(t=>t.scrollWidth<=t.clientWidth+1)))throw Error('Quality tables overflow at '+width);
    await table.scrollIntoViewIfNeeded();
    await quality.screenshot({path:'/tmp/signalgen-swipe-quality/quality-'+width+'.png'});
    await table.screenshot({path:'/tmp/signalgen-swipe-quality/quality-stock-'+width+'.png'});
  }
  await page.keyboard.press('Escape');
  const heading=await page.locator('.screener-results thead th').first().evaluate(el=>({weight:getComputedStyle(el).fontWeight,color:getComputedStyle(el).color}));
  if(heading.weight!=='700'||heading.color!=='rgb(241, 243, 242)')throw Error('Screener header not white and bold '+JSON.stringify(heading));
  if(errors.length)throw Error(errors.join('\\n'));
  console.log('PASS: hidden swipe actions, mouse/touch/keyboard disclosure, one drawer, edit and focus restoration, protected delete/cancel, system rules read-only, vertical scrolling, reduced motion; per-stock quality tables and unknown notes preserved; 1218/390px. Synthetic fixtures only.');
}`;
  await eval("(" + scenario + ")")(page);
} finally {
  await browser.close();
}
