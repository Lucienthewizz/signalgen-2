import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InfoDialog } from "@/components/ui/info-dialog";
import { backtestValueTone } from "@/analysis/backtest-presentation";
import {
  printResultReport,
  type ResultRecord,
  type ResultReport,
} from "@/analysis/result-explorer";
import "@/styles/result-explorer.css";
export function ResultExplorer({
  status,
  coverage,
  insights,
  records,
  scope,
  sections,
  selected,
  onSelect,
  onLoadAll,
  loading = false,
  onReport,
}: {
  status: "Complete" | "Partial" | "Stopped" | "Processing";
  coverage: string;
  insights: [string, string][];
  records: ResultRecord[];
  scope: string;
  sections: { label: string; id: string }[];
  selected: ResultRecord | null;
  onSelect: (record: ResultRecord | null) => void;
  onLoadAll?: () => void;
  loading?: boolean;
  onReport: () => Promise<ResultReport>;
}) {
  const id = useId();
  const [page, setPage] = useState(0),
    [exporting, setExporting] = useState(false),
    [error, setError] = useState("");
  const current = Math.min(
    page,
    Math.max(0, Math.ceil(records.length / 60) - 1),
  );
  return (
    <section className="result-explorer" aria-label="Result insights and tools">
      <div className="result-explorer__status" role="status">
        <Badge variant="outline" data-coverage={status}>
          {status}
        </Badge>
        <span>{coverage}</span>
      </div>
      <nav aria-label="Result sections" className="result-explorer__nav">
        {sections.map((s) => (
          <Button
            key={s.id}
            variant="outline"
            size="sm"
            onClick={() => {
              const target = document.getElementById(s.id);
              if (target) {
                const disclosure = target.closest("details");
                if (disclosure) disclosure.open = true;
                target.tabIndex = -1;
                target.focus({ preventScroll: true });
                target.scrollIntoView({
                  behavior: window.matchMedia(
                    "(prefers-reduced-motion: reduce)",
                  ).matches
                    ? "instant"
                    : "smooth",
                  block: "start",
                });
              }
            }}
          >
            {s.label}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          title="Open the report, then choose Print / Save as PDF"
          disabled={loading || exporting || status === "Processing"}
          onClick={() => {
            setError("");
            setExporting(true);
            void printResultReport(onReport)
              .catch((error: unknown) =>
                setError(
                  error instanceof Error
                    ? error.message
                    : "Report could not be opened. Retry the export.",
                ),
              )
              .finally(() => setExporting(false));
          }}
        >
          {exporting ? "Preparing report…" : "Export PDF"}
        </Button>
      </nav>
      <dl className="result-explorer__insights">
        {insights.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <details>
        <summary>Return heatmap · stock and signal date</summary>
        <p id={id}>
          {scope} · Each tile is one observation or trade. Color follows return;
          grey means zero or not evaluated. Select a tile for details.
        </p>
        {onLoadAll && (
          <Button variant="outline" disabled={loading} onClick={onLoadAll}>
            {loading ? "Loading local results…" : "Load all saved signals"}
          </Button>
        )}
        {records.length ? (
          <>
            <div className="result-explorer__heatmap" aria-describedby={id}>
              {records.slice(current * 60, current * 60 + 60).map((r, i) => (
                <button
                  type="button"
                  key={current * 60 + i}
                  data-value-tone={backtestValueTone(r.value)}
                  onClick={() => onSelect(r)}
                  aria-label={`${r.stock} ${r.date}: ${r.value === null ? "not evaluated" : r.value.toFixed(2) + "%"}`}
                >
                  <strong>{r.stock}</strong>
                  <span>{r.date}</span>
                  <b>
                    {r.value === null
                      ? "—"
                      : `${r.value > 0 ? "+" : ""}${r.value.toFixed(2)}%`}
                  </b>
                </button>
              ))}
            </div>
            <div className="result-explorer__nav">
              <Button
                variant="outline"
                size="sm"
                disabled={!current}
                onClick={() => setPage(current - 1)}
              >
                Previous tiles
              </Button>
              <span>
                Page {current + 1} of{" "}
                {Math.max(1, Math.ceil(records.length / 60))} · {records.length}{" "}
                records
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={(current + 1) * 60 >= records.length}
                onClick={() => setPage(current + 1)}
              >
                Next tiles
              </Button>
            </div>
          </>
        ) : (
          <p>No records in this scope.</p>
        )}
      </details>
      {error && <p role="alert">{error}</p>}
      <InfoDialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) onSelect(null);
        }}
        title={
          selected ? `${selected.stock} · ${selected.date}` : "Result details"
        }
        description="Recorded simulation data. Times use Singapore Time (SGT, UTC+8)."
      >
        <dl className="result-explorer__detail">
          {selected?.fields.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </InfoDialog>
    </section>
  );
}
