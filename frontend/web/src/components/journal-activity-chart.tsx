import { useMemo } from "react";
import { BarChart3 } from "lucide-react";
import { journalActivity, type JournalItem } from "@/lib/journal-explorer";

const labelDate = (day: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
  }).format(new Date(`${day}T00:00:00+08:00`));

export function JournalActivityChart({
  items,
  onSelectDay,
}: {
  items: JournalItem[];
  onSelectDay: (day: string) => void;
}) {
  const activity = useMemo(() => journalActivity(items), [items]);
  const days = activity.slice(-30);
  const peak = Math.max(1, ...days.map((day) => day.total));
  return (
    <section
      className="journal-activity"
      aria-labelledby="journal-activity-title"
    >
      <header>
        <div>
          <h2 id="journal-activity-title">
            <BarChart3 aria-hidden="true" /> Saved signals over time
          </h2>
          <p>
            {activity.length > 30
              ? "Latest 30 screening dates in the current filters."
              : "Daily signal counts in the current filters."}{" "}
            Singapore Time (SGT).
          </p>
        </div>
        <ul className="journal-activity__legend" aria-label="Chart legend">
          <li data-signal="BUY">
            <i aria-hidden="true" />
            BUY
          </li>
          <li data-signal="SELL">
            <i aria-hidden="true" />
            SELL
          </li>
          <li data-signal="MATCH">
            <i aria-hidden="true" />
            Unspecified
          </li>
        </ul>
      </header>
      {days.length ? (
        <>
          <div className="journal-activity__scroll">
            <div className="journal-activity__plot">
              {days.map((day) => (
                <button
                  key={day.day}
                  type="button"
                  className="journal-activity__day"
                  aria-label={`${day.day}: ${day.total} saved signals, ${day.buy} BUY, ${day.sell} SELL, ${day.other} unspecified. Filter this date`}
                  title={`${day.day} · BUY ${day.buy} · SELL ${day.sell} · Unspecified ${day.other}`}
                  onClick={() => onSelectDay(day.day)}
                >
                  <span className="journal-activity__column" aria-hidden="true">
                    <span className="journal-activity__total">{day.total}</span>
                    <span
                      className="journal-activity__stack"
                      style={{ height: `${(day.total / peak) * 120}px` }}
                    >
                      {(["buy", "sell", "other"] as const).map(
                        (signal) =>
                          day[signal] > 0 && (
                            <span
                              key={signal}
                              data-direction={signal}
                              style={{ flexGrow: day[signal] }}
                            />
                          ),
                      )}
                    </span>
                  </span>
                  <time dateTime={day.day}>{labelDate(day.day)}</time>
                </button>
              ))}
            </div>
          </div>
          <p className="journal-activity__hint">
            Click a bar to filter the journal to that date.
          </p>
        </>
      ) : (
        <p className="journal-activity__empty">
          Saved results will appear here as you add them from Screener.
        </p>
      )}
    </section>
  );
}
