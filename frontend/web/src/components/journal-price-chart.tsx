import { useMemo, useState } from "react";
import { ChartNoAxesCombined } from "lucide-react";
import {
  journalPriceSeries,
  screeningDay,
  type JournalItem,
} from "@/lib/journal-explorer";
import { SINGAPORE_TIME_ZONE } from "@/lib/calendar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: SINGAPORE_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
const timeLabel = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: SINGAPORE_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export function JournalPriceChart({
  items,
  onSelectDay,
}: {
  items: JournalItem[];
  onSelectDay: (day: string) => void;
}) {
  const series = useMemo(() => journalPriceSeries(items), [items]);
  const [stockKey, setStockKey] = useState("");
  const [pointId, setPointId] = useState("");
  const stock = series.find((item) => item.key === stockKey) ?? series[0];
  const points = stock?.points.slice(-200) ?? [];
  const selected = points.find((item) => item.id === pointId) ?? points.at(-1);
  const prices = points.map((item) => item.data.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const padding = Math.max((high - low) * 0.1, high * 0.01);
  const floor = Math.max(0, low - padding);
  const ceiling = high + padding;
  const range = ceiling - floor;
  const firstTime = Date.parse(points[0]?.data.screened_at ?? "");
  const lastTime = Date.parse(points.at(-1)?.data.screened_at ?? "");
  const x = (item: JournalItem) =>
    lastTime === firstTime
      ? 50
      : 4 +
        ((Date.parse(item.data.screened_at) - firstTime) /
          (lastTime - firstTime)) *
          92;
  const y = (item: JournalItem) =>
    4 + ((ceiling - item.data.price) / range) * 92;
  const number = new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: stock?.currency === "IDR" ? 0 : 2,
  });
  const priceLabel = (price: number) =>
    `${stock?.currency} ${number.format(price)}`;
  return (
    <section
      className="journal-price-chart"
      aria-labelledby="journal-price-chart-title"
    >
      <header>
        <div>
          <h2 id="journal-price-chart-title">
            <ChartNoAxesCombined aria-hidden="true" /> Screening price history
          </h2>
          <p>Saved screening prices · Singapore Time (SGT)</p>
        </div>
        {stock && (
          <Select
            items={series.map((item) => ({
              value: item.key,
              label: `${item.symbol.replace(/\.JK$/, "")} · ${item.market}`,
            }))}
            value={stock.key}
            onValueChange={(value) => {
              setStockKey(value ?? "");
              setPointId("");
            }}
          >
            <SelectTrigger aria-label="Chart stock">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {series.map((item) => (
                <SelectItem key={item.key} value={item.key}>
                  {item.symbol.replace(/\.JK$/, "")} · {item.market}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </header>
      {stock && selected ? (
        <>
          <div className="journal-price-chart__canvas">
            <div className="journal-price-chart__scale" aria-hidden="true">
              <span>{number.format(ceiling)}</span>
              <span>{number.format((floor + ceiling) / 2)}</span>
              <span>{number.format(floor)}</span>
            </div>
            <div className="journal-price-chart__plot">
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {[4, 50, 96].map((level) => (
                  <line
                    key={level}
                    x1="0"
                    x2="100"
                    y1={level}
                    y2={level}
                    className="journal-price-chart__grid"
                  />
                ))}
                {points.length > 1 && (
                  <polyline
                    className="journal-price-chart__line"
                    points={points
                      .map((item) => `${x(item)},${y(item)}`)
                      .join(" ")}
                  />
                )}
              </svg>
              {points.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className="journal-price-chart__point"
                  data-signal={item.data.signal_type ?? "MATCH"}
                  aria-pressed={selected.id === item.id}
                  aria-label={`${item.data.symbol}, ${timeLabel(item.data.screened_at)} SGT, ${priceLabel(item.data.price)}, ${item.data.signal_type ?? "Match"}`}
                  title={`${timeLabel(item.data.screened_at)} SGT · ${priceLabel(item.data.price)}`}
                  style={{ left: `${x(item)}%`, top: `${y(item)}%` }}
                  onClick={() => setPointId(item.id)}
                >
                  <span aria-hidden="true" />
                </button>
              ))}
            </div>
            <div className="journal-price-chart__dates" aria-hidden="true">
              <span>{dateLabel(points[0].data.screened_at)}</span>
              {lastTime !== firstTime && (
                <span>{dateLabel(points.at(-1)!.data.screened_at)}</span>
              )}
            </div>
          </div>
          <footer>
            <dl aria-label="Selected screening price">
              <div>
                <dt>Screening price</dt>
                <dd>{priceLabel(selected.data.price)}</dd>
              </div>
              <div>
                <dt>Screened at (SGT)</dt>
                <dd>{timeLabel(selected.data.screened_at)}</dd>
              </div>
              <div>
                <dt>Signal</dt>
                <dd data-signal={selected.data.signal_type ?? "MATCH"}>
                  {selected.data.signal_type ?? "Unspecified"}
                </dd>
              </div>
            </dl>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onSelectDay(screeningDay(selected.data.screened_at))
              }
            >
              Filter selected date
            </Button>
          </footer>
          <p>
            {points.length === 1
              ? "One saved price point. Save another screening for this stock to compare prices."
              : `${points.length} saved price points. Select a point for its screening details.`}
            {stock.points.length > 200 && " Showing the latest 200 points."}
          </p>
        </>
      ) : (
        <p className="journal-price-chart__empty">
          Save a screening result to start this chart.
        </p>
      )}
    </section>
  );
}
