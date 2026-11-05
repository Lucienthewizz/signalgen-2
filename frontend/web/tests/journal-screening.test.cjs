const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const api = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, "../src/lib/journal-screening.ts"),
      "utf8",
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  { exports: api },
);
function fixture() {
  return {
    ownerId: "owner",
    symbol: "BBCA.JK",
    screenedAt: "2026-10-21T08:00:00Z",
    run: {
      manifest: { currency: "IDR" },
      rows: [
        {
          decision: {
            symbol: "BBCA.JK",
            matched: true,
            timestamp: "2026-10-21T07:00:00Z",
            signal_type: "BUY",
          },
          latestClose: 100,
          features: { price: 100, ema9: 99, ema20: 98, rsi14: 60 },
        },
      ],
    },
  };
}
test("saving requires a server receipt for a matched result from this account", () => {
  const draft = fixture();
  assert.equal(api.journalScreeningReceipt(draft, "owner"), null);
  draft.run.rows[0].decision.journal_receipt = "synthetic-signed-receipt";
  assert.equal(api.journalScreeningReceipt(draft, "owner"), "synthetic-signed-receipt");
  assert.equal(api.journalScreeningReceipt(draft, "other"), null);
  draft.run.rows[0].decision.matched = false;
  assert.equal(api.journalScreeningReceipt(draft, "owner"), null);
});
test("only matched valid snapshots from the current account can be verified", () => {
  const draft = fixture();
  assert.equal(api.checkJournalScreening(draft, "owner").ok, true);
  assert.equal(api.checkJournalScreening(draft, "other").ok, false);
  assert.equal(api.checkJournalScreening(draft).ok, false);
  draft.run.rows[0].decision.matched = false;
  assert.equal(api.checkJournalScreening(draft, "owner").ok, false);
});
test("missing price, symbol, indicator or candle time does not produce a success", () => {
  for (const corrupt of [
    (d) => (d.symbol = "MISSING"),
    (d) => (d.run.rows[0].latestClose = NaN),
    (d) => (d.run.rows[0].features.rsi14 = NaN),
    (d) => (d.run.rows[0].decision.timestamp = "invalid"),
    (d) => (d.run.manifest.currency = "UNKNOWN"),
  ]) {
    const draft = fixture();
    corrupt(draft);
    assert.equal(api.checkJournalScreening(draft, "owner").ok, false);
  }
});
test("bulk selection accepts only explicit directions and matching market/currency",()=>{
 const draft=fixture();draft.run.manifest.market="IDX";
 assert.equal(api.eligibleJournalScreening(draft,"owner"),true);
 delete draft.run.rows[0].decision.signal_type;assert.equal(api.eligibleJournalScreening(draft,"owner"),false);
 draft.run.rows[0].decision.signal_type="SELL";draft.run.manifest.currency="USD";assert.equal(api.eligibleJournalScreening(draft,"owner"),false);
 draft.run.manifest.market="US";assert.equal(api.eligibleJournalScreening(draft,"owner"),true);assert.equal(api.eligibleJournalScreening(draft,"other"),false);
});
