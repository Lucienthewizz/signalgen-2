import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Info,
  X,
} from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { heatmapHeight, heatmapLayout, heatmapTone } from "@/lib/stock-heatmap";
import { formatSignedPercent } from "@/lib/market-monitor";
import "./stock-heatmap.css";

export type HeatmapStock = {
  ticker: string;
  name: string;
  change: number | null;
  open?: number;
  close?: number;
  timestamp?: string;
  stale: boolean;
  icon: ReactNode;
};

export function StockHeatmap({
  stocks,
  selected,
  onSelect,
  hidden,
  preview = false,
  onScreen,
  screenLabel = "Screen this universe",
}: {
  stocks: HeatmapStock[];
  selected: string;
  onSelect: (ticker: string) => void;
  hidden: boolean;
  preview?: boolean;
  onScreen?: () => void;
  screenLabel?: string;
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
            {preview
              ? "Simulated values · no data is saved"
              : "Screening snapshots · not live"}
          </span>
        </div>
        <div className="stock-heatmap__legend" aria-label="Price change legend">
          <span data-direction="loss">−3% or less</span>
          <span>0%</span>
          <span data-direction="gain">+3% or more</span>
        </div>
        <Popover.Root>
          <Popover.Trigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="How the heatmap works"
              />
            }
          >
            <Info />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner
              className="heatmap-popover-positioner"
              sideOffset={8}
              collisionPadding={12}
            >
              <Popover.Popup className="heatmap-popover">
                <Popover.Title>How the heatmap works</Popover.Title>
                <Popover.Description>
                  Larger absolute price moves get more area. Green means a rise,
                  red a fall. Small or missing values keep a minimum clickable
                  area. Snapshot dates and intervals may differ; these are not
                  live quotes.
                </Popover.Description>
                <Popover.Close render={<Button variant="ghost" size="sm" />}>
                  Close
                </Popover.Close>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </header>
      {preview && (
        <div className="stock-heatmap__preview" role="status">
          <Badge variant="outline">TEST PREVIEW</Badge>
          <span>
            Simulated ±1%, ±2%, ±5%, ±10%, zero and missing data. Chart, account
            history and screening results are unchanged.
          </span>
        </div>
      )}
      {!preview && stocks.some((stock) => stock.change === null) && (
        <div className="stock-heatmap__empty">
          <span>
            {stocks.filter((stock) => stock.change === null).length}{" "}
            {stocks.filter((stock) => stock.change === null).length === 1
              ? "stock has"
              : "stocks have"}{" "}
            no price snapshot yet.
          </span>
          {onScreen && (
            <Button variant="outline" size="sm" onClick={onScreen}>
              {screenLabel}
            </Button>
          )}
        </div>
      )}
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
            <Popover.Root key={stock.ticker}>
              <Popover.Trigger
                openOnHover
                delay={150}
                closeDelay={100}
                render={<button type="button" />}
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
                  (box.height * height) / 100 < 180
                    ? "true"
                    : undefined
                }
                aria-pressed={active}
                onClick={() => onSelect(stock.ticker)}
                aria-label={`${stock.ticker}, ${stock.name}, ${stock.change == null ? "price change unavailable" : `${formatSignedPercent(stock.change)} open to close`}${stock.stale ? ", older snapshot" : ""}`}
                style={{
                  left: `${box.x}%`,
                  top: `${box.y}%`,
                  width: `${box.width}%`,
                  height: `${box.height}%`,
                }}
              >
                {active && (
                  <Check
                    className="stock-heatmap__selected"
                    aria-hidden="true"
                  />
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
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner
                  className="heatmap-popover-positioner"
                  sideOffset={8}
                  collisionPadding={12}
                >
                  <Popover.Popup
                    className="heatmap-popover"
                    data-preview={preview || undefined}
                  >
                    <div className="heatmap-popover__title">
                      <Popover.Title>
                        {stock.ticker} · {stock.name}
                      </Popover.Title>
                      <Popover.Close
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Close stock details"
                          />
                        }
                      >
                        <X />
                      </Popover.Close>
                    </div>
                    <Popover.Description>
                      {preview
                        ? "Simulation only · not market data"
                        : "Latest screening candle · not live"}
                    </Popover.Description>
                    <dl>
                      <div>
                        <dt>Open</dt>
                        <dd>{stock.open?.toLocaleString("en-GB") ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Close</dt>
                        <dd>{stock.close?.toLocaleString("en-GB") ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Change</dt>
                        <dd>{formatSignedPercent(stock.change)}</dd>
                      </div>
                    </dl>
                    <p>
                      {stock.timestamp ??
                        "No snapshot. Screen this universe to fetch data."}
                      {stock.stale ? " · Older snapshot" : ""}
                    </p>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          );
        })}
      </nav>
    </section>
  );
}
