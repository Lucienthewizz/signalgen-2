import { SINGAPORE_TIME_ZONE } from "@/lib/calendar";
import { useState, useRef, useLayoutEffect, useEffect, useMemo } from "react";
import { journalTimeline } from "@/lib/journal";
import { Button } from "@/components/ui/button";
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
  openedAt: string;
  entry: number;
  side: "BUY" | "SELL";
  quantity: number;
  book: string;
  note: string;
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
    timeZone: SINGAPORE_TIME_ZONE,
  }).format(new Date(value));

export function JournalPnlChart({
  records,
  currency = "IDR",
}: {
  records: ChartTrade[];
  currency?: string;
}) {
  const money = moneyFor(currency);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const pointRefs = useRef<Array<SVGGElement | null>>([]);
  const chartRef = useRef<HTMLDivElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(700);
  const hasRecords = records.length > 0;
  useLayoutEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const measure = () =>
      setMeasuredWidth(Math.max(640, Math.round(element.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasRecords]);
  const points = useMemo(() => journalTimeline(records), [records]);
  // Leave room for distinct 44px targets, even for trades sharing a close date.
  const width = Math.max(measuredWidth, (points.length - 1) * 48 + 130);
  const pointId = (point: (typeof points)[number]) =>
    point.record?.id ?? "start";
  const low = Math.min(0, ...points.map((point) => point.value));
  const high = Math.max(0, ...points.map((point) => point.value));
  const range = high - low || 1;
  const x = (index: number) =>
    100 + (index / Math.max(1, points.length - 1)) * (width - 130);
  const y = (value: number) =>
    high === low ? 122 : 205 - ((value - low) / range) * 165;
  const selectedIndex = points.findIndex(
    (point) => pointId(point) === selectedId,
  );
  const selected = points[selectedIndex];
  useEffect(() => {
    if (selectedId && selectedIndex < 0) {
      setSelectedId(null);
      setPreviewId(null);
    }
  }, [selectedId, selectedIndex]);
  const preview = points.find((point) => pointId(point) === previewId);
  const active = preview ?? selected;
  const tabStop = points.some((point) => pointId(point) === focusedId)
    ? focusedId
    : pointId(points[1] ?? points[0]);
  const describe = (
    point: (typeof points)[number],
    index = points.indexOf(point),
  ) =>
    point.record
      ? `Trade ${index} · ${date(point.record.closedAt)} · ${point.record.symbol} · trade P&L ${money(point.record.pnl)} · cumulative P&L ${money(point.value)}`
      : `Starting cumulative P&L: ${currency} 0`;
  const selectPoint = (index: number) => {
    const id = pointId(points[index]);
    setSelectedId(id);
    setFocusedId(id);
  };
  return (
    <figure className="journal-pnl-chart journal-pnl-chart--dated">
      <figcaption>
        <span>Cumulative realized P&amp;L</span>
        <small>
          {currency} · one point per closed trade · same filters as the table
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
              viewBox={`0 0 ${width} 275`}
              style={{ width }}
              role="group"
              aria-label={`Cumulative realized P&L in ${currency}, one point per closed trade`}
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
              <g
                className="journal-chart-selection"
                aria-hidden="true"
                data-visible={Boolean(selected)}
                style={{
                  transform: `translate(${x(Math.max(0, selectedIndex))}px, ${y(selected?.value ?? 0)}px)`,
                }}
              >
                <circle r="11" />
              </g>
              {points.map((point, index) => (
                <g key={point.record?.id ?? "start"}>
                  <g
                    ref={(element) => {
                      pointRefs.current[index] = element;
                    }}
                    className="journal-chart-point"
                    data-trade-id={point.record?.id}
                    data-pnl={
                      point.record
                        ? point.record.pnl > 0
                          ? "positive"
                          : point.record.pnl < 0
                            ? "negative"
                            : "neutral"
                        : "neutral"
                    }
                    tabIndex={pointId(point) === tabStop ? 0 : -1}
                    role="button"
                    aria-label={describe(point, index)}
                    aria-pressed={pointId(point) === selectedId}
                    onClick={() => selectPoint(index)}
                    onMouseEnter={() => setPreviewId(pointId(point))}
                    onMouseLeave={() => setPreviewId(null)}
                    onFocus={() => {
                      setFocusedId(pointId(point));
                      setPreviewId(pointId(point));
                    }}
                    onBlur={() => setPreviewId(null)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectPoint(index);
                      } else if (event.key === "Escape") {
                        setSelectedId(null);
                        setPreviewId(null);
                      } else {
                        const next =
                          event.key === "ArrowRight"
                            ? Math.min(points.length - 1, index + 1)
                            : event.key === "ArrowLeft"
                              ? Math.max(0, index - 1)
                              : event.key === "Home"
                                ? 0
                                : event.key === "End"
                                  ? points.length - 1
                                  : null;
                        if (next !== null) {
                          event.preventDefault();
                          pointRefs.current[next]?.focus();
                        }
                      }
                    }}
                  >
                    <title>{describe(point, index)}</title>
                    <rect
                      className="journal-chart-hit"
                      x={x(index) - 22}
                      y={y(point.value) - 22}
                      width="44"
                      height="44"
                    />
                    <circle cx={x(index)} cy={y(point.value)} r="4" />
                  </g>
                  {(points.length <= 7 ||
                    index === 0 ||
                    index % Math.ceil((points.length - 1) / 6) === 0 ||
                    index === points.length - 1) && (
                    <g aria-hidden="true" style={{ pointerEvents: "none" }}>
                      <text x={x(index)} y="239" textAnchor="middle">
                        {point.record ? `Trade ${index}` : "Start"}
                      </text>
                      {point.record && (
                        <text x={x(index)} y="257" textAnchor="middle">
                          {date(point.record.closedAt)}
                        </text>
                      )}
                    </g>
                  )}
                </g>
              ))}
            </svg>
          </div>
          <p className="journal-chart-readout" role="status">
            {active
              ? describe(active)
              : "Click or tap a trade point for details. Use Tab, arrow keys and Enter on a keyboard."}
          </p>
          {selected?.record && (
            <section
              key={selected.record.id}
              className="journal-chart-detail"
              aria-label="Selected trade details"
              aria-live="polite"
            >
              <header>
                <div>
                  <strong>
                    Trade {selectedIndex} · {selected.record.symbol}
                  </strong>
                  <p>
                    {selected.record.book} ·{" "}
                    {selected.record.side === "BUY" ? "Long" : "Short"} ·{" "}
                    {selected.record.quantity.toLocaleString()} shares
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedId(null);
                    setPreviewId(null);
                  }}
                  aria-label="Clear chart selection"
                >
                  Clear selection
                </Button>
              </header>
              <dl>
                {[
                  ["Entry date", date(selected.record.openedAt)],
                  ["Exit date", date(selected.record.closedAt)],
                  ["Entry price", money(selected.record.entry)],
                  ["Exit price", money(selected.record.exit)],
                  ["Trade P&L", money(selected.record.pnl)],
                  ["Cumulative P&L", money(selected.value)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd
                      data-pnl={
                        label === "Trade P&L"
                          ? selected.record!.pnl > 0
                            ? "positive"
                            : selected.record!.pnl < 0
                              ? "negative"
                              : "neutral"
                          : undefined
                      }
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              {selected.record.note && (
                <p className="journal-chart-detail__note">
                  {selected.record.note}
                </p>
              )}
            </section>
          )}
          <p className="journal-chart-order-note">
            Same-day trades have a stable display order, not an intraday
            execution sequence. Open trades are excluded.
          </p>
        </>
      )}
    </figure>
  );
}
