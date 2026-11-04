export type HeatmapRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

// Equal-area treemap: there is no market-cap field in the stock catalog.
// Keep source order stable so price updates never move a selected stock.
export function heatmapLayout(
  count: number,
  width: number,
  height: number,
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
    Math.min(960, Math.round((count * 14_000) / Math.max(280, width))),
  );
}

export function heatmapTone(change: number | null): string {
  if (change == null || !Number.isFinite(change)) return "missing";
  if (Math.abs(change) < 0.005) return "flat";
  return `${change > 0 ? "gain" : "loss"}-${Math.abs(change) >= 3 ? "strong" : Math.abs(change) >= 1 ? "medium" : "soft"}`;
}
