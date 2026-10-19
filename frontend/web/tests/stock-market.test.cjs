const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  ts = require("typescript");
const market = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/lib/stock-market.ts"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText,
  { exports: market, Intl },
);
test("market currency and chart MICs never turn US stocks into IDX or rupiah", () => {
  assert.equal(market.stockMarket({ exchange: "XNAS", currency: "USD" }), "US");
  assert.equal(market.stockMarket({ exchange: "XNYS", currency: "USD" }), "US");
  assert.equal(market.symbolMarket("BBCA.JK"), "IDX");
  assert.equal(
    market.snapshotChartSymbol("AAPL", {
      market: "US",
      symbols: ["AAPL"],
      exchanges: ["XNAS"],
    }),
    "NASDAQ:AAPL",
  );
  assert.equal(
    market.snapshotChartSymbol("BRK-B", {
      market: "US",
      symbols: ["BRK-B"],
      exchanges: ["XNYS"],
    }),
    "NYSE:BRK.B",
  );
  assert.equal(
    market.snapshotChartSymbol("BBCA.JK", {
      market: "IDX",
      symbols: ["BBCA.JK"],
    }),
    "IDX:BBCA",
  );
  assert.equal(market.formatStockPrice(123.4, "USD"), "123,40");
});
