const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const exportsForTest = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, "../src/lib/stock-catalog.ts"),
      "utf8",
    ),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    },
  ).outputText,
  { exports: exportsForTest },
);
const {
  catalogPage,
  catalogPageSize,
  universeSelectionLimit,
  stockCategories,
  stockInCategory,
  stockGroupLabel,
} = exportsForTest;
const stocks = [
  {
    symbol: "ASII.JK",
    name: "Astra International Tbk",
    exchange: "XIDX",
    currency: "IDR",
  },
  {
    symbol: "BBCA.JK",
    name: "Bank Central Asia Tbk",
    exchange: "XIDX",
    currency: "IDR",
  },
  {
    symbol: "BBRI.JK",
    name: "Bank Rakyat Indonesia Tbk",
    exchange: "XIDX",
    currency: "IDR",
  },
];

test("US categories use market-specific ticker membership, not IDX collisions", () => {
  const us = (symbol) => ({ symbol, name: symbol, exchange: "XNAS", currency: "USD" });
  for (const [symbol, category] of [["AAPL", "technology"], ["JPM", "banks"], ["XOM", "energy"], ["PG", "consumer"], ["PLD", "property"], ["MSFT", "blue-chip"]]) assert.equal(stockInCategory(us(symbol), category), true, symbol);
  assert.equal(stockInCategory(us("AGRO"), "banks"), false);
  assert.equal(stockInCategory(us("BBSI"), "banks"), false);
  assert.equal(stockInCategory(us("GOOD"), "consumer"), false);
  assert.equal(stockGroupLabel(us("GOOD")), "Property");
  assert.equal(stockGroupLabel(us("AGRO")), "Consumer");
  assert.equal(stockGroupLabel({ ...us("AGRO.JK"), exchange: "XIDX", currency: "IDR" }), "Banks");
  assert.equal(stockGroupLabel({ ...us("GOOD.JK"), exchange: "XIDX", currency: "IDR" }), "Consumer");
  assert.equal(stockGroupLabel(us("UNKNOWN")), "—");
  assert.equal(catalogPage([us("AAPL"), us("JPM")], "", 0, "banks").items[0].symbol, "JPM");
});

test("catalog searches any IDX code/name, not a three-stock hardcoded union", () => {
  assert.equal(catalogPage(stocks, "  asii ", 0).items[0].symbol, "ASII.JK");
  assert.equal(catalogPage(stocks, "bank asia", 0).items[0].symbol, "BBCA.JK");
  assert.equal(catalogPage(stocks, "bank", 0).totalMatches, 2);
  assert.equal(catalogPage(stocks, "notfound", 0).totalMatches, 0);
  assert.equal(catalogPage([], "", 100).page, 0);
});

test("a 962-item catalog renders only a bounded page and preserves input", () => {
  // Deliberately synthetic metadata for pagination tests, not market coverage.
  const catalog = Array.from({ length: 962 }, (_, i) => ({
    ...stocks[0],
    symbol: `TEST${i}.JK`,
    name: `Fixture ${i}`,
  }));
  const before = JSON.stringify(catalog);
  const first = catalogPage(catalog, "", 0);
  const last = catalogPage(catalog, "", 1000);
  assert.equal(first.items.length, catalogPageSize);
  assert.equal(first.totalMatches, 962);
  assert.equal(last.items.length, 2);
  assert.equal(last.page, 80);
  assert.equal(catalogPage(catalog, "", -10).page, 0);
  assert.equal(catalogPage(catalog, "", NaN).page, 0);
  assert.equal(catalogPage(catalog, "fixture 961", 80).page, 0);
  assert.equal(JSON.stringify(catalog), before);
});

test("category shortcuts intersect the available catalog and search", () => {
  assert.equal(stockCategories.length, 7);
  assert.equal(catalogPage(stocks, "", 0, "banks").totalMatches, 2);
  assert.equal(
    catalogPage(stocks, "asia", 50, "banks").items[0].symbol,
    "BBCA.JK",
  );
  assert.equal(catalogPage(stocks, "", 0, "blue-chip").totalMatches, 3);
  assert.equal(catalogPage(stocks, "", 0, "energy").totalMatches, 0);
  assert.equal(stockInCategory(stocks[0], "banks"), false);
  assert.equal(stockGroupLabel(stocks[1]), "Banks");
  assert.equal(stockGroupLabel(stocks[0]), "—");
  assert.equal(
    stockInCategory({ ...stocks[0], symbol: "MADEUP.JK" }, "blue-chip"),
    false,
  );
});

test("picker integrates search, persistent selection, loading and pagination", () => {
  assert.equal(universeSelectionLimit, 10);
  const panel = fs.readFileSync(
    path.join(__dirname, "../src/pages/workspace-resource-panels.tsx"),
    "utf8",
  );
  const picker = fs.readFileSync(
    path.join(__dirname, "../src/components/stock-catalog-picker.tsx"),
    "utf8",
  );
  assert.ok(panel.includes("<StockCatalogPicker"));
  assert.ok(picker.includes('type="search"'));
  assert.ok(picker.includes("aria-pressed={active}"));
  assert.ok(picker.includes("result.items.map"));
  assert.ok(picker.includes("selected.map"));
  assert.ok(picker.includes("aria-busy={loading}"));
  assert.ok(picker.includes("full && !active"));
  assert.ok(picker.includes('aria-label="Stock catalog"'));
  assert.ok(picker.includes('aria-label="Stock categories"'));
  assert.ok(panel.includes('className="universe-workspace"'));
});

test("US catalog search covers thousands of entries while selection stays ten", () => {
  const catalog = Array.from({ length: 7000 }, (_, i) => ({
    symbol: `FIX${i}`,
    name: `Synthetic US company ${i}`,
    exchange: i % 2 ? "XNAS" : "XNYS",
    currency: "USD",
  }));
  const result = catalogPage(catalog, "FIX6999", 0);
  assert.equal(result.totalMatches, 1);
  assert.equal(result.items[0].symbol, "FIX6999");
  assert.equal(catalogPage(catalog, "", 0).items.length, catalogPageSize);
  assert.equal(universeSelectionLimit, 10);
});
