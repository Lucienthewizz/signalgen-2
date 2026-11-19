import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
const origin = process.env.SIGNALGEN_TEST_BASE_URL || "http://127.0.0.1:5174";
const output = "/tmp/signalgen-mixed-rules";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1218, height: 852 },
  });
  await page.goto(origin + "/#home");
  const source = readFileSync(
    new URL("../tests/browser/workspace-regression.cli.js", import.meta.url),
    "utf8",
  );
  const boundary = source.indexOf("  // Keep unrelated GETs unresolved:");
  if (boundary < 0) throw Error("Fixture boundary missing");
  await eval(
    "(" +
      source.slice(0, boundary) +
      `
  let saved = null;
  definition.logic="OR";
  await page.route('**/api/v1/rules', async route=>{
    if(route.request().method()==='POST'){
      ruleWrite=route.request().postDataJSON();
      saved={...rule,id:'mixed-fixture',name:ruleWrite.definition.name,definition:ruleWrite.definition};
      return route.fulfill({json:saved});
    }
    return route.fulfill({json:{items:saved?[saved,rule]:[rule]}});
  });
  await page.route('**/api/v1/rules/mixed-fixture',route=>route.fulfill({json:saved}));
  await page.reload();await page.goto(origin+'/#app/rules');
  await page.getByRole('button',{name:'Blank rule',exact:true}).click();
  await page.getByRole('textbox',{name:'Rule name',exact:true}).fill('Mixed condition fixture');
  await page.getByRole('button',{name:/Add the first condition/}).click();
  await page.getByRole('button',{name:'Add condition',exact:true}).click();
  await page.getByRole('button',{name:'Add condition',exact:true}).click();
  const join=page.getByRole('combobox',{name:'Logic after condition 1',exact:true});
  await join.click();await page.getByRole('option',{name:'OR',exact:true}).click();
  await page.locator('.rule-condition-expression').filter({hasText:'1 OR (2 AND 3)'}).waitFor();
  if(await page.locator('#rule-logic').count())throw Error('Global logic selector remains visible');
  // Draft survives refresh and can be deliberately restored.
  await page.reload();await page.getByRole('button',{name:'Restore draft',exact:true}).click();
  await page.locator('.rule-condition-expression').filter({hasText:'1 OR (2 AND 3)'}).waitFor();
  for(const width of [1218,390]){
    await page.setViewportSize({width,height:852});
    await join.scrollIntoViewIfNeeded();
    const bar=await join.evaluate(el=>{
      const control=el.getBoundingClientRect(),row=el.closest('.rule-condition-entry').getBoundingClientRect(),text=el.querySelector('[data-slot=select-value]').getBoundingClientRect();
      return {width:control.width,rowWidth:row.width,center:control.x+control.width/2,textCenter:text.x+text.width/2};
    });
    if(Math.abs(bar.width-bar.rowWidth)>1||Math.abs(bar.center-bar.textCenter)>1)throw Error('Connector must fill row and center AND/OR '+JSON.stringify(bar));
    await page.screenshot({path:'${output}/connectors-'+width+'.png'});
    if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))throw Error('Rules overflow '+width);
    await join.focus();await page.keyboard.press('Enter');await page.keyboard.press('Escape');
    if(!await join.evaluate(el=>el===document.activeElement))throw Error('Select did not restore focus');
  }
  await page.getByRole('button',{name:'Preview criteria',exact:true}).click();
  const preview=page.getByRole('dialog',{name:'Preview criteria',exact:true});
  await preview.getByText('Mixed AND / OR',{exact:true}).waitFor();
  if(!await preview.locator('.rule-preview__connector').first().textContent().then(s=>s==='OR'))throw Error('Preview lost OR');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Save rule',exact:true}).click();
  await page.waitForFunction(()=>!!document.querySelector('.rule-library__swipe-copy')?.textContent?.includes('Mixed condition fixture'));
  if(ruleWrite.definition.conditions[0].next_logic!=='OR'||ruleWrite.definition.conditions[2].next_logic)throw Error('Saved connectors incorrect');
  await page.goto(origin+'/#app/analysis');
  await page.getByRole('combobox',{name:'Screening rule',exact:true}).click();
  await page.getByRole('option',{name:'Mixed condition fixture',exact:true}).click();
  await page.locator('.screener-match-mode').filter({hasText:'Mixed AND / OR'}).waitFor();
  if(!await page.locator('.screener-criteria').innerText().then(s=>s.includes('OR')))throw Error('Screen criteria lost connector');
  await page.goto(origin+'/#app/rules');
  // Load through the existing swipe editor to verify the persisted response.
  const row=page.getByRole('group',{name:'Mixed condition fixture',exact:true});
  const toggle=row.getByRole('button',{name:'Actions for Mixed condition fixture',exact:true});
  await toggle.focus();await toggle.press('ArrowLeft');
  await row.getByRole('button',{name:'Edit Mixed condition fixture',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'Edit rules',exact:true});
  for(const width of [1218,390]){
    await page.setViewportSize({width,height:852});
    const box=await editor.boundingBox();
    if(width===1218 && (box.width>842 || box.height>722 || box.x<100))throw Error('Editor dialog not compact '+JSON.stringify(box));
    if(!await editor.evaluate(el=>el.scrollWidth<=el.clientWidth+1))throw Error('Editor dialog horizontal overflow');
    await editor.screenshot({path:'${output}/editor-'+width+'.png'});
  }
  await editor.locator('.rule-condition-expression').filter({hasText:'1 OR (2 AND 3)'}).waitFor();
  await editor.getByRole('button',{name:'Remove condition 3',exact:true}).click();
  if(await editor.getByRole('combobox',{name:'Logic after condition 2',exact:true}).count())throw Error('Dangling connector');
  await page.keyboard.press('Escape');
  await editor.waitFor({state:'detached'});
  const legacy=page.getByRole('group',{name:rule.name,exact:true});
  const legacyToggle=legacy.getByRole('button',{name:'Actions for '+rule.name,exact:true});
  await legacyToggle.focus();await legacyToggle.press('ArrowLeft');
  await legacy.getByRole('button',{name:'Edit '+rule.name,exact:true}).click();
  await page.getByRole('dialog',{name:'Edit rules',exact:true}).getByRole('combobox',{name:'Logic after condition 1',exact:true}).filter({hasText:'OR'}).waitFor();
  if(errors.length)throw Error(errors.join('\\n'));
  console.log('PASS per-condition-only logic, full-width centered connectors, compact edit dialog, legacy OR preservation, draft restore, save/reopen, preview, screener wording, removal, keyboard focus, 1218/390 layouts. Synthetic account only.');
}` +
      ")",
  )(page);
} finally {
  await browser.close();
}
