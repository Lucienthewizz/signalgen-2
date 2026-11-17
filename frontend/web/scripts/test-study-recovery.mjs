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
    viewport: { width: 1456, height: 852 },
    reducedMotion: "reduce",
  });
  await page.goto(origin + "/#home");
  const source = readFileSync(
    new URL("../tests/browser/workspace-regression.cli.js", import.meta.url),
    "utf8",
  );
  const boundary = source.indexOf("  // Keep unrelated GETs unresolved:");
  if (boundary < 0) throw Error("Fixture boundary missing");
  mkdirSync("/tmp/signalgen-study-recovery", { recursive: true });
  const tail = String.raw`
 let active=true,failCancel=true,failLookup=false,capacityRace=false,globalFull=false,deletes=0;
 const recoveryContext={id:"recovered-study",market:"IDX",config:{from:"2026-10-01",to:"2026-10-31"},total:962};
 for(const path of ["/api/v1/screener/scans","/api/v1/backtests/studies"]){
  await page.route("**"+path,route=>{
   if(route.request().method()==="GET")return route.fulfill({status:failLookup?503:200,json:failLookup?{error:{code:"STUDY_UNAVAILABLE",message:"Unavailable"}}:{items:active?[recoveryContext]:[]}});
   if(capacityRace){active=!globalFull;return route.fulfill({status:429,json:{error:{code:"STUDY_CAPACITY",message:"Cancel the previous study"}}});}
   return route.fulfill({status:503,json:{error:{code:"STUDY_UNAVAILABLE",message:"Fixture stops before processing"}}});
  });
  await page.route("**"+path+"/recovered-study",route=>{
   if(failCancel)return route.fulfill({status:503,json:{error:{code:"STUDY_UNAVAILABLE",message:"Cancel failed"}}});
   active=false;deletes++;return route.fulfill({status:204});
  });
 }
 await page.reload();
 for(const width of [1456,390])for(const purpose of ["screen","backtest"]){
  active=true;failCancel=true;failLookup=false;capacityRace=false;deletes=0;
  await page.setViewportSize({width,height:852});
  await page.goto(origin+(purpose==="screen"?"/#app/analysis":"/#app/backtest"));
  if(purpose==="screen")await page.getByRole("button",{name:"Market & historical screening",exact:true}).click();
  const start=page.getByRole("button",{name:purpose==="screen"?"Start screening":"Start signal study",exact:true});
  const waitReady=()=>page.waitForFunction(label=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===label&&!b.disabled),purpose==="screen"?"Start screening":"Start signal study");
  const cancel=page.getByRole("button",{name:"Cancel previous run",exact:true});
  await cancel.waitFor();
  if(await start.isEnabled()||deletes)throw Error("Prior run silently replaced");
  await cancel.click();await page.getByText("Could not cancel the previous run. Retry when connected.",{exact:true}).waitFor();
  if(await start.isEnabled())throw Error("Failed cancellation unlocked start");
  failCancel=false;await cancel.click();await cancel.waitFor({state:"detached"});
  await waitReady();
  if(!await start.isEnabled()||active)throw Error("Cancellation did not unlock start");
  capacityRace=true;await start.click();await cancel.waitFor();
  if(await start.isEnabled())throw Error("Capacity race did not recover");
  await page.locator('.signal-study-panel').screenshot({path:'/tmp/signalgen-study-recovery/'+purpose+'-'+width+'.png'});
  await cancel.click();await cancel.waitFor({state:"detached"});capacityRace=false;
  if(purpose==="screen"&&width===1456){
   capacityRace=true;globalFull=true;await start.click();
   await page.getByText("The server is busy with other runs. Wait a moment, then check again.",{exact:true}).waitFor();
   if(await start.isEnabled())throw Error("Global capacity allowed start");
   capacityRace=false;globalFull=false;await page.getByRole("button",{name:"Check again",exact:true}).click();
   await page.getByRole("button",{name:"Check again",exact:true}).waitFor({state:"detached"});
  }
  failLookup=true;await page.reload();if(purpose==="screen")await page.getByRole("button",{name:"Market & historical screening",exact:true}).click();await page.getByRole("button",{name:"Check again",exact:true}).waitFor();
  if(await start.isEnabled())throw Error("Failed lookup allowed start");
  failLookup=false;await page.getByRole("button",{name:"Check again",exact:true}).click();
  await page.getByRole("button",{name:"Check again",exact:true}).waitFor({state:"detached"});
  await waitReady();
  if(!await start.isEnabled())throw Error("Lookup retry did not recover");
  console.log("PASS",purpose,width,"reload discovery, explicit cancellation, cancellation failure/retry, capacity race, lookup failure/retry");
 }
 `;
  await eval("(" + source.slice(0, boundary) + tail + "})")(page);
} finally {
  await browser.close();
}
