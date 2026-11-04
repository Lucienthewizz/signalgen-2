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
  if (!Number.isInteger(count) || count <= 0 || width <= 0 || height <= 0)
    return [];
  const tiles: HeatmapRect[] = [];
  function split(n: number, x: number, y: number, w: number, h: number) {
    if (n === 1) {
      tiles.push({ x, y, width: w, height: h });
      return;
    }
    const a = Math.ceil(n / 2),
      fraction = a / n;
    if (w * width >= h * height) {
      split(a, x, y, w * fraction, h);
      split(n - a, x + w * fraction, y, w * (1 - fraction), h);
    } else {
      split(a, x, y, w, h * fraction);
      split(n - a, x, y + h * fraction, w, h * (1 - fraction));
    }
  }
  split(count, 0, 0, 100, 100);
  return tiles;
}

export function heatmapTone(change: number | null): string {
  if (change == null || !Number.isFinite(change)) return "missing";
  if (Math.abs(change) < 0.005) return "flat";
  return `${change > 0 ? "gain" : "loss"}-${Math.abs(change) >= 3 ? "strong" : Math.abs(change) >= 1 ? "medium" : "soft"}`;
}
