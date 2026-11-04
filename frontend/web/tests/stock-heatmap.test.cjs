const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const heatmap = {};
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(`${__dirname}/../src/lib/stock-heatmap.ts`, "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  { exports: heatmap },
);
test("equal-area heatmap fills its canvas without overlaps at all watchlist sizes", () => {
  for (const [w, h] of [
    [1200, 400],
    [350, 600],
  ])
    for (let n = 1; n <= 30; n++) {
      const tiles = heatmap.heatmapLayout(n, w, h);
      assert.equal(tiles.length, n);
      for (const [i, a] of tiles.entries()) {
        assert.ok(
          a.x >= 0 &&
            a.y >= 0 &&
            a.x + a.width <= 100.000001 &&
            a.y + a.height <= 100.000001,
        );
        assert.ok(Math.abs(a.width * a.height - 10000 / n) < 0.000001);
        for (const b of tiles.slice(i + 1))
          assert.ok(
            Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) <
              0.000001 ||
              Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) <
                0.000001,
          );
      }
      assert.equal(
        JSON.stringify(tiles),
        JSON.stringify(heatmap.heatmapLayout(n, w, h)),
      );
    }
  assert.equal(heatmap.heatmapLayout(0, 100, 100).length, 0);
  assert.equal(heatmap.heatmapLayout(2, 0, 100).length, 0);
});
test("heatmap separates missing, flat, gains and losses without turning unknown into zero", () => {
  for (const value of [null, NaN, Infinity])
    assert.equal(heatmap.heatmapTone(value), "missing");
  assert.equal(heatmap.heatmapTone(0), "flat");
  assert.equal(heatmap.heatmapTone(-0.004), "flat");
  assert.equal(heatmap.heatmapTone(0.5), "gain-soft");
  assert.equal(heatmap.heatmapTone(1), "gain-medium");
  assert.equal(heatmap.heatmapTone(3), "gain-strong");
  assert.equal(heatmap.heatmapTone(-0.5), "loss-soft");
  assert.equal(heatmap.heatmapTone(-1), "loss-medium");
  assert.equal(heatmap.heatmapTone(-3), "loss-strong");
});
