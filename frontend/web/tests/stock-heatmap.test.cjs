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
test("heatmap avoids narrow strips and abrupt breakpoint height changes", () => {
  for (const count of [1, 3, 10, 30])
    for (const width of [284, 350, 599, 600, 601, 880, 1200]) {
      const height = heatmap.heatmapHeight(count, width);
      const tiles = heatmap.heatmapLayout(count, width, height);
      assert.ok(
        tiles.every(
          (tile) =>
            (tile.width * width) / 100 >= 80 &&
            (tile.height * height) / 100 >= 75,
        ),
      );
      assert.ok(
        Math.abs(height - heatmap.heatmapHeight(count, width + 1)) <= 6,
      );
    }
  assert.equal(heatmap.heatmapLayout(10, NaN, 200).length, 0);
});
test("scenario: negative red, positive green, larger absolute change means larger area", () => {
  const changes = [10, -10, 5, -5, 2, -2, 1, -1, 0, null];
  const weights = heatmap.heatmapWeights(changes);
  for (const [width, height] of [
    [1200, 300],
    [350, 500],
  ]) {
    const tiles = heatmap.heatmapLayout(changes.length, width, height, changes);
    const areas = tiles.map((tile) => tile.width * tile.height);
    for (let i = 0; i < 8; i += 2) {
      assert.ok(heatmap.heatmapTone(changes[i]).startsWith("gain"));
      assert.ok(heatmap.heatmapTone(changes[i + 1]).startsWith("loss"));
      assert.ok(Math.abs(areas[i] - areas[i + 1]) < 0.000001);
      if (i < 6) assert.ok(areas[i] > areas[i + 2]);
    }
    assert.ok(areas[6] > areas[8]);
    for (let i = 0; i < tiles.length; i++)
      assert.ok(Math.abs(areas[i] - weights[i] * 10000) < 0.000001);
  }
});
test("weighted scenarios keep all stocks inside the canvas with clickable targets", () => {
  for (const count of [3, 10, 30])
    for (const width of [284, 350, 600, 1200]) {
      for (const changes of [
        Array.from({ length: count }, (_, i) => (i % 2 ? -i : i)),
        Array.from({ length: count }, (_, i) => (i === 0 ? 1000 : 0)),
      ]) {
        const height = heatmap.heatmapHeight(count, width),
          tiles = heatmap.heatmapLayout(count, width, height, changes);
        for (const [index, tile] of tiles.entries()) {
          assert.ok(
            (tile.width * width) / 100 >= 44 &&
              (tile.height * height) / 100 >= 44,
            JSON.stringify({ count, width, index, tile, height }),
          );
          for (const other of tiles.slice(index + 1))
            assert.ok(
              Math.min(tile.x + tile.width, other.x + other.width) -
                Math.max(tile.x, other.x) <
                0.000001 ||
                Math.min(tile.y + tile.height, other.y + other.height) -
                  Math.max(tile.y, other.y) <
                  0.000001,
            );
        }
      }
    }
});
