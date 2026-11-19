import type { BacktestTrade } from "./backtest-types";
import type { StudyEvent } from "./signal-study-types";
import { singaporeDateTime } from "@/lib/calendar";
const timestamp = (value: string) =>
  value.length === 10
    ? value
    : singaporeDateTime(new Date(value)).replace("T", " ") + " SGT";
export type ResultRecord = {
  stock: string;
  date: string;
  value: number | null;
  fields: [string, string][];
};
export type ResultReport = {
  title: string;
  description: string;
  status: string;
  metrics: [string, string][];
  records: ResultRecord[];
  curve: { label: string; value: number }[];
  chartTitle: string;
};
const number = (n: number | null) =>
  n === null
    ? "—"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(n);
export const portfolioRecord = (
  t: BacktestTrade,
  currency: string,
  step: number,
): ResultRecord => ({
  stock: t.symbol,
  date: timestamp(t.signal_time).slice(0, 10),
  value: t.return_pct,
  fields: [
    ["Position status", t.status],
    ["Signal (SGT)", timestamp(t.signal_time)],
    ["Entry (SGT)", timestamp(t.entry_time)],
    ["Exit (SGT)", t.exit_time ? timestamp(t.exit_time) : "Open"],
    ["Quantity", number(t.quantity)],
    ["Entry price", `${currency} ${number(t.entry_price)}`],
    ["Exit price", `${currency} ${number(t.exit_price)}`],
    ["Entry fee", `${currency} ${number(t.entry_commission)}`],
    ["Exit fee", `${currency} ${number(t.exit_commission)}`],
    [
      t.status === "open" ? "Unrealized P&L" : "Realized P&L",
      `${currency} ${number(t.status === "open" ? t.unrealized_pl : t.net_pl)}`,
    ],
    ["Return", `${number(t.return_pct)}%`],
    [
      "Exit basis",
      t.status === "open"
        ? "Position remains open; no exit price recorded."
        : `Configured holding horizon: T+${step}. No separate exit reason is supplied.`,
    ],
  ],
});
export const signalRecord = (
  e: StudyEvent,
  currency: string,
): ResultRecord => ({
  stock: e.symbol,
  date: timestamp(e.timestamp).slice(0, 10),
  value: e.swing.return_pct,
  fields: [
    ["Signal candle (SGT)", timestamp(e.timestamp)],
    ["Direction", e.signal_type],
    ["Reference close", `${currency} ${number(e.reference_price)}`],
    ["Outcome", e.swing.status],
    [
      "Evaluation candle (SGT)",
      e.swing.timestamp ? timestamp(e.swing.timestamp) : "Not available",
    ],
    ["Outcome price", `${currency} ${number(e.swing.price)}`],
    [
      "Swing return",
      e.swing.return_pct === null
        ? "Not evaluated"
        : `${number(e.swing.return_pct)}%`,
    ],
    [
      "Execution",
      "Independent signal observation; no trade execution or broker fees simulated.",
    ],
  ],
});
const escape = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function printResultReport(load: () => Promise<ResultReport>) {
  const win = window.open("", "_blank");
  if (!win) throw Error("Allow popups to open the PDF report.");
  win.opener = null;
  win.document.title = "Preparing Signalgen report";
  win.document.body.textContent = "Preparing report…";
  try {
    const r = await load();
    if (win.closed) return;
    const lo = r.curve.reduce((min, p) => Math.min(min, p.value), 0),
      hi = r.curve.reduce((max, p) => Math.max(max, p.value), 1),
      span = hi - lo || 1;
    const points = r.curve
      .flatMap((p, i) =>
        i % Math.max(1, Math.ceil(r.curve.length / 500)) === 0 ||
        i === r.curve.length - 1
          ? [
              `${30 + (i / Math.max(1, r.curve.length - 1)) * 680},${180 - ((p.value - lo) / span) * 150}`,
            ]
          : [],
      )
      .join(" ");
    const rows = r.records
      .map(
        (item) =>
          `<tr><td>${escape(item.stock)}</td><td>${escape(item.date)}</td><td>${item.value === null ? "Not evaluated" : escape(number(item.value)) + "%"}</td><td>${item.fields.map(([k, v]) => `${escape(k)}: ${escape(v)}`).join("<br>")}</td></tr>`,
      )
      .join("");
    win.document.open();
    win.document.write(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(r.title)}</title><style>@page{size:A4;margin:16mm}body{font:12px/1.6 Arial,sans-serif;color:#17251c;margin:24px}h1{font-size:24px}h2{font-size:16px;margin-top:24px}p{overflow-wrap:anywhere}dl{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}dl div{border-bottom:1px solid #ccd5cf;padding:8px}dd{margin:0;font-weight:bold}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10px}th,td{padding:7px;border-bottom:1px solid #ccd5cf;text-align:left;overflow-wrap:anywhere;vertical-align:top}th:last-child,td:last-child{width:45%}thead{display:table-header-group}tr,svg,dl div{break-inside:avoid}svg{width:100%;height:auto}button{padding:12px;margin:0 0 16px}@media print{button{display:none}body{margin:0}a{color:inherit}}</style></head><body><button id="print-report">Print / Save as PDF</button><h1>${escape(r.title)}</h1><p>${escape(r.description)}</p><p><b>Coverage: ${escape(r.status)}</b></p><dl>${r.metrics.map(([k, v]) => `<div><dt>${escape(k)}</dt><dd>${escape(v)}</dd></div>`).join("")}</dl><h2>${escape(r.chartTitle)}</h2>${points ? `<svg viewBox="0 0 740 210" role="img" aria-label="${escape(r.chartTitle)}"><path d="M30 30V180H710" stroke="#ccd5cf" fill="none"/><polyline points="${points}" stroke="#176a43" stroke-width="2" fill="none"/><text x="30" y="205">${escape(r.curve[0]?.label ?? "")}</text><text x="710" y="205" text-anchor="end">${escape(r.curve.at(-1)?.label ?? "")}</text><text x="30" y="20">Min ${number(lo)} · Max ${number(hi)}</text></svg>` : "<p>No evaluated points available.</p>"}<h2>Result details · ${r.records.length} records</h2><table><thead><tr><th>Stock</th><th>Signal date</th><th>Return</th><th>Recorded details</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No records.</td></tr>'}</tbody></table><p>Historical simulations and screening observations are not executed broker trades. Open positions are not realized profit. Missing or failed data limits the scope of these results.</p></body></html>`,
    );
    win.document.close();
    win.document
      .getElementById("print-report")
      ?.addEventListener("click", () => win.print());
    win.focus();
  } catch (e) {
    if (!win.closed) win.close();
    throw e;
  }
}
