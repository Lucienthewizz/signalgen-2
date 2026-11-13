import { useMemo, type ReactNode } from "react";
import {
  BookOpen,
  ArrowUpRight,
  ArrowDownRight,
  Layers,
  ScanLine,
  Workflow,
} from "lucide-react";
import MagicBento, {
  type MagicBentoItem,
} from "@/components/react-bits/MagicBento";
import { journalSummary, type JournalItem } from "@/lib/journal-explorer";
import { useVisualPreferences } from "@/lib/visual-preferences";
import "@/styles/journal-bento.css";

export function JournalBento({
  items,
  portfolio,
}: {
  items: JournalItem[];
  portfolio: ReactNode;
}) {
  const summary = useMemo(() => journalSummary(items), [items]);
  const { light, reduced } = useVisualPreferences();
  const percent = (value: number) =>
    summary.total ? Math.round((value / summary.total) * 100) : 0;
  const cards: MagicBentoItem[] = [
    {
      id: "prices",
      colSpan: 2,
      rowSpan: 2,
      content: portfolio,
    },
    {
      id: "saved",
      content: (
        <section className="journal-bento__stat">
          <h3>
            <BookOpen aria-hidden="true" /> Saved signals
          </h3>
          <strong>{summary.total}</strong>
          <p>Screening snapshots in the current filters.</p>
        </section>
      ),
    },
    {
      id: "signals",
      content: (
        <section className="journal-bento__signals">
          <h3>Signal mix</h3>
          <div className="journal-bento__bar" aria-hidden="true">
            <i style={{ width: `${percent(summary.buy)}%` }} />
            <i style={{ width: `${percent(summary.sell)}%` }} />
            <i style={{ flex: 1 }} />
          </div>
          <dl>
            <div data-signal="BUY">
              <dt>
                <ArrowUpRight aria-hidden="true" /> BUY
              </dt>
              <dd>{summary.buy}</dd>
            </div>
            <div data-signal="SELL">
              <dt>
                <ArrowDownRight aria-hidden="true" /> SELL
              </dt>
              <dd>{summary.sell}</dd>
            </div>
            <div>
              <dt>Unspecified</dt>
              <dd>{summary.other}</dd>
            </div>
          </dl>
        </section>
      ),
    },
    {
      id: "coverage",
      content: (
        <section className="journal-bento__stat">
          <h3>
            <Layers aria-hidden="true" /> Stocks / rules
          </h3>
          <strong>
            {summary.stocks} <span>/ {summary.rules}</span>
          </strong>
          <p>Unique stocks and rules across these snapshots.</p>
        </section>
      ),
    },
    {
      id: "stock",
      content: (
        <section className="journal-bento__stat">
          <h3>
            <ScanLine aria-hidden="true" /> Most saved stock
          </h3>
          <strong>{summary.topStock?.[0].replace(/\.JK$/, "") ?? "—"}</strong>
          <p>
            {summary.topStock
              ? `${summary.topStock[1]} saved snapshot${summary.topStock[1] === 1 ? "" : "s"}`
              : "Save a screening result to see a stock here."}
          </p>
        </section>
      ),
    },
    {
      id: "rule",
      content: (
        <section className="journal-bento__stat">
          <h3>
            <Workflow aria-hidden="true" /> Most used rule
          </h3>
          <strong className="journal-bento__rule">
            {summary.topRule?.[1].name ?? "—"}
          </strong>
          <p>
            {summary.topRule
              ? `${summary.topRule[1].count} saved snapshot${summary.topRule[1].count === 1 ? "" : "s"}`
              : "Your saved results will appear here."}
          </p>
        </section>
      ),
    },
  ];
  return (
    <section aria-label="Journal overview" className="journal-bento">
      <MagicBento
        key={String(reduced)}
        items={cards}
        columns={3}
        rowHeight={230}
        gap={14}
        radius={16}
        theme={light ? "light" : "dark"}
        glowColor="#45e69f"
        textAutoHide={false}
        intro={false}
        enableTilt={false}
        enableMagnetism={false}
        enableStars={false}
        clickEffect={false}
        disableAnimations={reduced}
      />
      <p className="screening-journal__note">
        Signal counts follow the screening filters. Portfolio P&L follows the
        market and portfolio selected in the chart.
      </p>
    </section>
  );
}
