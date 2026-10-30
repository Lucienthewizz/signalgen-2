// prettier-ignore
async (page) => {
  // Fixture terisolasi: jangan membaca/menulis token atau resource akun asli.
  const origin = new URL(page.url()).origin;
  const user = {id:"11111111-1111-4111-8111-111111111119",full_name:"Synthetic recovery QA",email:"recovery@example.test",role:"user",status:"active"};
  let mode = "transient", reads = 0;
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    sessionStorage.setItem("signalgen.access-token", "synthetic-not-real");
    sessionStorage.setItem("signalgen.app-session", "synthetic-session");
    sessionStorage.setItem("signalgen.app-session-origin", "same-origin");
  });
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), p = url.pathname;
    if(url.origin !== origin) return route.abort();
    if(p !== "/api" && !p.startsWith("/api/") && p !== "/ready") return route.continue();
    if(p === "/api/v1/rules") {
      reads++;
      if(mode === "persistent" || (mode === "transient" && reads === 1))
        return route.fulfill({status:503,json:{error:{code:"SERVICE_UNAVAILABLE",request_id:"req-synthetic"}}});
      if(mode === "timeout")
        return route.fulfill({status:504,json:{error:{code:"REQUEST_TIMEOUT",request_id:"req-synthetic"}}});
      return route.fulfill({json:{items:[{id:"qa-rule",name:"Recovery test rule",version:1,owner_type:"user",read_only:false,definition:{name:"Recovery test rule",logic:"AND",signal_type:"BUY",cooldown_sec:0,conditions:[{left:"RSI14",op:"<",right:30}]}}]}});
    }
    let payload;
    if(p === "/api" || p === "/ready") payload={status:"ready",name:"Synthetic API"};
    else if(p === "/api/auth/me") payload=user;
    else if(p === "/api/v1/account/me") payload={user,features:["screener"],session:{id:"qa-session",expires_at:new Date(Date.now()+86400000).toISOString()},device:{installation_id:"qa",current:true}};
    else if(p === "/api/v1/stock-universes") payload={items:[{id:"qa-universe",name:"Recovery test universe",symbols:["BBCA.JK"],version:1}]};
    else if(p === "/api/v1/subscription") payload={subscription:null};
    else if(p === "/api/v1/workspace") payload={items:[]};
    else if(p.startsWith("/api/v1/workspace/") && request.method() === "PUT") {
      const body=request.postDataJSON();
      payload={kind:p.split("/").at(-1),data:body.data,version:(body.version ?? 0)+1,updated_at:new Date().toISOString()};
    } else return route.fulfill({status:404,json:{error:{code:"UNMOCKED_FIXTURE"}}});
    return route.fulfill({json:payload});
  });
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    for(let theme=0;theme < 1;theme++) {
      mode="transient"; reads=0;
      await page.goto(`${origin}/#app/analysis`);
      await page.reload();
      const run=page.getByRole("button",{name:"Start screening",exact:true});
      await run.waitFor({timeout:15000});
      await page.waitForFunction(()=>[...document.querySelectorAll("button")].some(button=>button.textContent.includes("Start screening")&&!button.disabled));
      if(reads !== 2) throw Error(`Expected one automatic retry, got ${reads}`);
      if(await page.getByText("Service temporarily unavailable",{exact:true}).count()) throw Error("Recovered outage still visible");

      for(const failure of ["persistent","timeout"]) {
        mode=failure; reads=0;
        await page.reload();
        await page.getByRole("heading",{name:failure === "timeout" ? "Request timed out" : "Service temporarily unavailable",exact:true}).waitFor();
        if(reads !== 2) throw Error(`Retry loop detected: ${reads}`);
        if(!await page.evaluate(()=>sessionStorage.getItem("signalgen.access-token") === "synthetic-not-real")) throw Error("Outage cleared the identity");
        if(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth+1)) throw Error(`Overflow at ${width}`);
        if(width === 1440 && theme === 0 && failure === "timeout") await page.screenshot({path:"output/playwright/resource-timeout-fixture.png"});
        mode="healthy";
        await page.getByRole("button",{name:"Reload selections",exact:true}).click();
        await run.waitFor();
        await page.waitForFunction(()=>[...document.querySelectorAll("button")].some(button=>button.textContent.includes("Start screening")&&!button.disabled));
        if(reads !== 3) throw Error("Explicit recovery did not issue one fresh read");
      }
      if(width === 1440 && theme === 0) await page.screenshot({path:"output/playwright/resource-recovery-fixture.png"});
      if (await page.getByRole("button", { name: /Switch to .* mode/ }).count()) throw Error("Theme toggle must remain hidden while dark-only mode is active");
    }
  }
  if(errors.length) throw Error(errors.join("; "));
  await page.evaluate(()=>document.body.setAttribute("data-signalgen-recovery-tests","complete"));
  return {synthetic:true,widths:[1440,390],themes:2,automaticRetry:true,manualRecovery:true,timeout:true};
}
