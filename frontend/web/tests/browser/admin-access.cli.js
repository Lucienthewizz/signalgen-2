// Synthetic accounts and API only; no real grants or role changes.
// prettier-ignore
async (page) => {
  const origin = new URL(page.url()).origin;
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const now = new Date().toISOString();
  let mode = "healthy", accountReads = 0;
  const writes = [], queries = [], grants = new Map();
  const members = Array.from({length: 35}, (_, i) => ({
    user_id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
    email: `member${i + 1}@example.test`, role: "user",
    status: i === 33 ? "suspended" : "active", created_at: now, updated_at: now,
  }));
  const user = { id: "00000000-0000-0000-0000-000000000999", email: "operator@example.test", full_name: "Operator QA", role: "operator", status: "active" };
  await page.addInitScript(() => {
    sessionStorage.setItem("signalgen.access-token", "synthetic-admin-only");
    sessionStorage.setItem("signalgen.app-session", "synthetic-admin-session");
    sessionStorage.setItem("signalgen.app-session-origin", "same-origin");
  });
  await page.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url()), p = url.pathname;
    if (p !== "/api" && !p.startsWith("/api/") && p !== "/ready") return url.origin === origin ? route.continue() : route.abort();
    const respond = (json) => route.fulfill({json});
    const actor = {...user, role: mode === "denied" ? "user" : "operator"};
    if (p === "/api" || p === "/ready") return respond({status:"ready", name:"Synthetic admin API", version:"0.12.0"});
    if (p === "/api/auth/me") return respond(actor);
    if (p === "/api/v1/account/me") return respond({user:actor, features:["screener","backtest"]});
    if (p === "/api/v1/sessions") return respond({session_token:"synthetic-admin-session", session:{id:"qa",installation_id:user.id,created_at:now,expires_at:new Date(Date.now()+86400000).toISOString(),last_seen_at:now}});
    if (p === "/api/v1/subscription/plans") return respond({items:[{code:"analyst",name:"Analyst",features:["screener","backtest"]}]});
    if (p === "/api/v1/subscription") return respond({subscription:null});
    if (p === "/api/v1/operator/accounts") {
      accountReads++;
      if (mode === "denied") throw Error("A non-operator fetched the account directory");
      if (mode === "read-error") return route.fulfill({status:503,json:{error:{code:"SERVICE_UNAVAILABLE",message:"Account directory unavailable."}}});
      const q = url.searchParams.get("q") ?? "", after = url.searchParams.get("after") ?? "", status = url.searchParams.get("status");
      queries.push({q,after,status});
      const filtered = members.filter(item => item.user_id > after && (!status || item.status === status) && `${item.email} ${item.user_id}`.toLowerCase().includes(q.toLowerCase()));
      const items = filtered.slice(0,25);
      return respond({items,...(filtered.length > 25 ? {next_cursor:items.at(-1).user_id} : {})});
    }
    if (p === "/api/v1/operator/grants") {
      if (request.method() === "GET") return respond({items:[...grants.values()].filter(item => item.user_id === url.searchParams.get("user_id"))});
      const body = request.postDataJSON();
      if ("actor" in body || body.user_id !== members[34].user_id || body.feature !== "backtest" || new Date(body.valid_until) <= new Date()) throw Error("Incorrect grant target or scope");
      writes.push({method:"POST",body});
      if (mode === "write-error") return route.fulfill({status:503,json:{error:{code:"SERVICE_UNAVAILABLE",message:"Grant could not be saved."}}});
      const item = {...body,active:true,revoked_at:null,updated_at:now};
      grants.set(`${body.user_id}:${body.feature}`,item);
      return respond(item);
    }
    if (p.startsWith("/api/v1/operator/grants/") && request.method() === "DELETE") {
      const parts = p.split("/"), key = `${parts.at(-2)}:${parts.at(-1)}`;
      writes.push({method:"DELETE",body:request.postDataJSON()});
      const item = grants.get(key);
      if (!item) throw Error("Unknown grant was revoked");
      grants.set(key,{...item,active:false,revoked_at:now});
      return route.fulfill({status:204});
    }
    if (p.startsWith("/api/v1/workspace/") && request.method() === "PUT") { const body=request.postDataJSON();return respond({kind:p.split("/").at(-1),data:body.data,version:(body.version??0)+1,updated_at:now}); }
    return respond({items:[]});
  });
  async function ready() {
    await page.goto(`${origin}/#app/admin`); await page.reload();
    await page.getByRole("table",{name:"Registered accounts",exact:true}).waitFor({timeout:15000});
  }
  async function search(text) {
    await page.getByLabel("Search by email or User ID",{exact:true}).fill(text);
    await page.getByRole("button",{name:"Search accounts",exact:true}).click();
    await page.getByRole("table",{name:"Registered accounts",exact:true}).waitFor();
  }
  for (const width of [1440,390]) for (const theme of ["dark","light"]) {
    mode="healthy"; grants.clear();
    await page.setViewportSize({width,height:1000}); await ready();
    if (await page.locator("html").getAttribute("data-theme") !== theme) await page.getByRole("button",{name:/Switch to .* mode/}).click();
    if (width===1440 && theme==="dark") {
      await page.getByRole("button",{name:"Next accounts",exact:true}).click();
      await page.getByRole("button",{name:"Select member35@example.test",exact:true}).waitFor();
      await page.getByRole("button",{name:"Previous accounts",exact:true}).click();
      await page.getByRole("button",{name:"Select member1@example.test",exact:true}).waitFor();
    }
    await search("MEMBER35@");
    if (queries.at(-1).q!=="MEMBER35@" || queries.at(-1).after) throw Error("Search retained an old page cursor");
    const selectMember = page.getByRole("button",{name:"Select member35@example.test",exact:true});
    if (theme === "light") { await selectMember.focus(); await selectMember.press("Enter"); }
    else await selectMember.click();
    await page.getByText("No direct feature grants",{exact:true}).waitFor();
    await page.getByLabel("Feature",{exact:true}).click();
    await page.getByRole("option",{name:"Backtest",exact:true}).click();
    await page.getByRole("button",{name:"7 days",exact:true}).click();
    const end = new Date(await page.getByLabel("Access expires",{exact:true}).inputValue()).valueOf();
    if (Math.abs(end-Date.now()-7*86400000)>120000) throw Error("Access preset used the wrong timezone or duration");
    await page.getByLabel("Reason for this change",{exact:true}).fill("Approved synthetic testing access");
    const before = writes.length;
    await page.getByRole("button",{name:"Review access grant",exact:true}).click();
    await page.locator(".admin-confirm-details").getByText("member35@example.test",{exact:true}).waitFor();
    if (writes.length!==before) throw Error("Review granted access before confirmation");
    await page.getByRole("button",{name:"Cancel",exact:true}).click();
    if (writes.length!==before) throw Error("Cancelling a review mutated access");
    await page.getByRole("button",{name:"Review access grant",exact:true}).click();
    await page.getByRole("button",{name:"Confirm change",exact:true}).dblclick();
    await page.locator(".admin-ledger").getByRole("cell",{name:"Active",exact:true}).waitFor();
    if (writes.length!==before+1) throw Error("Confirm submitted a duplicate grant");
    if (await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)) throw Error(`Page overflow at ${width}px`);
    await page.evaluate(()=>{ window.getSelection()?.removeAllRanges(); document.querySelectorAll('[data-slot="table-container"]').forEach(el=>el.scrollLeft=0); window.scrollTo(0,0); });
    await page.screenshot({path:`output/playwright/admin-access-${width}-${theme}.png`,fullPage:true});
    await page.getByLabel("Reason for this change",{exact:true}).fill("End synthetic test access");
    await page.getByRole("button",{name:"Review revocation",exact:true}).click();
    await page.getByRole("button",{name:"Confirm change",exact:true}).click();
    await page.getByRole("cell",{name:"Revoked",exact:true}).waitFor();
    if (writes.at(-1).method!=="DELETE") throw Error("Revocation used the wrong endpoint");
  }
  mode="healthy"; await ready();
  await page.getByLabel("Account status",{exact:true}).click();
  await page.getByRole("option",{name:"Suspended",exact:true}).click();
  await page.getByRole("button",{name:"Search accounts",exact:true}).click();
  await page.getByRole("button",{name:"Select member34@example.test",exact:true}).waitFor();
  if (await page.getByRole("button",{name:"Select member35@example.test",exact:true}).count()) throw Error("Status filter was not applied");
  await page.getByLabel("Account status",{exact:true}).click();
  await page.getByRole("option",{name:"All accounts",exact:true}).click();
  await search("not-present@example.test");
  await page.getByText("No accounts found. Try a different email or status.",{exact:true}).waitFor();
  await search("member35@");
  await page.getByRole("button",{name:"Select member35@example.test",exact:true}).click();
  await page.getByRole("cell",{name:"Revoked",exact:true}).waitFor();
  await page.getByLabel("Feature",{exact:true}).click();
  await page.getByRole("option",{name:"Backtest",exact:true}).click();
  await page.getByLabel("Reason for this change",{exact:true}).fill("Synthetic failed write");
  mode="write-error";
  const beforeFailure = writes.length;
  await page.getByRole("button",{name:"Review access grant",exact:true}).click();
  await page.getByRole("button",{name:"Confirm change",exact:true}).click();
  await page.getByRole("region",{name:"Notifications",exact:true}).getByText("The service is temporarily unavailable. Try again shortly.",{exact:true}).waitFor();
  if (writes.length!==beforeFailure+1 || grants.get(`${members[34].user_id}:backtest`).active) throw Error("Failed write retried or changed access");
  mode="healthy";
  await search("member1@");
  await page.getByRole("button",{name:"Select member1@example.test",exact:true}).click();
  await page.getByText("No direct feature grants",{exact:true}).waitFor();
  if (await page.getByRole("button",{name:"Confirm change",exact:true}).count()) throw Error("Pending change survived selecting another member");
  mode="read-error";
  await page.getByRole("button",{name:"Refresh accounts",exact:true}).click();
  await page.getByRole("button",{name:"Retry account list",exact:true}).waitFor();
  mode="healthy";
  await page.getByRole("button",{name:"Retry account list",exact:true}).click();
  await page.getByRole("table",{name:"Registered accounts",exact:true}).waitFor();
  mode="denied"; const beforeDenied=accountReads; await page.reload();
  await page.getByRole("alert").filter({hasText:"This account does not have active operator access."}).waitFor();
  if (accountReads!==beforeDenied || await page.getByRole("region",{name:"Account directory",exact:true}).count()) throw Error("Non-operator access exposed the directory");
  if (!(await page.getByRole("button",{name:"Review access grant",exact:true}).isDisabled())) throw Error("A non-operator can grant access");
  if (errors.length) throw Error(errors.join("; "));
  await page.evaluate(()=>document.body.setAttribute("data-signalgen-admin-tests","complete"));
  return {synthetic:true,queries:queries.length,writes:writes.length,widths:[1440,390],themes:["dark","light"]};
}
