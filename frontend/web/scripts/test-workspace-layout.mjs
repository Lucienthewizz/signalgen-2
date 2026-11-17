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
    viewport: { width: 1218, height: 1000 },
  });
  await page.goto(base + "/#home");
  const source = readFileSync(
    new URL("../tests/browser/workspace-regression.cli.js", import.meta.url),
    "utf8",
  );
  const boundary = source.indexOf("  // Keep unrelated GETs unresolved:");
  if (boundary < 0) throw Error("Synthetic fixture boundary missing");
  mkdirSync("/tmp/signalgen-layout-detail", { recursive: true });
  const scenario =
    source.slice(0, boundary) +
    `
  const pagedFixtures = Array.from({length:24},(_,i)=>({...rule,id:'paged-'+i,name:'Fixture '+String(i+1).padStart(2,'0'),definition:{...definition,name:'Fixture '+String(i+1).padStart(2,'0'),signal_type:i%2?'BUY':'SELL'}}));
  pagedFixtures.push({...rule,id:'paged-system',name:'System fixture',owner_type:'system',read_only:true});
  await page.route('**/api/v1/rules',route=>route.fulfill({json:{items:pagedFixtures}}));
  await page.route('**/api/v1/capabilities',route=>route.fulfill({json:{backtest:{schema_version:'backtest-2',policy_version:'holding-next-open-1',max_symbols:10,max_candles_per_symbol:2500}}}));
  await page.route('**/api/v1/portfolio',route=>route.fulfill({json:{schema_version:'portfolio-ledger-1',cost_policy:'weighted-average-fees-1',transaction_count:0,positions:[],totals:[]}}));
  await page.reload();
  await page.goto(origin+'/#app/rules');
  const library=page.locator('.rule-library'), editor=page.locator('.pen-rule-editor');
  await library.getByRole('button',{name:'Next saved rules page',exact:true}).waitFor();
  await page.waitForFunction(()=>{const e=document.querySelector('.pen-rule-editor').getBoundingClientRect(),l=document.querySelector('.rule-library').getBoundingClientRect();return l.left>e.right&&l.height>0;});
  await page.evaluate(()=>document.fonts.ready);
  const initialLibrary = await library.evaluate(el=>({height:el.getBoundingClientRect().height,y:el.getBoundingClientRect().top+scrollY}));
  await page.getByRole('button',{name:/Add the first condition/}).click();
  await page.getByRole('button',{name:'Add condition',exact:true}).click();
  await page.getByRole('button',{name:'Add condition',exact:true}).click();
  const expandedLibrary = await library.evaluate(el=>({height:el.getBoundingClientRect().height,y:el.getBoundingClientRect().top+scrollY}));
  if(Math.abs(initialLibrary.height-expandedLibrary.height)>2||Math.abs(initialLibrary.y-expandedLibrary.y)>2)throw Error('Saved rules resized or moved with condition editor '+JSON.stringify({initialLibrary,expandedLibrary}));
  const seen=new Set(); let turns=0;
  while(true){
    for(const name of await library.locator('article strong').allTextContents()) seen.add(name);
    const next=library.getByRole('button',{name:'Next saved rules page',exact:true});
    if(await next.isDisabled())break;
    if(++turns>24)throw Error('Rules pagination did not terminate');
    await next.click();
  }
  if(seen.size!==25)throw Error('Rules pagination omitted or repeated records: '+seen.size);
  await library.getByLabel('Search saved rules',{exact:true}).fill('Fixture 24');
  if(await library.locator('article').count()!==1)throw Error('Search did not reset rules page');
  await library.getByRole('button',{name:'SELL',exact:true}).click();
  await library.getByText('No matching rules',{exact:true}).waitFor();
  await library.getByRole('button',{name:'All signals',exact:true}).click();
  await library.getByRole('button',{name:'Actions for Fixture 24',exact:true}).focus();
  await page.keyboard.press('ArrowLeft');
  await library.getByRole('button',{name:'Edit Fixture 24',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Edit rules',exact:true});await dialog.waitFor();
  if(await dialog.getByLabel('Rule name',{exact:true}).inputValue()!=='Fixture 24')throw Error('Paginated edit opened wrong rule');
  await page.keyboard.press('Escape');
  await page.goto(origin+'/#app/overview');
  const quick=page.getByRole('navigation',{name:'Quick access',exact:true});
  if((await quick.innerText()).includes('Follow the market'))throw Error('Removed quick-access heading remains');
  const balanced=await quick.locator('button').evaluateAll(nodes=>Math.abs(nodes[0].getBoundingClientRect().width-nodes[1].getBoundingClientRect().width)<2);
  if(!balanced)throw Error('Dashboard quick access widths differ');
  const cards=page.locator('.overview-resources a');
  if(!await cards.evaluateAll(nodes=>nodes.every(el=>{const r=el.getBoundingClientRect();return parseFloat(getComputedStyle(el).borderRadius)>=12&&[...el.querySelectorAll('.feature-gallery__copy>*')].every(c=>{const b=c.getBoundingClientRect();return b.left>=r.left+12&&b.right<=r.right-12;});})))throw Error('Rounded dashboard card copy escapes its inset');
  const summarySurfaces=await page.locator('.overview-launch, .overview-next, .overview-portfolio').evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el).backgroundColor));
  if(summarySurfaces.some(color=>color!=='rgba(0, 0, 0, 0)'))throw Error('Dashboard summary retains a gray surface: '+summarySurfaces);
  const lastSelection=page.getByRole('button',{name:'Use last selection',exact:true});
  await page.mouse.move(0,0);
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.overview-open-screener')).backgroundColor==='rgb(13, 57, 38)');
  const resourceAlignment=await cards.evaluateAll(nodes=>nodes.map(el=>{const icon=el.querySelector('.overview-resources__icon').getBoundingClientRect(),label=el.querySelector('.feature-gallery__copy>strong').getBoundingClientRect(),value=el.querySelector('.overview-resources__value').getBoundingClientRect(),action=el.querySelector('.feature-gallery__copy>span').getBoundingClientRect();return {iconTop:icon.top,labelTop:label.top,valueTop:value.top,actionTop:action.top};}));
  if(resourceAlignment.some(row=>Math.abs(row.iconTop-row.labelTop)>2||Math.abs(row.valueTop-resourceAlignment[0].valueTop)>2||Math.abs(row.actionTop-resourceAlignment[0].actionTop)>2))throw Error('Resource icon/copy rows are misaligned '+JSON.stringify(resourceAlignment));
  await page.goto(origin+'/#app/backtest');
  const horizon=page.locator('#study-horizon');await horizon.waitFor();
  const full=await horizon.evaluate(el=>{const field=el.closest('[data-slot="field"]'),grid=field.parentElement;return Math.abs(field.getBoundingClientRect().width-grid.getBoundingClientRect().width)<2;});
  if(!full)throw Error('Study horizon is not full width');
  await horizon.fill('12');
  const slider=page.getByRole('slider',{name:'Trading candles slider',exact:true});
  await slider.focus();await slider.press('ArrowRight');
  if(await horizon.inputValue()!=='13')throw Error('Study slider lost numeric/keyboard synchronization');
  const plain=await slider.evaluate(el=>{const s=getComputedStyle(el.parentElement);return s.backgroundColor==='rgba(0, 0, 0, 0)'&&parseFloat(s.borderTopWidth)===0;});
  if(!plain)throw Error('Slider still has an oval background');
  await page.getByRole('button',{name:'Portfolio simulation',exact:true}).click();
  await page.locator('.backtest-config > .run-stepper').waitFor();
  await page.getByRole('slider',{name:'Holding period slider',exact:true}).waitFor();
  await page.getByRole('button',{name:'Analyse every signal',exact:true}).click();

  if(await page.locator('.pen-study-guide li > svg').count()!==3)throw Error('Study guide lost three steps');
  const stressCatalog=Array.from({length:32},(_,i)=>({symbol:i===0?'BBCA.JK':i===1?'BBRI.JK':'T'+String(i).padStart(3,'0')+'.JK',name:'Synthetic company with a longer trading name '+i,exchange:'XIDX',currency:'IDR'}));
  await page.route('**/api/v1/stocks',route=>route.fulfill({json:{items:stressCatalog}}));
  await page.goto(origin+'/#app/universes');await page.reload();
  await page.getByRole('table',{name:'Stock catalog',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.stock-catalog-picker__table tbody tr').length===12);
  const listing=page.locator('.stock-catalog-picker__listing'),selection=page.locator('.universe-selection');
  const split=await listing.evaluate(el=>{const a=el.getBoundingClientRect(),b=document.querySelector('.universe-selection').getBoundingClientRect();return Math.abs(a.top-b.top)<2&&b.left>a.right;});
  if(!split)throw Error('Catalog and selection do not form the requested split');
  await page.getByRole('button',{name:'Next stock page',exact:true}).click();
  await page.getByText('Page 2 of 3',{exact:true}).waitFor();
  await page.getByLabel('Search stocks',{exact:true}).fill('no-match-keyword');
  await page.getByText('No matching stocks',{exact:true}).waitFor();
  await page.getByLabel('Search stocks',{exact:true}).fill('');
  for(const width of [1218,390]){
    await page.setViewportSize({width,height:1000});
    for(const view of ['overview','rules','universes','backtest','news','realtime','journal','analysis']){
      await page.goto(origin+'/#app/'+view);await page.locator('.route-loading').waitFor({state:'hidden'});await page.evaluate(()=>document.fonts.ready);
      if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Layout overflow '+view+'/'+width);
      if(await page.locator('.fit-data-table [data-slot="table-container"]').evaluateAll(nodes=>nodes.some(n=>n.scrollWidth>n.clientWidth+1)))throw Error('Data table still needs horizontal scrolling '+view+'/'+width);
      if(await page.locator('.fit-data-table td').evaluateAll(nodes=>nodes.some(n=>n.clientWidth>0&&n.scrollWidth>n.clientWidth+1)))throw Error('Data cell overflows '+view+'/'+width);
      if(await page.locator('.fit-data-table [data-slot="badge"]').evaluateAll(nodes=>nodes.some(n=>n.clientHeight>0&&n.scrollHeight>n.clientHeight+1)))throw Error('Status badge text is clipped '+view+'/'+width);
      if(view==='overview'&&width===1218){
        const brand=await page.locator('.sidebar .brand__name').evaluate(el=>{const r=document.createRange();r.selectNodeContents(el);const t=r.getBoundingClientRect();for(let a=el.parentElement;a&&a!==document.body;a=a.parentElement){const s=getComputedStyle(a),v=a.getBoundingClientRect();if(['hidden','clip'].includes(s.overflowX)&&(t.left<v.left-1||t.right>v.right+1))return false;if(['hidden','clip'].includes(s.overflowY)&&(t.top<v.top-1||t.bottom>v.bottom+1))return false;}return true;});
        if(!brand)throw Error('Brand wordmark is clipped');
      }
      if(view==='universes'){
        const category=page.getByRole('combobox',{name:'Stock categories',exact:true});await category.click();await page.getByRole('option',{name:'Banks',exact:true}).click();
        if(await page.getByRole('table',{name:'Stock catalog',exact:true}).locator('tbody tr').count()!==2)throw Error('Category dropdown failed to filter');
        await category.click();await page.getByRole('option',{name:'All stocks',exact:true}).click();
      }

      if(view==='news'){
        const geometry=await page.locator('.workspace-news').evaluate(el=>{const t=el.querySelector('.news-toolbar').getBoundingClientRect(),a=el.querySelector('.news-feed').getBoundingClientRect(),v=el.querySelector('.news-video').getBoundingClientRect();return {t:t.bottom,a:a.top,v:v.top,x:v.left,right:a.right};});
        if(geometry.t>Math.min(geometry.a,geometry.v)+1)throw Error('News toolbar overlaps content');
        if(width>1000&&(Math.abs(geometry.a-geometry.v)>2||geometry.x<=geometry.right))throw Error('News columns do not align');
      }
      if(view==='realtime'){
        const order=await page.evaluate(()=>document.querySelector('.monitor-board').getBoundingClientRect().top<document.querySelector('.stock-heatmap').getBoundingClientRect().top);
        if(!order)throw Error('Market chart must lead the heatmap');
      }
      await page.screenshot({path:'/tmp/signalgen-layout-detail/'+view+'-'+width+'.png',fullPage:true,animations:'disabled'});
    }
  }
  await page.setViewportSize({width:1218,height:1000});
  await page.goto(origin+'/#app/rules');
  const saveButtons=await page.locator('.rule-composer__save-actions button').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
  if(Math.max(...saveButtons)-Math.min(...saveButtons)>2)throw Error('Rule footer actions wrap at desktop width');
  const navFont=await page.locator('.nav-group button').first().evaluate(el=>getComputedStyle(el).fontFamily);
  if(!navFont.includes('Saira Condensed'))throw Error('Techno navigation font missing');
  const filterType=await page.locator('.rule-library__filters [data-signal]').evaluateAll(nodes=>nodes.map(n=>parseFloat(getComputedStyle(n).fontSize)));
  if(filterType.some(size=>size>10.5))throw Error('Rule signal filter type is too large');
  const filterBoxes=await page.locator('.rule-library__filters [data-signal]').evaluateAll(nodes=>nodes.map(el=>el.getBoundingClientRect().height));
  if(filterBoxes.some(height=>height>33||height<32))throw Error('Signal filter boxes are not compact: '+filterBoxes);
  await page.goto(origin+'/#app/news');
  const separator=await page.locator('.news-video').evaluate(el=>({border:getComputedStyle(el).borderLeftWidth,padding:getComputedStyle(el).paddingLeft}));
  if(separator.border!=='1px'||parseFloat(separator.padding)<24)throw Error('News/video separator missing');
  await page.locator('.news-search-disclosure summary').click();
  await page.getByLabel('Search news',{exact:true}).fill('no matching fixture xyz');
  await page.getByText('No matching headlines',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Reset filters',exact:true}).click();
  await page.locator('.news-search-disclosure summary').click();
  const compactToolbar=await page.locator('.news-toolbar').evaluate(el=>el.getBoundingClientRect().height);
  if(compactToolbar>90)throw Error('News toolbar is not compact: '+compactToolbar);
  const presentation=page.getByRole('navigation',{name:'More presentations',exact:true});
  await presentation.getByRole('button').first().focus();await page.keyboard.press('Enter');
  if(await page.locator('.news-video iframe').count())throw Error('Presentation selection must not autoplay');
  await page.locator('.news-video__poster').click();await page.locator('.news-video iframe').waitFor();
  await page.goto(origin+'/#app/realtime');
  if(await page.locator('.monitor-ledger thead').getByText('Remove stock',{exact:true}).count())throw Error('Empty removal column remains for selected universe');
  if(errors.length)throw Error(errors.join('\\n'));
  console.log('PASS: 25-rule pagination/search/filter/edit, independent library height, rounded dashboard cards, balanced shortcuts, full-width keyboard slider, compact 32-stock catalog paging/empty state, News toolbar/columns, plain sliders, contained stepper, unclipped brand, dropdown categories, fitted/stacked data tables and chart-first monitor; 1218/390px, synthetic API/account only.');
}`;
  await eval("(" + scenario + ")")(page);
} finally {
  await browser.close();
}
