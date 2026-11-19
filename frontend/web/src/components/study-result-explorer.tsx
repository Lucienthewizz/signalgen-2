import { useMemo, useRef, useState } from "react";
import { ResultExplorer } from "./result-explorer";
import type { StudyProgress } from "@/analysis/signal-study";
import type { StudyEvent } from "@/analysis/signal-study-types";
import { studyEventPage } from "@/analysis/signal-study-storage";
import { session } from "@/api/client";
import { signalRecord, type ResultRecord } from "@/analysis/result-explorer";
export function StudyResultExplorer({
  progress,
  userId,
  busy,
  closed,
  rows,
  selected,
  onSelect,
}: {
  progress: StudyProgress;
  userId: string;
  busy: boolean;
  closed: boolean;
  rows: StudyEvent[];
  selected: ResultRecord | null;
  onSelect: (r: ResultRecord | null) => void;
}) {
  const { context } = progress;
  const [loaded, setLoaded] = useState<{
      id: string;
      events: StudyEvent[];
    } | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const identity = useRef("");
  identity.current = userId + context.id;
  const status = busy
    ? "Processing"
    : closed
      ? "Stopped"
      : progress.completed === context.total &&
          !progress.failures.length &&
          !progress.swing.missing
        ? "Complete"
        : "Partial";
  const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}%`);
  const ranked = progress.bySymbol
    .filter((r) => r.evaluated > 0 && r.mean_return_pct !== null)
    .sort((a, b) => b.mean_return_pct! - a.mean_return_pct!);
  const insights: [string, string][] = [
    [
      "Best stock · mean swing return",
      ranked.length
        ? `${ranked[0].key} · ${pct(ranked[0].mean_return_pct)}`
        : "No evaluated signals",
    ],
    [
      "Worst stock · mean swing return",
      ranked.length
        ? `${ranked.at(-1)!.key} · ${pct(ranked.at(-1)!.mean_return_pct)}`
        : "No evaluated signals",
    ],
    ["Mean evaluated swing return", pct(progress.swing.mean_return_pct)],
    [
      "Missing future data / failed stocks",
      `${progress.swing.missing} / ${progress.failures.length}`,
    ],
  ];
  const coverage = `${progress.completed}/${context.total} stocks processed · ${progress.failures.length} failed · ${progress.remaining} remaining · ${progress.swing.missing} signals lack future data. Statistics describe evaluated signals only.`;
  const events = loaded?.id === context.id && !busy ? loaded.events : rows;
  const records = useMemo(
    () => events.map((e) => signalRecord(e, context.currency)),
    [events, context.currency],
  );
  async function allEvents() {
    const token = identity.current,
      revision = session.getIdentityRevision(),
      events: StudyEvent[] = [];
    for (let page = 0; ; page++) {
      const batch = await studyEventPage(userId, context.id, page, 200);
      if (
        identity.current !== token ||
        revision !== session.getIdentityRevision()
      )
        throw Error("Result changed during export.");
      events.push(...batch.rows);
      if (events.length >= batch.total) break;
      if (!batch.rows.length) throw Error("Local results are incomplete.");
    }
    if (events.length !== progress.swing.signals)
      throw Error(
        "Local signal details are incomplete. Run the study again before exporting.",
      );
    return events;
  }
  async function load() {
    setLoading(true);
    setError("");
    try {
      const events = await allEvents();
      setLoaded({ id: context.id, events });
    } catch {
      setError(
        "Local signal details could not be loaded. Keep the result open and retry.",
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <ResultExplorer
        key={context.id}
        status={status}
        coverage={coverage}
        insights={insights}
        records={records}
        scope={
          loaded?.id === context.id && !busy
            ? "All saved signals in this browser"
            : "Current detail page only; load all saved signals for the full heatmap"
        }
        selected={selected}
        onSelect={onSelect}
        loading={loading || busy}
        onLoadAll={!busy ? () => void load() : undefined}
        sections={[
          { label: "Summary", id: "study-result-summary" },
          { label: "Horizons", id: "study-result-horizons" },
          { label: "By stock", id: "study-result-stocks" },
          { label: "Signal details", id: "study-result-signals" },
        ]}
        onReport={async () => {
          const events = await allEvents(),
            days = new Map<string, { sum: number; count: number }>();
          for (const e of events) {
            if (e.swing.return_pct === null) continue;
            const day = e.timestamp.slice(0, 10),
              d = days.get(day) ?? { sum: 0, count: 0 };
            d.sum += e.swing.return_pct;
            d.count++;
            days.set(day, d);
          }
          return {
            title: "Signalgen · Historical signal study",
            description: `${context.market}/${context.currency} · Rule ${context.rule_id} · ${context.config.from}–${context.config.to} · T+${context.config.n_steps} · TP ${context.config.take_profit_pct ?? "Off"} · SL ${context.config.stop_loss_pct ?? "Off"}. Independent observations; no simulated portfolio cash or fees.`,
            status: status + " · " + coverage,
            metrics: insights,
            records: events.map((e) => signalRecord(e, context.currency)),
            curve: [...days]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([label, d]) => ({ label, value: d.sum / d.count })),
            chartTitle:
              "Mean evaluated swing return by signal date (%) · not cumulative P&L",
          };
        }}
      />
      {error && <p role="alert">{error}</p>}
    </>
  );
}
