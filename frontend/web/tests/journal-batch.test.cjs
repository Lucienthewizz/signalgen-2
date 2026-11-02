const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const exportsUnderTest={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib/journal-batch.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsUnderTest});
const {validateJournalDraft,saveJournalBatch}=exportsUnderTest;
const draft=id=>({id,status:'draft',input:{symbol:'BBCA.JK',market:'IDX',currency:'IDR',side:'BUY',quantity:100,entry_price:1000,entry_fee:10,entry_date:'2026-11-02',book:'Review'}});
test('partial journal saves retry only failed stable UUIDs',async()=>{
 let rows=[draft('one'),draft('two'),draft('three')],calls=[];const update=r=>rows=rows.map(x=>x.id===r.id?r:x),signal=new AbortController().signal;
 await saveJournalBatch(rows,async r=>{calls.push(r.id);if(r.id==='two')throw Error('transient')},signal,update);
 assert.deepEqual(rows.map(r=>r.status),['saved','failed','saved']);
 await saveJournalBatch(rows,async r=>calls.push(r.id),signal,update);
 assert.deepEqual(calls,['one','two','three','two']);assert.ok(rows.every(r=>r.status==='saved'));
});
test('validate all drafts before saving, enforcing quantities, fees and currency',async()=>{
 for(const change of [r=>r.input.quantity=99,r=>r.input.entry_price=0,r=>r.input.entry_fee=-1,r=>r.input.quantity=NaN,r=>r.input.currency='USD']){
  const bad=draft('bad');change(bad);assert.ok(validateJournalDraft(bad.input));let calls=0;
  await assert.rejects(saveJournalBatch([draft('valid'),bad],async()=>calls++,new AbortController().signal,()=>{}));assert.equal(calls,0);
 }
});
test('revocation and cancellation stop a batch, while conflicts remain per-row',async()=>{
 let saved=[];await assert.rejects(saveJournalBatch([draft('one'),draft('two')],async()=>{const e=Error('revoked');e.status=403;throw e},new AbortController().signal,r=>saved.push(r)));
 assert.equal(saved.length,1);assert.equal(saved[0].status,'failed');
 const controller=new AbortController();saved=[];await assert.rejects(saveJournalBatch([draft('one'),draft('two')],async()=>controller.abort(),controller.signal,r=>saved.push(r)));assert.equal(saved.length,0);
});
