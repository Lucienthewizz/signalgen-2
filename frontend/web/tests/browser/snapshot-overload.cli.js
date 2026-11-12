// Real shared HTTP client, app, worker, WASM and IndexedDB; synthetic API only.
// prettier-ignore
async ({page, screen, width, theme}) => {
  const assert = (value, message) => { if (!value) throw Error(message); };
  let blocked = true, attempts = 0, refused = 0, scored = 0, contextId;
  const batches = new Set();
  await page.route("**/api/v1/**", async route => {
    const request = route.request(), p = new URL(request.url()).pathname;
    if (p.endsWith("/prepare") && request.method() === "POST") {
      attempts++; contextId = p.split("/")[5]; batches.add(p);
      assert(request.headers().authorization, "Prepare lost synthetic authorization");
      if (blocked) {
        refused++;
        return route.fulfill({status:429, headers:{"Retry-After":"1"}, json:{error:{code:"SNAPSHOT_CAPACITY",message:"Snapshot capacity is full. Retry after active batches finish."}}});
      }
    }
    if (p.endsWith("/signals") && request.method() === "POST") scored++;
    return route.fallback();
  });
  await page.setViewportSize({width,height:1000});
  await page.goto(new URL(page.url()).origin + (screen ? "/#app/analysis" : "/#app/backtest"));
  await page.reload();
  if (screen) await page.getByRole("button",{name:"Market & historical screening",exact:true}).click();
  await page.getByLabel("Stock source",{exact:true}).waitFor();
  await page.evaluate(theme => document.documentElement.dataset.theme=theme,theme);
  await page.getByLabel("Screening rule",{exact:true}).selectOption("qa-rule");
  await page.getByLabel(screen ? "Signal date from" : "From (daily session, SGT)",{exact:true}).fill("2026-01-20");
  await page.getByLabel(screen ? "Signal date to (inclusive)" : "To (inclusive, SGT)",{exact:true}).fill("2026-01-23");
  const start=page.getByRole("button",{name:screen?"Start screening":"Start signal study",exact:true});
  const stop=page.getByRole("button",{name:screen?"Stop screening":"Stop study",exact:true});
  const waiting=page.getByText(screen?/Server is busy\. Retrying shortly/:/Server rate limit\. Waiting until/);
  const completed=page.getByText(screen?/23\/23 stocks processed.*Selection complete/:"Completed the frozen catalog. Review data-quality limits before interpreting results.",{exact:!screen});
  const rows=()=>page.locator("table").filter({has:page.locator("caption",{hasText:screen?"Matching stocks and signal dates":"Signal details"})}).locator("tbody tr");
  const stored=()=>page.evaluate(async ({contextId})=>{
    const {studyEventPage}=await import('/src/analysis/signal-study-storage.ts');
    return {own:(await studyEventPage("11111111-1111-4111-8111-111111111119",contextId)).total,foreign:(await studyEventPage("different-owner",contextId)).total};
  },{contextId});
  await start.click(); await waiting.waitFor();
  assert(await stop.isEnabled(),"Backpressure disabled Stop");
  assert(scored===0 && (await stored()).own===0,"Refused batch produced results");
  await page.screenshot({path:`output/playwright/snapshot-overload-${screen?'screen':'study'}-${width}-${theme}.png`,fullPage:true});
  blocked=false; await completed.waitFor({timeout:30000});
  await page.waitForFunction(()=>document.querySelectorAll('.signal-study-panel tbody tr').length>0);
  assert(attempts>refused && refused===1,"Retry-After did not recover after capacity release");
  assert((await stored()).foreign===0,"Result owner isolation lost");
  const expected=screen?23:3;
  assert(scored===expected,"Automatic retry lost or repeated stocks");

  // Exhaust bounded retries, then explicitly resume/restart after capacity release.
  blocked=true; attempts=refused=scored=0; batches.clear();
  await start.click(); await waiting.waitFor();
  await start.waitFor({state:"visible"});
  await page.waitForFunction(name=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===name&&!b.disabled),screen?"Start screening":"Start signal study",{timeout:30000});
  assert(attempts===3*(screen?3:1),"429 retries are not bounded per batch");
  assert((await stored()).own===0 && scored===0,"Exhausted capacity fabricated stored results");
  assert(!await completed.count(),"Refused batches were reported complete");
  if(screen)await page.getByText("No stocks have been processed yet. No signal result is available.",{exact:true}).waitFor();
  else assert(await page.getByRole("button",{name:"Retry failed stocks",exact:true}).isEnabled(),"Interrupted study has no retry control");
  blocked=false;
  await (screen?start:page.getByRole("button",{name:"Retry failed stocks",exact:true})).click();
  await completed.waitFor({timeout:30000});assert(scored===expected,"Manual recovery changed stock coverage");

  // Stop during the Retry-After wait: neither a late retry nor stale results commit.
  blocked=true;attempts=refused=scored=0;
  await start.click();await waiting.waitFor();await stop.focus();await page.keyboard.press("Enter");
  await page.waitForFunction(name=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===name&&!b.disabled),screen?"Start screening":"Start signal study");
  const stoppedAttempts=attempts;blocked=false;await page.waitForTimeout(1300);
  assert(attempts===stoppedAttempts && scored===0 && (await stored()).own===0,"Stopped wait retried/scored/stored stale work");
  assert(!await completed.count(),"Stopped run became complete");
  assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),"Overload UI overflow");
  return {screen,width,theme,automaticRecovery:true,boundedRetries:true,manualRecovery:true,stopDuringWait:true,ownerIsolation:true,realWasm:true};
}
