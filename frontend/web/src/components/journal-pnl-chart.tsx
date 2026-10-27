import { useState, useRef, useLayoutEffect } from "react";
import { journalTimeline } from "@/lib/journal";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";

type ChartTrade = {
  id: string;
  closedAt: string;
  pnl: number;
  symbol: string;
  exit: number;
};
const moneyFor = (currency: string) => (value: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
const date = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));

export function JournalPnlChart({
  records,
  currency = "IDR",
}: {
  records: ChartTrade[];
  currency?: string;
}) {
  const money = moneyFor(currency);
  const [selected, setSelected] = useState<number | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const hasRecords = records.length > 0;
  useLayoutEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const measure = () =>
      setWidth(Math.max(640, Math.round(element.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasRecords]);
  const points = journalTimeline(records);
  const low = Math.min(0, ...points.map((point) => point.value));
  const high = Math.max(0, ...points.map((point) => point.value));
  const range = high - low || 1;
  const x = (index: number) =>
    100 + (index / Math.max(1, points.length - 1)) * (width - 130);
  const y = (value: number) =>
    high === low ? 122 : 205 - ((value - low) / range) * 165;
  const active = selected == null ? null : points[selected];
  const describe = (point: (typeof points)[number]) =>
    point.record
      ? `${date(point.record.closedAt)} · ${point.record.symbol} exit ${money(point.record.exit)} · cumulative P&L ${money(point.value)}`
      : `Starting cumulative P&L: ${currency} 0`;
  return (
    <figure className="journal-pnl-chart journal-pnl-chart--dated">
      <figcaption>
        <span>Cumulative realized P&amp;L</span>
        <small>
          {currency} · closed-trade dates · same filters as the table
        </small>
      </figcaption>
      {!records.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No closed trades in this period</EmptyTitle>
            <EmptyDescription>
              Choose another month or clear the filters.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div
            ref={chartRef}
            className="journal-pnl-chart__scroll"
            tabIndex={0}
            role="region"
            aria-label="Realized P&L chart, scroll horizontally on smaller screens"
          >
            <svg
              viewBox={`0 0 ${width} 255`}
              role="img"
              aria-label={`Cumulative realized P&L in ${currency} by closed-trade date`}
            >
              <text x="100" y="20" className="journal-chart-axis-title">
                Cumulative P&amp;L ({currency})
              </text>
              {(high === low ? [0] : [low, (low + high) / 2, high]).map(
                (value, index) => (
                  <g key={index}>
                    <line
                      x1="100"
                      x2={width - 30}
                      y1={y(value)}
                      y2={y(value)}
                    />
                    <text x="88" y={y(value) + 4} textAnchor="end">
                      {money(value)}
                    </text>
                  </g>
                ),
              )}
              <polyline
                points={points
                  .map((point, index) => `${x(index)},${y(point.value)}`)
                  .join(" ")}
              />
              {points.map((point, index) => (
                <g
                  key={point.record?.id ?? "start"}
                  tabIndex={0}
                  role="img"
                  aria-label={describe(point)}
                  onMouseEnter={() => setSelected(index)}
                  onFocus={() => setSelected(index)}
                >
                  <title>{describe(point)}</title>
                  <circle cx={x(index)} cy={y(point.value)} r="4" />
                  {(points.length <= 7 ||
                    index === 0 ||
                    index === points.length - 1) && (
                    <text x={x(index)} y="231" textAnchor="middle">
                      {point.record ? date(point.record.closedAt) : "Start"}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          </div>
          <p className="journal-chart-readout" role="status">
            {active
              ? describe(active)
              : "Hover or focus a point to see the closing price and cumulative P&L."}
          </p>
        </>
      )}
    </figure>
  );
}
