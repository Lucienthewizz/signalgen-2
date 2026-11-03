const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
require("./helpers/query-core.cjs");

function cache(t) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(`${__dirname}/../src/api/ui-cache.ts`, "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText, {exports, require, structuredClone, AbortController, Date});
  t.after(() => exports.clearUiCache());
  return exports;
}

test("fresh reads share one request across pages and cloned snapshots protect forms", async t => {
  const c=cache(t);let requests=0;
  const load=async()=>{requests++;return {items:[{id:"saved-rule",name:"Original"}]};};
  const [a,b]=await Promise.all([c.loadUiResource(1,"owner-a","rules",load),c.loadUiResource(1,"owner-a","rules",load)]);
  a.items[0].name="Unsaved edit";
  assert.equal(b.items[0].name,"Original");
  assert.equal(c.peekUiResource(1,"owner-a","rules").items[0].name,"Original");
  await c.loadUiResource(1,"owner-a","rules",load);
  assert.equal(requests,1);
});

test("owner and login revision isolate data, even if a provider reuses a token", async t => {
  const c=cache(t);
  await c.loadUiResource(1,"owner-a","rules",async()=>({items:["private-a"]}));
  assert.equal(c.peekUiResource(1,"owner-b","rules"),undefined);
  assert.equal(c.peekUiResource(2,"owner-a","rules"),undefined);
  c.clearUiCache();
  assert.equal(c.peekUiResource(1,"owner-a","rules"),undefined);
});

test("stale data stays available during revalidation; TTL and explicit refresh fetch new data", async t => {
  t.mock.timers.enable({apis:["Date"],now:Date.now()});
  const c=cache(t);let calls=0,release;
  const load=async()=>({items:[++calls]});
  await c.loadUiResource(1,"a","rules",load);
  t.mock.timers.tick(30_001);
  const refresh=c.loadUiResource(1,"a","rules",()=>new Promise(r=>{release=r;}));
  assert.deepEqual(c.peekUiResource(1,"a","rules"),{items:[1]});
  release({items:[2]});await refresh;
  await c.loadUiResource(1,"a","rules",load,true);
  assert.equal(calls,2);
});

test("writes cancel older reads so late responses cannot restore deleted data", async t => {
  const c=cache(t);let release,signal;
  const pending=c.loadUiResource(1,"a","rules",s=>{signal=s;return new Promise(r=>{release=r;});});
  const rejected=assert.rejects(pending);
  c.invalidateUiCache("/api/v1/rules/removed");
  assert.equal(signal.aborted,true);
  release({items:["deleted-rule"]});await rejected;
  assert.equal(c.peekUiResource(1,"a","rules"),undefined);
  assert.deepEqual(await c.loadUiResource(1,"a","rules",async()=>({items:[]})),{items:[]});
});

test("logout cancels reads; failed refresh retains last data and does not add retries", async t => {
  const c=cache(t);let release,signal;
  const pending=c.loadUiResource(1,"a","universes",s=>{signal=s;return new Promise(r=>{release=r;});});
  const rejected=assert.rejects(pending);c.clearUiCache();
  assert.equal(signal.aborted,true);release({items:["old-account"]});await rejected;
  assert.equal(c.peekUiResource(1,"a","universes"),undefined);
  await c.loadUiResource(2,"b","universes",async()=>({items:["b"]}));
  let attempts=0;await assert.rejects(c.loadUiResource(2,"b","universes",async()=>{attempts++;throw Error("offline");},true));
  assert.equal(attempts,1);
  assert.deepEqual(c.peekUiResource(2,"b","universes"),{items:["b"]});
});
