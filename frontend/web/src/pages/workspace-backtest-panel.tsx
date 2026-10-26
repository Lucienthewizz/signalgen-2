import { useEffect, useRef, useState, type FormEvent } from "react";
import { Play, Square, Plus, Trash2, RefreshCw } from "lucide-react";
import { api, session } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  prepareBacktest,
  runBacktest,
  type PreparedBacktest,
} from "@/analysis/backtest";
import type {
  BacktestConfig,
  BacktestEntry,
  BacktestResult,
} from "@/analysis/backtest-types";
import type { RuleResource, StockUniverse } from "@/types";

function initialConfig(): BacktestConfig {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 6);
  return {
    mode: "rule",
    timeframe: "1d",
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
    n_steps: 3,
    exit_strategy: "holding_period",
    initial_capital: 10000,
    position_sizing: "percent_equity",
    position_size: 100,
    commission_pct: 0,
    slippage_pct: 0,
  };
}
const dateLabel = (stamp: string) =>
  stamp ? new Date(stamp).toISOString().slice(0, 10) : "—";
const skippedLabels: Record<string, string> = {
  POSITION_OPEN: "Another position was open",
  NO_NEXT_CANDLE: "No next candle available",
  INSUFFICIENT_CAPITAL: "Insufficient capital",
};

export function WorkspaceBacktestPanel({
  authenticated,
  backendOnline,
  userId,
}: {
  authenticated: boolean;
  backendOnline: boolean;
  userId?: string;
}) {
  const [config, setConfig] = useState(initialConfig);
  const [rules, setRules] = useState<RuleResource[]>([]);
  const [universes, setUniverses] = useState<StockUniverse[]>([]);
  const [ruleId, setRuleId] = useState("");
  const [universeId, setUniverseId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [prepared, setPrepared] = useState<PreparedBacktest | null>(null);
  const [entries, setEntries] = useState<BacktestEntry[]>([]);
  const [entrySymbol, setEntrySymbol] = useState("");
  const [entryTime, setEntryTime] = useState("");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState("");
  const [stage, setStage] = useState("");
  const [busy, setBusy] = useState(false);
  const [horizonIndex, setHorizonIndex] = useState(0);
  const [page, setPage] = useState(0);
  const operation = useRef<AbortController | null>(null);
  const selectedUniverse = universes.find((item) => item.id === universeId);
  const selectedHorizon = result?.horizons[horizonIndex];
  const currency = prepared?.manifest.currency ?? "IDR";
  const money = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  const number = (value: number, digits = 2) =>
    new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(
      value,
    );

  function clearSnapshot() {
    operation.current?.abort();
    operation.current = null;
    setBusy(false);
    setPrepared(null);
    setEntries([]);
    setEntrySymbol("");
    setEntryTime("");
    setResult(null);
    setError("");
    setStage("");
  }
  useEffect(() => {
    const unsubscribe = session.onIdentityChange(clearSnapshot);
    const hide = () => operation.current?.abort();
    window.addEventListener("pagehide", hide);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", hide);
      operation.current?.abort();
    };
  }, []);
  useEffect(() => {
    clearSnapshot();
    if (!authenticated || !backendOnline) {
      setLoading(false);
      return;
    }
    let ignore = false;
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    (async () => {
      await api.ensureAppSession();
      const account = await api.account(controller.signal);
      if (!account.features.includes("backtest"))
        throw new Error(
          "Backtesting is not enabled for your account. Check Plan & access.",
        );
      const [ruleList, universeList, capabilities] = await Promise.all([
        api.listRules(controller.signal),
        api.listStockUniverses(controller.signal),
        api.backtestCapabilities(controller.signal),
      ]);
      if (
        capabilities.backtest?.policy_version !== "holding-next-open-1" ||
        capabilities.backtest.schema_version !== "backtest-1"
      )
        throw new Error(
          "This backend does not support the current backtest version. Update the backend before running a backtest.",
        );
      if (ignore) return;
      setRules(ruleList.items);
      setUniverses(universeList.items);
      setRuleId((current) =>
        ruleList.items.some((item) => item.id === current)
          ? current
          : (ruleList.items.find(
              (item) => item.definition?.signal_type !== "SELL",
            )?.id ?? ""),
      );
      setUniverseId((current) =>
        universeList.items.some((item) => item.id === current)
          ? current
          : (universeList.items[0]?.id ?? ""),
      );
    })()
      .catch((cause) => {
        if (!ignore && !controller.signal.aborted)
          setLoadError(
            cause instanceof Error
              ? cause.message
              : "Backtest options could not be loaded.",
          );
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
      controller.abort();
    };
  }, [authenticated, backendOnline, userId, reload]);

  function update<K extends keyof BacktestConfig>(
    key: K,
    value: BacktestConfig[K],
  ) {
    if (["mode", "from", "to", "n_steps"].includes(key)) clearSnapshot();
    else {
      setResult(null);
      setError("");
    }
    setConfig((current) => ({ ...current, [key]: value }));
  }
  function cancel() {
    operation.current?.abort();
    operation.current = null;
    setBusy(false);
    setStage("Backtest cancelled. You can run it again.");
  }
  async function execute(prepareOnly: boolean) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    setResult(null);
    setPage(0);
    const settings = { ...config };
    try {
      const snapshot =
        (!prepareOnly ? prepared : null) ??
        (await prepareBacktest(
          settings,
          ruleId,
          universeId,
          controller.signal,
          setStage,
        ));
      controller.signal.throwIfAborted();
      if (operation.current !== controller) return;
      setPrepared(snapshot);
      setEntrySymbol((current) => current || snapshot.dataset.series[0].symbol);
      if (prepareOnly) {
        setEntries([]);
        setEntryTime("");
        setStage("Data ready. Add manual entries below.");
        return;
      }
      const report = await runBacktest(
        snapshot,
        settings,
        ruleId,
        entries,
        controller.signal,
        setStage,
      );
      controller.signal.throwIfAborted();
      if (operation.current !== controller) return;
      setResult(report);
      setHorizonIndex(report.horizons.length - 1);
      setStage("Backtest complete.");
    } catch (cause) {
      if (!controller.signal.aborted && operation.current === controller) {
        setError(cause instanceof Error ? cause.message : "Backtest failed.");
        setStage("");
      }
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  const availableCandles =
    prepared?.dataset.series
      .find((item) => item.symbol === entrySymbol)
      ?.candles.filter((candle) => {
        const day = dateLabel(candle.timestamp);
        return day >= config.from && day <= config.to;
      }) ?? [];
  function addEntry(event: FormEvent) {
    event.preventDefault();
    if (!availableCandles.some((item) => item.timestamp === entryTime)) {
      setError("Choose a signal candle from the prepared snapshot.");
      return;
    }
    if (
      entries.some(
        (item) => item.symbol === entrySymbol && item.timestamp === entryTime,
      )
    ) {
      setError("This entry has already been added.");
      return;
    }
    if (entries.length >= 2000) {
      setError("The backtest supports up to 2,000 entries.");
      return;
    }
    setEntries((current) => [
      ...current,
      { symbol: entrySymbol, timestamp: entryTime, signal_type: "BUY" },
    ]);
    setResult(null);
    setError("");
  }

  if (!authenticated)
    return (
      <section className="backtest-panel">
        <h3>Sign in to backtest</h3>
        <p>Use your account's stock universes and backtest access.</p>
        <a href="#login">Sign in</a>
      </section>
    );
  if (!backendOnline)
    return (
      <section className="backtest-panel" role="status">
        <h3>Backend unavailable</h3>
        <p>Reconnect to load historical data and verify your access.</p>
      </section>
    );
  if (loading)
    return (
      <section className="backtest-panel" role="status">
        Loading backtest options…
      </section>
    );
  if (loadError)
    return (
      <section className="backtest-panel">
        <p role="alert">{loadError}</p>
        <div className="backtest-actions">
          <Button
            variant="outline"
            onClick={() => setReload((current) => current + 1)}
          >
            <RefreshCw /> Retry
          </Button>
          <a href="#app/subscription">Plan & access</a>
        </div>
      </section>
    );
  return (
    <div className="backtest-workspace">
      <section
        className="backtest-panel"
        aria-labelledby="backtest-config-heading"
      >
        <div className="backtest-section-heading">
          <h3 id="backtest-config-heading">Configuration</h3>
          <span>Daily · Long only</span>
        </div>
        <p className="backtest-note">
          Signals use completed candles. Entry is at the next candle's open; one
          position at a time.
        </p>
        {!universes.length ? (
          <p role="status">
            Create a <a href="#app/universes">stock universe</a> before running
            a backtest.
          </p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void execute(config.mode === "manual");
            }}
          >
            <fieldset disabled={busy} className="backtest-fields">
              <div className="backtest-field">
                <label htmlFor="bt-mode">Entry mode</label>
                <select
                  id="bt-mode"
                  value={config.mode}
                  onChange={(event) =>
                    update("mode", event.target.value as BacktestConfig["mode"])
                  }
                >
                  <option value="rule">Rule</option>
                  <option value="manual">Manual</option>
                </select>
              </div>
              <div className="backtest-field">
                <label htmlFor="bt-universe">Stock universe</label>
                <select
                  id="bt-universe"
                  required
                  value={universeId}
                  onChange={(event) => {
                    clearSnapshot();
                    setUniverseId(event.target.value);
                  }}
                >
                  {universes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.symbols.length} stocks)
                    </option>
                  ))}
                </select>
              </div>
              {config.mode === "rule" && (
                <div className="backtest-field">
                  <label htmlFor="bt-rule">Entry rule</label>
                  <select
                    id="bt-rule"
                    required
                    value={ruleId}
                    onChange={(event) => {
                      clearSnapshot();
                      setRuleId(event.target.value);
                    }}
                  >
                    <option value="" disabled>
                      Choose a BUY rule
                    </option>
                    {rules.map((item) => (
                      <option
                        key={item.id}
                        value={item.id}
                        disabled={item.definition?.signal_type === "SELL"}
                      >
                        {item.name}
                        {item.definition?.signal_type === "SELL"
                          ? " (SELL unsupported)"
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="backtest-field">
                <label htmlFor="bt-from">From date (UTC)</label>
                <Input
                  id="bt-from"
                  type="date"
                  required
                  max={config.to}
                  value={config.from}
                  onChange={(event) => update("from", event.target.value)}
                />
              </div>
              <div className="backtest-field">
                <label htmlFor="bt-to">To date (UTC)</label>
                <Input
                  id="bt-to"
                  type="date"
                  required
                  min={config.from}
                  max={new Date().toISOString().slice(0, 10)}
                  value={config.to}
                  onChange={(event) => update("to", event.target.value)}
                />
              </div>
              <div className="backtest-field">
                <label htmlFor="bt-horizon">Holding period (candles)</label>
                <Input
                  id="bt-horizon"
                  type="number"
                  required
                  min="1"
                  max="100"
                  step="1"
                  value={config.n_steps}
                  onChange={(event) =>
                    update("n_steps", Number(event.target.value))
                  }
                />
              </div>
              <div className="backtest-field">
                <label htmlFor="bt-capital">Initial capital</label>
                <Input
                  id="bt-capital"
                  type="number"
                  required
                  min="0.01"
                  max="1000000000000000"
                  step="any"
                  value={config.initial_capital}
                  onChange={(event) =>
                    update("initial_capital", Number(event.target.value))
                  }
                />
              </div>
              <div className="backtest-field">
                <label htmlFor="bt-sizing">Position sizing</label>
                <select
                  id="bt-sizing"
                  value={config.position_sizing}
                  onChange={(event) =>
                    update(
                      "position_sizing",
                      event.target.value as BacktestConfig["position_sizing"],
                    )
                  }
                >
                  <option value="percent_equity">Percent of equity</option>
                  <option value="fixed_amount">Fixed amount</option>
                </select>
              </div>
              <div className="backtest-field">
                <label htmlFor="bt-size">
                  {config.position_sizing === "percent_equity"
                    ? "Position size (%)"
                    : "Position amount"}
                </label>
                <Input
                  id="bt-size"
                  type="number"
                  required
                  min="0.01"
                  max={
                    config.position_sizing === "percent_equity"
                      ? "100"
                      : "1000000000000000"
                  }
                  step="any"
                  value={config.position_size}
                  onChange={(event) =>
                    update("position_size", Number(event.target.value))
                  }
                />
              </div>
              <div className="backtest-field">
                <label htmlFor="bt-fee">Commission per side (%)</label>
                <Input
                  id="bt-fee"
                  type="number"
                  required
                  min="0"
                  max="10"
                  step="any"
                  value={config.commission_pct}
                  onChange={(event) =>
                    update("commission_pct", Number(event.target.value))
                  }
                />
              </div>
              <div className="backtest-field">
                <label htmlFor="bt-slip">Slippage per side (%)</label>
                <Input
                  id="bt-slip"
                  type="number"
                  required
                  min="0"
                  max="10"
                  step="any"
                  value={config.slippage_pct}
                  onChange={(event) =>
                    update("slippage_pct", Number(event.target.value))
                  }
                />
              </div>
            </fieldset>
            {config.mode === "rule" && !ruleId && (
              <p role="status">
                Create a <a href="#app/rules">BUY rule</a> or switch to Manual
                mode to choose entries yourself.
              </p>
            )}
            <p className="backtest-note">
              {selectedUniverse?.symbols.join(", ")} · Capital uses the
              dataset's currency. Quantities may be fractional.
            </p>
            <div className="backtest-actions">
              <Button
                type="submit"
                disabled={
                  busy || !universeId || (config.mode === "rule" && !ruleId)
                }
              >
                <Play />
                {config.mode === "manual" ? "Prepare data" : "Run backtest"}
              </Button>
              {busy && (
                <Button type="button" variant="outline" onClick={cancel}>
                  <Square />
                  Cancel
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={clearSnapshot}
              >
                Reset results
              </Button>
            </div>
          </form>
        )}
        {stage && (
          <p role="status" aria-live="polite" data-testid="backtest-progress">
            {stage}
          </p>
        )}
        {error && (
          <p role="alert" className="backtest-error">
            {error}
          </p>
        )}
      </section>

      {prepared && (
        <section className="backtest-panel" aria-label="Historical snapshot">
          <h3>Historical snapshot</h3>
          <p>
            {prepared.manifest.symbols.length} stock(s) ·{" "}
            {prepared.manifest.currency} · {prepared.manifest.candle_count}{" "}
            candles · Available {prepared.manifest.available_range.from} to{" "}
            {prepared.manifest.available_range.to}
          </p>
          <details>
            <summary>Data quality and assumptions</summary>
            <ul>
              {prepared.manifest.quality.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          </details>
        </section>
      )}

      {config.mode === "manual" && prepared && (
        <section
          className="backtest-panel"
          aria-labelledby="backtest-manual-heading"
        >
          <h3 id="backtest-manual-heading">Manual entries</h3>
          <p className="backtest-note">
            Choose a completed signal candle. The simulation enters at the next
            available candle's open.
          </p>
          <form onSubmit={addEntry} className="backtest-manual-form">
            <fieldset disabled={busy} className="backtest-fields">
              <div className="backtest-field">
                <label htmlFor="bt-entry-symbol">Entry stock</label>
                <select
                  id="bt-entry-symbol"
                  value={entrySymbol}
                  onChange={(event) => {
                    setEntrySymbol(event.target.value);
                    setEntryTime("");
                  }}
                >
                  {prepared.dataset.series.map((item) => (
                    <option key={item.symbol}>{item.symbol}</option>
                  ))}
                </select>
              </div>
              <div className="backtest-field">
                <label htmlFor="bt-entry-time">Signal candle (UTC)</label>
                <select
                  id="bt-entry-time"
                  required
                  value={entryTime}
                  onChange={(event) => setEntryTime(event.target.value)}
                >
                  <option value="">Choose a candle</option>
                  {availableCandles.map((item) => (
                    <option key={item.timestamp} value={item.timestamp}>
                      {dateLabel(item.timestamp)} · close {number(item.close)}
                    </option>
                  ))}
                </select>
              </div>
            </fieldset>
            <Button
              type="submit"
              variant="outline"
              disabled={busy || !entryTime}
            >
              <Plus />
              Add entry
            </Button>
          </form>
          <ul className="backtest-entry-list">
            {entries.map((entry, i) => (
              <li key={`${entry.symbol}:${entry.timestamp}`}>
                <span>
                  {entry.symbol} · {dateLabel(entry.timestamp)} · BUY
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={`Remove entry ${i + 1}`}
                  onClick={() => {
                    setEntries((current) =>
                      current.filter((_, index) => index !== i),
                    );
                    setResult(null);
                  }}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          {!entries.length && <p>No manual entries added yet.</p>}
          <Button
            disabled={busy || !entries.length}
            onClick={() => void execute(false)}
          >
            <Play />
            Run manual backtest
          </Button>
        </section>
      )}

      {result && selectedHorizon && (
        <section
          className="backtest-panel"
          aria-labelledby="backtest-result-heading"
          data-testid="backtest-results"
        >
          <div className="backtest-section-heading">
            <h3 id="backtest-result-heading">Backtest results</h3>
            <div className="backtest-field">
              <label htmlFor="bt-result-horizon">Exit horizon</label>
              <select
                id="bt-result-horizon"
                value={horizonIndex}
                onChange={(event) => {
                  setHorizonIndex(Number(event.target.value));
                  setPage(0);
                }}
              >
                {result.horizons.map((item, i) => (
                  <option value={i} key={item.step}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="backtest-note">
            Each horizon uses a separate portfolio. Open positions use the last
            available close and remain unrealized.
          </p>
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
              [
                "Win rate (closed)",
                selectedHorizon.metrics.closed_trades
                  ? `${number(selectedHorizon.metrics.win_rate)}%`
                  : "—",
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
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
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
                          <td>
                            {money(
                              trade.status === "open"
                                ? trade.unrealized_pl
                                : trade.net_pl,
                            )}
                          </td>
                          <td>{number(trade.return_pct)}%</td>
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
                  Page {page + 1} of{" "}
                  {Math.ceil(selectedHorizon.trades.length / 25)}
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
            <summary>
              Skipped entries ({selectedHorizon.skipped.length})
            </summary>
            {selectedHorizon.skipped.length ? (
              <>
                <ul>
                  {selectedHorizon.skipped.slice(0, 50).map((entry, i) => (
                    <li key={i}>
                      {entry.symbol} · {dateLabel(entry.timestamp)} ·{" "}
                      {skippedLabels[entry.reason] ?? entry.reason}
                    </li>
                  ))}
                </ul>
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
                  {selectedHorizon.equity_curve.map((point, i) => (
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
            corporate-action adjustment. Results stay in this page and are
            cleared on sign out.
          </p>
        </section>
      )}
    </div>
  );
}
