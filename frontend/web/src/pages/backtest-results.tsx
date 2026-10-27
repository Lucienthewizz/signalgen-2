import { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "@/components/ui/table";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import type { BacktestArchive } from "@/analysis/backtest-history";
import type {
  BacktestResult,
  BacktestHorizon,
} from "@/analysis/backtest-types";
import {
  backtestTradesCSV,
  backtestHorizonsCSV,
  downloadBacktestCSV,
  backtestValueTone,
} from "@/analysis/backtest-presentation";
const dateLabel = (stamp: string) =>
  stamp ? new Date(stamp).toISOString().slice(0, 10) : "—";
const skippedLabels: Record<string, string> = {
  POSITION_OPEN: "Another position was open",
  NO_NEXT_CANDLE: "No next candle available",
  INSUFFICIENT_CAPITAL: "Insufficient capital",
};
export function BacktestResults({
  result,
  currency,
  title,
  source,
  archived,
  onClose,
}: {
  result: BacktestResult;
  currency: string;
  title: string;
  source: BacktestArchive["source"] | null;
  archived: boolean;
  onClose: () => void;
}) {
  const [horizonIndex, setHorizonIndex] = useState(result.horizons.length - 1);
  const [page, setPage] = useState(0);
  const [horizonPage, setHorizonPage] = useState(
    Math.floor((result.horizons.length - 1) / 10),
  );
  const [equityPage, setEquityPage] = useState(0);
  const selectedHorizon = result.horizons[horizonIndex];
  const signedMetrics: Record<string, number | null> = {
    "Realized P&L": selectedHorizon.metrics.net_pl_cash,
    "Unrealized P&L": selectedHorizon.metrics.unrealized_pl,
    "Total return": selectedHorizon.metrics.total_return_pct,
    "Expectancy / closed trade": selectedHorizon.metrics.expectancy_cash,
    "Average profit": selectedHorizon.metrics.avg_win_cash,
    "Average loss": selectedHorizon.metrics.avg_loss_cash,
    "Average closed return": selectedHorizon.metrics.avg_return_pct,
  };
  const money = (value: number | null) =>
    value === null
      ? "—"
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency,
          maximumFractionDigits: 2,
        }).format(value);
  const number = (value: number | null, digits = 2) =>
    value === null
      ? "—"
      : new Intl.NumberFormat("en-US", {
          maximumFractionDigits: digits,
        }).format(value);
  const percent = (value: number | null) =>
    value === null ? "—" : `${number(value)}%`;
  function selectHorizon(index: number) {
    setHorizonIndex(index);
    setPage(0);
    setEquityPage(0);
    setHorizonPage(Math.floor(index / 10));
  }
  return (
    <section
      className="backtest-panel"
      aria-labelledby="backtest-result-heading"
      data-testid="backtest-results"
    >
      <div className="backtest-section-heading">
        <div>
          <h3 id="backtest-result-heading">Backtest results</h3>
          <p className="backtest-note">
            {archived ? "Saved result · read-only" : "Completed run"} · {title}
          </p>
        </div>
        <Field className="backtest-horizon-picker">
          <FieldLabel htmlFor="bt-result-horizon">Exit horizon</FieldLabel>
          <Select
            value={String(horizonIndex)}
            items={result.horizons.map((h, i) => ({
              value: String(i),
              label: h.label,
            }))}
            onValueChange={(value) => {
              if (value !== null) selectHorizon(Number(value));
            }}
          >
            <SelectTrigger id="bt-result-horizon">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false}>
              <SelectGroup>
                {result.horizons.map((h, i) => (
                  <SelectItem
                    key={h.step}
                    value={String(i)}
                    aria-label={h.label}
                  >
                    <strong>{h.label}</strong>
                    <span className="backtest-horizon-option">
                      {h.step} {h.step === 1 ? "candle" : "candles"}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="backtest-actions">
        <Button
          variant="outline"
          onClick={() =>
            downloadBacktestCSV(
              `backtest-trades-${selectedHorizon.label}.csv`,
              backtestTradesCSV(result, selectedHorizon, currency),
            )
          }
        >
          Export trades CSV
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            downloadBacktestCSV(
              "backtest-horizons.csv",
              backtestHorizonsCSV(result, currency),
            )
          }
        >
          Export horizons CSV
        </Button>
        {archived && (
          <Button variant="ghost" onClick={onClose}>
            Close archive
          </Button>
        )}
      </div>
      <details>
        <summary>Run configuration & source</summary>
        <p>
          {result.config.mode} · {result.config.timeframe} ·{" "}
          {result.config.from} to {result.config.to} UTC ·{" "}
          {result.config.n_steps} horizons. Allocation{" "}
          {result.config.position_size}
          {result.config.position_sizing === "percent_equity"
            ? "% of equity"
            : ` ${currency} fixed`}
          ; commission {result.config.commission_pct}% and slippage{" "}
          {result.config.slippage_pct}% per side.
        </p>
        {source && (
          <>
            <p>
              Selected universe: {source.universe.name} · selection version{" "}
              {source.universe.version} · {source.universe.symbols.join(", ")}
              {source.rule &&
                ` · Rule: ${source.rule.name} · version ${source.rule.version}`}
            </p>
            <p className="backtest-note">
              Dataset {source.dataset_id} · version {source.version} ·{" "}
              {source.checksum}
              <br />
              {result.schema_version} · {result.policy_version}
            </p>
          </>
        )}
      </details>
      <p className="backtest-note">
        Each horizon uses a separate portfolio. Open positions use the last
        available close and remain unrealized.
      </p>
      <div
        className="backtest-table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Holding period comparison"
      >
        <table>
          <caption>Holding period analysis · all horizons</caption>
          <thead>
            <tr>
              {[
                "Horizon",
                "Closed / open",
                "Return",
                "Realized P&L",
                "Unrealized P&L",
                "Max drawdown",
                "Win rate",
                "Profit factor",
                "Expectancy",
              ].map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.horizons
              .slice(horizonPage * 10, (horizonPage + 1) * 10)
              .map((h) => (
                <tr
                  key={h.step}
                  data-selected={h.step === selectedHorizon.step || undefined}
                >
                  <th scope="row">
                    <Button
                      variant="ghost"
                      aria-pressed={h.step === selectedHorizon.step}
                      onClick={() => selectHorizon(h.step - 1)}
                    >
                      {h.label}
                    </Button>
                  </th>
                  <td>
                    {h.metrics.closed_trades} / {h.metrics.open_trades}
                  </td>
                  <td
                    data-value-tone={backtestValueTone(
                      h.metrics.total_return_pct,
                    )}
                  >
                    {percent(h.metrics.total_return_pct)}
                  </td>
                  <td
                    data-value-tone={backtestValueTone(h.metrics.net_pl_cash)}
                  >
                    {money(h.metrics.net_pl_cash)}
                  </td>
                  <td
                    data-value-tone={backtestValueTone(h.metrics.unrealized_pl)}
                  >
                    {money(h.metrics.unrealized_pl)}
                  </td>
                  <td>{percent(h.metrics.max_drawdown_pct)}</td>
                  <td>{percent(h.metrics.win_rate)}</td>
                  <td>{number(h.metrics.profit_factor)}</td>
                  <td
                    data-value-tone={backtestValueTone(
                      h.metrics.expectancy_cash,
                    )}
                  >
                    {money(h.metrics.expectancy_cash)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {result.horizons.length > 10 && (
        <div className="backtest-actions">
          <Button
            variant="outline"
            disabled={horizonPage === 0}
            onClick={() => setHorizonPage((p) => p - 1)}
          >
            Previous horizons
          </Button>
          <span>
            Page {horizonPage + 1} of {Math.ceil(result.horizons.length / 10)}
          </span>
          <Button
            variant="outline"
            disabled={(horizonPage + 1) * 10 >= result.horizons.length}
            onClick={() => setHorizonPage((p) => p + 1)}
          >
            Next horizons
          </Button>
        </div>
      )}
      <dl className="backtest-metrics">
        {[
          ["Final equity", money(selectedHorizon.metrics.final_equity)],
          ["Realized P&L", money(selectedHorizon.metrics.net_pl_cash)],
          ["Unrealized P&L", money(selectedHorizon.metrics.unrealized_pl)],
          [
            "Total return",
            `${number(selectedHorizon.metrics.total_return_pct)}%`,
          ],
          [
            "Max drawdown",
            `${number(selectedHorizon.metrics.max_drawdown_pct)}%`,
          ],
          [
            "Closed / open trades",
            `${selectedHorizon.metrics.closed_trades} / ${selectedHorizon.metrics.open_trades}`,
          ],
          ["Win rate (closed)", percent(selectedHorizon.metrics.win_rate)],
          ["Total commission", money(selectedHorizon.metrics.total_commission)],
          [
            "Expectancy / closed trade",
            money(selectedHorizon.metrics.expectancy_cash),
          ],
          ["Average profit", money(selectedHorizon.metrics.avg_win_cash)],
          ["Average loss", money(selectedHorizon.metrics.avg_loss_cash)],
          [
            "Average profit / loss",
            number(selectedHorizon.metrics.risk_reward),
          ],
          [
            "Average closed return",
            percent(selectedHorizon.metrics.avg_return_pct),
          ],
          [
            "Profit factor",
            selectedHorizon.metrics.profit_factor === null
              ? "—"
              : number(selectedHorizon.metrics.profit_factor),
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd
              data-value-tone={backtestValueTone(signedMetrics[label] ?? null)}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <EquityChart
        key={selectedHorizon.step}
        horizon={selectedHorizon}
        currency={currency}
      />
      <div
        className="backtest-table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Results by stock"
      >
        <table>
          <caption>
            By stock · {selectedHorizon.label} · accepted portfolio trades, net
            of costs
          </caption>
          <thead>
            <tr>
              {[
                "Stock",
                "Closed / open",
                "Skipped",
                "Win rate",
                "Realized P&L",
                "Unrealized P&L",
                "Average closed return",
              ].map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {selectedHorizon.by_symbol.map((s) => (
              <tr key={s.symbol}>
                <th scope="row">{s.symbol}</th>
                <td>
                  {s.closed_trades} / {s.open_trades}
                </td>
                <td>{s.skipped_entries}</td>
                <td>{percent(s.win_rate)}</td>
                <td data-value-tone={backtestValueTone(s.net_pl_cash)}>
                  {money(s.net_pl_cash)}
                </td>
                <td data-value-tone={backtestValueTone(s.unrealized_pl)}>
                  {money(s.unrealized_pl)}
                </td>
                <td data-value-tone={backtestValueTone(s.avg_return_pct)}>
                  {percent(s.avg_return_pct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!selectedHorizon.trades.length ? (
        <p role="status">
          No trades in this range. Review the rule or manual entries.
        </p>
      ) : (
        <>
          <div
            className="backtest-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Backtest trades"
          >
            <table>
              <caption>Trades · {selectedHorizon.label}</caption>
              <thead>
                <tr>
                  {[
                    "Stock",
                    "Signal (UTC)",
                    "Entry (UTC)",
                    "Exit (UTC)",
                    "Quantity",
                    "Entry price",
                    "Exit price",
                    "P&L",
                    "Return",
                    "Status",
                  ].map((title) => (
                    <th key={title} scope="col">
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selectedHorizon.trades
                  .slice(page * 25, (page + 1) * 25)
                  .map((trade, i) => (
                    <tr key={`${trade.symbol}:${trade.signal_time}:${i}`}>
                      <th scope="row">{trade.symbol}</th>
                      <td>{dateLabel(trade.signal_time)}</td>
                      <td>{dateLabel(trade.entry_time)}</td>
                      <td>
                        {trade.exit_time ? dateLabel(trade.exit_time) : "—"}
                      </td>
                      <td>{number(trade.quantity, 6)}</td>
                      <td>{money(trade.entry_price)}</td>
                      <td>
                        {trade.exit_price === null
                          ? "—"
                          : money(trade.exit_price)}
                      </td>
                      <td
                        data-value-tone={backtestValueTone(
                          trade.status === "open"
                            ? trade.unrealized_pl
                            : trade.net_pl,
                        )}
                      >
                        {money(
                          trade.status === "open"
                            ? trade.unrealized_pl
                            : trade.net_pl,
                        )}
                      </td>
                      <td data-value-tone={backtestValueTone(trade.return_pct)}>
                        {number(trade.return_pct)}%
                      </td>
                      <td>
                        {trade.status === "open"
                          ? "Open · unrealized"
                          : "Closed"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className="backtest-actions">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((current) => current - 1)}
            >
              Previous trades
            </Button>
            <span>
              Page {page + 1} of {Math.ceil(selectedHorizon.trades.length / 25)}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={(page + 1) * 25 >= selectedHorizon.trades.length}
              onClick={() => setPage((current) => current + 1)}
            >
              Next trades
            </Button>
          </div>
        </>
      )}
      <details>
        <summary>Skipped entries ({selectedHorizon.skipped.length})</summary>
        {selectedHorizon.skipped.length ? (
          <>
            <div
              className="backtest-table-scroll backtest-skipped"
              tabIndex={0}
              role="region"
              aria-label="Skipped backtest entries"
            >
              <Table>
                <TableCaption>
                  Entries not opened · {selectedHorizon.label}
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Stock</TableHead>
                    <TableHead scope="col">Signal (UTC)</TableHead>
                    <TableHead scope="col">Reason skipped</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedHorizon.skipped.slice(0, 50).map((entry, i) => (
                    <TableRow key={i}>
                      <TableHead scope="row">{entry.symbol}</TableHead>
                      <TableCell>
                        <time dateTime={entry.timestamp}>
                          {dateLabel(entry.timestamp)}
                        </time>
                      </TableCell>
                      <TableCell>
                        {skippedLabels[entry.reason] ?? entry.reason}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {selectedHorizon.skipped.length > 50 && (
              <p>Showing the first 50 skipped entries.</p>
            )}
          </>
        ) : (
          <p>No entries were skipped.</p>
        )}
      </details>
      <details>
        <summary>Equity values</summary>
        <div
          className="backtest-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Backtest equity"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">UTC date</th>
                <th scope="col">Equity</th>
              </tr>
            </thead>
            <tbody>
              {selectedHorizon.equity_curve
                .slice(equityPage * 25, (equityPage + 1) * 25)
                .map((point, i) => (
                  <tr key={i}>
                    <td>
                      {point.timestamp
                        ? dateLabel(point.timestamp)
                        : "Initial balance"}
                    </td>
                    <td>{money(point.equity)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="backtest-actions">
          <Button
            variant="outline"
            disabled={equityPage === 0}
            onClick={() => setEquityPage((p) => p - 1)}
          >
            Previous equity values
          </Button>
          <span>
            Page {equityPage + 1} of{" "}
            {Math.ceil(selectedHorizon.equity_curve.length / 25)}
          </span>
          <Button
            variant="outline"
            disabled={
              (equityPage + 1) * 25 >= selectedHorizon.equity_curve.length
            }
            onClick={() => setEquityPage((p) => p + 1)}
          >
            Next equity values
          </Button>
        </div>
      </details>
      {!!result.warnings.length && (
        <details>
          <summary>Simulation assumptions</summary>
          <ul>
            {result.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="backtest-note">
        Hypothetical analysis only. No broker orders, lot-size model or
        corporate-action adjustment. Saved results are unverified analysis, not
        an authoritative journal or broker execution record.
      </p>
    </section>
  );
}

function EquityChart({
  horizon,
  currency,
}: {
  horizon: BacktestHorizon;
  currency: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700),
    [index, setIndex] = useState(0);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(280, el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const points = horizon.equity_curve,
    base = horizon.metrics.initial_capital;
  const low = Math.min(base, ...points.map((p) => p.equity)),
    high = Math.max(base, ...points.map((p) => p.equity));
  const x = (i: number) =>
    80 + (i / Math.max(1, points.length - 1)) * (width - 100);
  const y = (v: number) =>
    high === low ? 110 : 195 - ((v - low) / (high - low)) * 165;
  const money = (v: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(v);
  const point = points[Math.min(index, points.length - 1)];
  const description = `${point.timestamp ? dateLabel(point.timestamp) : "Initial balance"} · ${money(point.equity)}`;
  return (
    <figure className="backtest-equity">
      <figcaption>
        Daily equity · {horizon.label}
        <span>{currency} · cash + marked position value</span>
      </figcaption>
      <div ref={container} className="backtest-chart">
        <svg
          viewBox={`0 0 ${width} 245`}
          role="img"
          aria-label={`Daily equity for ${horizon.label}. Initial ${money(base)}, final ${money(horizon.metrics.final_equity)}.`}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setIndex(
              Math.max(
                0,
                Math.min(
                  points.length - 1,
                  Math.round(
                    ((((e.clientX - box.left) * width) / box.width - 80) /
                      (width - 100)) *
                      (points.length - 1),
                  ),
                ),
              ),
            );
          }}
          onPointerDown={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setIndex(
              Math.max(
                0,
                Math.min(
                  points.length - 1,
                  Math.round(
                    ((((e.clientX - box.left) * width) / box.width - 80) /
                      (width - 100)) *
                      (points.length - 1),
                  ),
                ),
              ),
            );
          }}
        >
          {[low, (low + high) / 2, high]
            .filter((v, i, a) => a.indexOf(v) === i)
            .map((v) => (
              <g key={v}>
                <line
                  x1="80"
                  x2={width - 20}
                  y1={y(v)}
                  y2={y(v)}
                  className="backtest-chart-grid"
                />
                <text x="72" y={y(v) + 4} textAnchor="end">
                  {new Intl.NumberFormat("en-US", {
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(v)}
                </text>
              </g>
            ))}
          <line
            x1="80"
            x2={width - 20}
            y1={y(base)}
            y2={y(base)}
            className="backtest-chart-baseline"
          />
          <polyline
            className="backtest-chart-line"
            points={points.map((p, i) => `${x(i)},${y(p.equity)}`).join(" ")}
          />
          <circle cx={x(index)} cy={y(point.equity)} r="5" />
          <text x="80" y="225">
            {points[1]?.timestamp ? dateLabel(points[1].timestamp) : "Start"}
          </text>
          <text x={width - 20} y="225" textAnchor="end">
            {points.at(-1)?.timestamp
              ? dateLabel(points.at(-1)!.timestamp)
              : "Start"}
          </text>
        </svg>
      </div>
      <label htmlFor={`bt-equity-point-${horizon.step}`}>
        Inspect daily equity
      </label>
      <input
        id={`bt-equity-point-${horizon.step}`}
        type="range"
        min="0"
        max={points.length - 1}
        value={index}
        onChange={(e) => setIndex(Number(e.target.value))}
        aria-valuetext={description}
      />
      <p role="status">{description}</p>
      <p className="backtest-note">
        Dashed line: initial capital. Use the slider or tap the chart; full
        values are available in the table below.
      </p>
    </figure>
  );
}
