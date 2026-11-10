// All identities/provider responses below are synthetic; never contact Google.
async (page) => {
  const origin = new URL(page.url()).origin;
  const user={id:"11111111-1111-4111-8111-111111111111",email:"fixture@example.test",full_name:"Google fixture"};
  let mode="success", starts=0, exchanges=0, sessions=0;
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/*",async route=>{
    const u=new URL(route.request().url()), p=u.pathname;
    if(u.origin!==origin) throw Error("External provider request forbidden in fixture");
    if(p==="/__google-fixture") return route.fulfill({contentType:"text/html",body:`<script>location.replace('/auth/google/callback?${mode==="cancel"?"error=access_denied":"code=fixture-code"}')</script>`});
    if(!p.startsWith("/api"))return route.continue();
    if(p==="/api/auth/google/start"){
      starts++;
      const body=route.request().postDataJSON();
      if(!/^[\w-]{43}$/.test(body.code_challenge)||body.redirect_to!==origin+"/auth/google/callback") throw Error("Invalid browser PKCE request");
      if(mode==="disabled")return route.fulfill({status:503,json:{error:{code:"GOOGLE_NOT_CONFIGURED",message:"Google sign-in is not configured yet. Use email and password."}}});
      return route.fulfill({json:{url:origin+"/__google-fixture"}});
    }
    if(p==="/api/auth/google/exchange"){
      exchanges++;
      if(new URL(page.url()).search)throw Error("Callback code was not removed from the address bar");
      const body=route.request().postDataJSON();
      if(body.code!=="fixture-code"||!/^[\w-]{43}$/.test(body.code_verifier))throw Error("Missing callback proof");
      if(mode==="expired")return route.fulfill({status:401,json:{error:{code:"AUTH_INVALID",message:"Google sign-in expired. Start again."}}});
      return route.fulfill({json:{access_token:"synthetic-google-token",refresh_token:"synthetic-refresh",token_type:"bearer",expires_in:3600,user}});
    }
    if(p==="/api/v1/sessions"){
      sessions++;
      if(route.request().headers().authorization!=="Bearer synthetic-google-token")throw Error("Session not bound to Google identity");
      return route.fulfill({json:{app_session_token:"synthetic-app-session",session:{id:"fixture",expires_at:new Date(Date.now()+3600000).toISOString()}}});
    }
    const body=p==="/api"?{status:"ok",version:"0.18.0"}:p==="/api/auth/me"?user:p==="/api/v1/account/me"?{user,role:"user",status:"active"}:p==="/api/v1/subscription"?{plan_code:"free",features:[]}:p==="/api/v1/workspace"?{resources:[],records:[]}: {items:[]};
    return route.fulfill({json:body});
  });
  async function reset(){await page.goto(origin+"/#login");await page.evaluate(()=>{sessionStorage.clear();localStorage.clear();});await page.reload();await page.getByRole("button",{name:"Continue with Google",exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector(".auth-google")?.disabled);}
  await reset();await page.getByRole("link",{name:"Register",exact:true}).first().click();
  await page.getByRole("heading",{name:"Create your account",exact:true}).waitFor();
  mode="disabled";await page.getByRole("button",{name:"Continue with Google",exact:true}).click();
  await page.getByText("Google sign-in is not configured yet. Use email and password.",{exact:true}).waitFor();
  for(const width of [1440,390]) for(const theme of ["dark","light"]){
    await page.setViewportSize({width,height:1000});
    await reset();
    await page.addStyleTag({content:"*,*::before,*::after{transition:none!important;animation:none!important;}"});
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.classList.toggle("dark",theme==="dark");},theme);
    await page.locator('.auth-google').scrollIntoViewIfNeeded();
    if(theme==="light") await page.waitForFunction(()=>getComputedStyle(document.querySelector(".auth-google")).backgroundColor==="rgb(255, 255, 255)");
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error("Login overflow");
    const fills=await page.locator('.auth-google__mark path').evaluateAll(paths=>paths.map(p=>p.getAttribute('fill')));
    if(new Set(fills).size!==4)throw Error('Google identity mark is not four-color');
    await page.screenshot({path:`output/playwright/google-login-${width}-${theme}.png`,fullPage:true});
    mode="disabled";
    await page.getByRole("button",{name:"Continue with Google",exact:true}).click();
    await page.getByText("Google sign-in is not configured yet. Use email and password.",{exact:true}).waitFor();
    if(await page.evaluate(()=>sessionStorage.getItem("signalgen.google-pkce")))throw Error("Failed start retained verifier");
    mode="success";const before={starts,exchanges,sessions};
    await page.getByRole("button",{name:"Continue with Google",exact:true}).evaluate(button=>{button.click();button.click();});
    await page.waitForURL("**/#app/overview");
    if(starts-before.starts!==1||exchanges-before.exchanges!==1||sessions-before.sessions!==1)throw Error("Duplicate OAuth/session operation");
    if(await page.evaluate(()=>sessionStorage.getItem("signalgen.google-pkce")))throw Error("Verifier retained after success");
  }
  await reset();mode="success";
  await page.goto(origin+'/#login&returnTo=app%2Fjournal');
  await page.getByRole('button',{name:'Continue with Google',exact:true}).click();
  await page.waitForURL('**/#app/journal');
  for(const failure of ["cancel","expired"]){
    await reset();mode=failure;const before=exchanges;
    await page.getByRole("button",{name:"Continue with Google",exact:true}).click();
    await page.getByRole("link",{name:"Back to sign in",exact:true}).waitFor();
    if(exchanges-before!==(failure==="cancel"?0:1))throw Error("Invalid callback retried");
    if(new URL(page.url()).search)throw Error("Provider query leaked into error URL");
  }
  await reset();const before=exchanges;
  await page.goto(origin+"/auth/google/callback?code=unsolicited");
  await page.getByRole("link",{name:"Back to sign in",exact:true}).waitFor();
  if(exchanges!==before)throw Error("Unsolicited callback exchanged");
  if(errors.length)throw Error(errors.join("\n"));
  await page.evaluate(()=>document.body.setAttribute("data-signalgen-auth-tests","complete"));
}
