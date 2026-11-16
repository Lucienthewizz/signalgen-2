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
  const boundary = fixture.indexOf("  // Keep unrelated GETs unresolved:");
  if (boundary < 0) throw Error("Synthetic fixture boundary missing");
  mkdirSync("/tmp/signalgen-black-green", { recursive: true });
  const scenario =
    fixture.slice(0, boundary) +
    `
  await page.route('**/api/v1/portfolio',route=>route.fulfill({json:{schema_version:'portfolio-ledger-1',cost_policy:'weighted-average-fees-1',transaction_count:0,positions:[],totals:[]}}));
  await page.route('**/api/v1/portfolio/transactions',route=>route.fulfill({json:{schema_version:'portfolio-ledger-1',items:[]}}));
  await page.reload();
  const audit = () => {
    const rgb = s => (s.match(/[\\d.]+/g)||[]).slice(0,3).map(Number);
    const lum = c => rgb(c).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((n,x,i)=>n+x*[.2126,.7152,.0722][i],0);
    const ratio = (a,b) => (Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
    const visible = el => {const s=getComputedStyle(el);return el.getClientRects().length&&s.visibility==='visible'&&Number(s.opacity)>.99;};
    const backdrop = el => {for(let p=el;p;p=p.parentElement){const c=getComputedStyle(p).backgroundColor;if(!c.endsWith(', 0)')&&c!=='transparent')return c;}return 'rgb(9, 10, 10)';};
    const root=document.querySelector('.pen-workbench');
    const result={canvas:getComputedStyle(root).backgroundColor,sidebar:getComputedStyle(root.querySelector('.sidebar')).backgroundColor,white:[],brightButtons:[],gradients:[],contrast:[]};
    for(const el of document.querySelectorAll('.pen-workbench *, [role="dialog"] *, [role="listbox"] *')){
      if(!visible(el))continue;
      const s=getComputedStyle(el), name=el.tagName+'.'+String(el.className).slice(0,65);
      if(s.backgroundColor==='rgb(255, 255, 255)')result.white.push(name);
      if(el.matches('button,[data-slot="button"]')&&(rgb(s.backgroundColor)[1]>150&&rgb(s.backgroundColor)[1]>rgb(s.backgroundColor)[0]*1.2&&rgb(s.backgroundColor)[1]>rgb(s.backgroundColor)[2]*1.15))result.brightButtons.push(name);
      if(s.backgroundImage.includes('gradient')&&!el.closest('.journal-equity-chart,.tradingview-chart,.stock-heatmap'))result.gradients.push(name);
      if(el.childNodes.length&&Array.from(el.childNodes).some(n=>n.nodeType===3&&n.textContent.trim())&&!el.closest('svg,button:disabled,[aria-disabled="true"],[data-disabled]')){
        const min=parseFloat(s.fontSize)>=24||(parseFloat(s.fontSize)>=18.66&&Number(s.fontWeight)>=700)?3:4.5;
        const value=ratio(s.color,backdrop(el));if(value<min-.03)result.contrast.push({name,text:el.textContent.trim().slice(0,45),fg:s.color,bg:backdrop(el),ratio:Math.round(value*100)/100});
      }
    }
    return result;
  };
  const findings=[];
  for(const width of [1440,1218,390]){
    await page.setViewportSize({width,height:1000});
    for(const view of ['overview','analysis','backtest','journal','rules','universes','realtime','news']){
      await page.goto(origin+'/#app/'+view);
      await page.locator('.pen-workbench').waitFor();
      await page.locator('.route-loading').waitFor({state:'hidden'});
      await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
      for(const preference of ['dark']){
        await page.evaluate(t=>document.documentElement.dataset.theme=t,preference);
        const check=await page.evaluate(audit);
        if(check.canvas!=='rgb(9, 10, 10)'||check.sidebar!=='rgb(16, 17, 17)')throw Error('Theme surface mismatch '+JSON.stringify({view,width,preference,check}));
        if(check.white.length||check.brightButtons.length||check.gradients.length||check.contrast.length)findings.push({view,width,preference,...check});
      }
      await page.screenshot({path:'/tmp/signalgen-black-green/'+view+'-'+width+'.png',fullPage:true,animations:'disabled'});
    }
  }
  console.log('THEME_AUDIT '+JSON.stringify(findings));
  await page.setViewportSize({width:1218,height:1000});
  await page.goto(origin+'/#app/analysis');
  const primary=page.getByRole('button',{name:'Start screening',exact:true});await primary.waitFor();
  const colors=async()=>primary.evaluate(el=>{const s=getComputedStyle(el);return {bg:s.backgroundColor,fg:s.color,border:s.borderTopColor,outline:s.outlineColor,offset:s.outlineOffset,icons:Array.from(el.querySelectorAll('svg')).map(icon=>getComputedStyle(icon).color),focused:el.matches(':focus-visible'),active:document.activeElement===el};});
  const normal=await colors();if(normal.bg!=='rgb(13, 57, 38)'||normal.fg!=='rgb(241, 248, 243)'||normal.border!=='rgb(34, 88, 61)'||normal.icons.some(c=>c!==normal.fg))throw Error('Primary normal '+JSON.stringify(normal));
  await primary.hover();await page.waitForTimeout(250);
  if((await colors()).bg!=='rgb(18, 74, 49)')throw Error('Primary hover '+JSON.stringify(await colors()));
  await page.mouse.down();await page.waitForTimeout(250);
  if((await colors()).bg!=='rgb(9, 43, 28)')throw Error('Primary pressed '+JSON.stringify(await colors()));
  await page.mouse.move(0,0);await page.mouse.up();
  await page.keyboard.press('Tab');await primary.focus();await page.waitForTimeout(250);
  const focus=await colors();if(focus.outline!=='rgb(105, 230, 156)'||focus.offset!=='2px')throw Error('Primary focus '+JSON.stringify(focus));
  await primary.evaluate(el=>el.disabled=true);await page.waitForTimeout(250);
  const disabled=await colors();if(disabled.bg!=='rgb(20, 22, 22)'||disabled.fg!=='rgb(120, 129, 123)')throw Error('Primary disabled '+JSON.stringify(disabled));
  await page.goto(origin+'/#app/rules');
  await page.getByRole('button',{name:'Edit Rule fixture',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Edit rules',exact:true});await dialog.waitFor();
  const popup=await dialog.evaluate(el=>({bg:getComputedStyle(el).backgroundColor,fg:getComputedStyle(el).color}));
  if(popup.bg!=='rgb(20, 22, 22)'||popup.fg!=='rgb(241, 243, 242)')throw Error('Portalled dialog '+JSON.stringify(popup));
  await page.keyboard.press('Escape');
  await page.goto(origin+'/#app/backtest');
  await page.getByRole('button',{name:'Open calendar',exact:true}).first().click();
  const calendar=page.locator('.signalgen-date-popup');await calendar.waitFor();
  if(await calendar.evaluate(el=>getComputedStyle(el).backgroundColor)!=='rgb(20, 22, 22)')throw Error('Portalled calendar surface');
  await page.keyboard.press('Escape');
  await page.goto(origin+'/#home');
  if(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--bg-page').trim()))throw Error('Workspace palette leaked into landing');
  if(findings.length)throw Error('Theme audit found '+findings.length+' route/viewport cases; see THEME_AUDIT');
  if(errors.length)throw Error(errors.join('\\n'));
  console.log('PASS: eight routes at 1440/1218/390px, dark palette, no white/bright primary/decorative gradient, rendered text contrast, primary normal/hover/pressed/focus/disabled, portalled dialog/calendar. Synthetic API/account only.');
}`;
  await eval("(" + scenario + ")")(page);
} finally {
  await browser.close();
}
