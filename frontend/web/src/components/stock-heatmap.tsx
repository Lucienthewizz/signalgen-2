import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { heatmapHeight, heatmapLayout, heatmapTone } from "@/lib/stock-heatmap";
import { formatSignedPercent } from "@/lib/market-monitor";
import "./stock-heatmap.css";

export type HeatmapStock = {
  ticker: string;
  name: string;
  change: number | null;
  timestamp?: string;
  stale: boolean;
  icon: ReactNode;
};

export function StockHeatmap({
  stocks,
  selected,
  onSelect,
  hidden,
}: {
  stocks: HeatmapStock[];
  selected: string;
  onSelect: (ticker: string) => void;
  hidden: boolean;
}) {
  const canvas = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(1000);
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element || hidden) return;
    const measure = (next: number) => {
      if (next > 0)
        setWidth((previous) =>
          Math.abs(previous - next) >= 1 ? next : previous,
        );
    };
    measure(element.getBoundingClientRect().width);
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => measure(entry.contentRect.width));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [hidden]);
  const height = heatmapHeight(stocks.length, width);
  const rects = heatmapLayout(
    stocks.length,
    width,
    height,
    stocks.map((stock) => stock.change),
  );
  return (
    <section
      className="stock-heatmap"
      id="monitor-stock-lineup"
      hidden={hidden}
      aria-label="Stock heatmap"
    >
      <header className="stock-heatmap__heading">
        <div>
          <strong>Stock heatmap</strong>
          <span>
            Size follows absolute price change · screening snapshots, not live
          </span>
        </div>
        <div className="stock-heatmap__legend" aria-label="Price change legend">
          <span data-direction="loss">−3% or less</span>
          <span>0%</span>
          <span data-direction="gain">+3% or more</span>
        </div>
      </header>
      <nav
        ref={canvas}
        className="stock-heatmap__canvas"
        aria-label="Stock selection"
        style={{ height }}
      >
        {stocks.map((stock, index) => {
          const box = rects[index],
            active = selected === stock.ticker;
          const tone = heatmapTone(stock.change);
          const ChangeIcon =
            stock.change == null || Math.abs(stock.change) < 0.005
              ? Minus
              : stock.change > 0
                ? ArrowUpRight
                : ArrowDownRight;
          return (
            <button
              key={stock.ticker}
              type="button"
              className="stock-heatmap__tile"
              data-tone={tone}
              data-dense={
                Math.min(
                  (box.width * width) / 100,
                  (box.height * height) / 100,
                ) < 100
                  ? "true"
                  : undefined
              }
              data-compact={
                (box.width * width) / 100 < 140 ||
                (box.height * height) / 100 < 120
                  ? "true"
                  : undefined
              }
              aria-pressed={active}
              onClick={() => onSelect(stock.ticker)}
              aria-label={`${stock.ticker}, ${stock.name}, ${stock.change == null ? "price change unavailable" : `${formatSignedPercent(stock.change)} open to close`}${stock.stale ? ", older snapshot" : ""}`}
              title={`${stock.name}\n${stock.change == null ? "Run screener to populate price change" : `Open to close: ${formatSignedPercent(stock.change)}`}${stock.timestamp ? `\nCandle: ${stock.timestamp}` : ""}${stock.stale ? "\nOlder snapshot" : ""}`}
              style={{
                left: `${box.x}%`,
                top: `${box.y}%`,
                width: `${box.width}%`,
                height: `${box.height}%`,
              }}
            >
              {active && (
                <Check className="stock-heatmap__selected" aria-hidden="true" />
              )}
              <span className="stock-heatmap__mark" aria-hidden="true">
                {stock.icon}
              </span>
              <strong>{stock.ticker}</strong>
              <span className="stock-heatmap__change">
                {stock.change != null && <ChangeIcon aria-hidden="true" />}
                {formatSignedPercent(stock.change)}
              </span>
              <small>{stock.name}</small>
              {stock.change == null ? (
                <span className="stock-heatmap__note">No price data</span>
              ) : stock.stale ? (
                <span className="stock-heatmap__note">Older snapshot</span>
              ) : null}
            </button>
          );
        })}
      </nav>
      <p className="stock-heatmap__hint">
        Select a stock to update the chart and details. Tile colors compare each
        stock’s own screening candle; dates and intervals may differ. Larger
        moves get more area, with a minimum area reserved to keep small or
        missing values readable.
      </p>
    </section>
  );
}
