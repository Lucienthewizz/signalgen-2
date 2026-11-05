export type HeatmapRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// Reserve half of the canvas equally for legibility; distribute the other half
// by absolute price change. Equal +/− moves get equal areas, missing stays neutral.
export function heatmapWeights(changes: readonly (number | null)[]): number[] {
  if (!changes.length) return [];
  const values = changes.map((value) =>
    value != null && Number.isFinite(value) ? Math.abs(value) : 0,
  );
  const maximum = Math.max(...values);
  if (!maximum) return values.map(() => 1 / values.length);
  const scaled = values.map((value) => value / maximum);
  const total = scaled.reduce((sum, value) => sum + value, 0);
  return scaled.map((value) => 0.5 / values.length + (0.5 * value) / total);
}

// Source-order results keep React identities intact even when weighted positions
// change. Balanced strips remain preferable when every stock has the same weight.
export function heatmapLayout(
  count: number,
  width: number,
  height: number,
  changes?: readonly (number | null)[],
): HeatmapRect[] {
  if (
    !Number.isInteger(count) ||
    count <= 0 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return [];
  const weights = heatmapWeights(
    changes?.length === count ? changes : Array(count).fill(null),
  );
  if (weights.some((weight) => Math.abs(weight - weights[0]) > 1e-12)) {
    const result: HeatmapRect[] = Array(count);
    const items = weights
      .map((weight, index) => ({ weight, index }))
      .sort((a, b) => b.weight - a.weight || a.index - b.index);
    function split(group: typeof items, box: HeatmapRect) {
      if (group.length === 1) {
        result[group[0].index] = box;
        return;
      }
      const total = group.reduce((sum, item) => sum + item.weight, 0);
      let amount = 0,
        best = 1,
        error = Infinity,
        subtotal = 0;
      for (let i = 1; i < group.length; i++) {
        amount += group[i - 1].weight;
        if (Math.abs(amount - total / 2) < error) {
          error = Math.abs(amount - total / 2);
          best = i;
          subtotal = amount;
        }
      }
      const ratio = subtotal / total;
      if (box.width * width >= box.height * height) {
        split(group.slice(0, best), { ...box, width: box.width * ratio });
        split(group.slice(best), {
          ...box,
          x: box.x + box.width * ratio,
          width: box.width * (1 - ratio),
        });
      } else {
        split(group.slice(0, best), { ...box, height: box.height * ratio });
        split(group.slice(best), {
          ...box,
          y: box.y + box.height * ratio,
          height: box.height * (1 - ratio),
        });
      }
    }
    split(items, { x: 0, y: 0, width: 100, height: 100 });
    return result;
  }
  const tiles: HeatmapRect[] = [];
  // Balanced strips avoid the thin slivers produced by recursive bisection.
  // Each row's height follows its stock count, retaining equal tile areas.
  const rows = Math.min(
    count,
    Math.max(1, Math.round(Math.sqrt((count * height) / width))),
  );
  let y = 0;
  for (let row = 0; row < rows; row++) {
    const columns = Math.floor(count / rows) + (row < count % rows ? 1 : 0);
    const rowHeight = (100 * columns) / count;
    for (let column = 0; column < columns; column++) {
      tiles.push({
        x: (column * 100) / columns,
        y,
        width: 100 / columns,
        height: rowHeight,
      });
    }
    y += rowHeight;
  }
  return tiles;
}

export function heatmapHeight(count: number, width: number): number {
  // Continuous sizing removes the 160px jump at the old 600px breakpoint.
  return Math.max(
    count <= 3 ? 160 : 240,
    Math.min(1200, Math.round((count * 16_000) / Math.max(280, width))),
  );
}

export function heatmapTone(change: number | null): string {
  if (change == null || !Number.isFinite(change)) return "missing";
  if (Math.abs(change) < 0.005) return "flat";
  return `${change > 0 ? "gain" : "loss"}-${Math.abs(change) >= 3 ? "strong" : Math.abs(change) >= 1 ? "medium" : "soft"}`;
}
