import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Play,
  Square,
  Plus,
  Trash2,
  RefreshCw,
  SlidersHorizontal,
  RotateCcw,
} from "lucide-react";
import { api, session } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { BacktestResults } from "./backtest-results";
import { BacktestHistoryPanel } from "./backtest-history-panel";
import { uploadArchive } from "@/analysis/backtest-sync";
import { parseBacktestEntries } from "@/analysis/backtest-presentation";
import {
  saveBacktestArchive,
  type BacktestArchive,
} from "@/analysis/backtest-history";
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
  const [resultId, setResultId] = useState("");
  const [reportCurrency, setReportCurrency] = useState("IDR");
  const [reportTitle, setReportTitle] = useState("");
  const [reportSource, setReportSource] = useState<
    BacktestArchive["source"] | null
  >(null);
  const [archived, setArchived] = useState(false);
  const [owner, setOwner] = useState<{ id: string; revision: number } | null>(
    null,
  );
  const [historyMessage, setHistoryMessage] = useState("");
  const [bulk, setBulk] = useState("");
  const [bulkError, setBulkError] = useState("");
  const bulkRef = useRef<HTMLTextAreaElement>(null);
  const optionsOperation = useRef<AbortController | null>(null);
  const operation = useRef<AbortController | null>(null);
  const selectedUniverse = universes.find((item) => item.id === universeId);
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
    setReportSource(null);
    setBulk("");
    setBulkError("");
    setHistoryMessage("");
    setError("");
    setStage("");
  }
  useEffect(() => {
    const unsubscribe = session.onIdentityChange(() => {
      clearSnapshot();
      optionsOperation.current?.abort();
      setOwner(null);
      setRules([]);
      setUniverses([]);
    });
    const hide = () => operation.current?.abort();
    window.addEventListener("pagehide", hide);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", hide);
      operation.current?.abort();
      optionsOperation.current?.abort();
    };
  }, []);
  useEffect(() => {
    clearSnapshot();
    setOwner(null);
    if (!authenticated || !backendOnline) {
      setLoading(false);
      return;
    }
    let ignore = false;
    const controller = new AbortController();
    optionsOperation.current = controller;
    const revision = session.getIdentityRevision();
    setLoading(true);
    setLoadError("");
    (async () => {
      await api.ensureAppSession();
      const account = await api.account(controller.signal);
      if (
        ignore ||
        controller.signal.aborted ||
        session.getIdentityRevision() !== revision
      )
        return;
      if (account.user.id !== userId)
        throw Error(
          "Account changed. Refresh the app before using backtesting.",
        );
      if (!account.features.includes("backtest"))
        throw new Error(
          "Backtesting is not enabled for your account. Check Plan & access.",
        );
      if (account.user.status !== "active")
        throw Error("An active account is required for backtesting.");
      setOwner({ id: account.user.id, revision });
      const [ruleList, universeList, capabilities] = await Promise.all([
        api.listRules(controller.signal),
        api.listStockUniverses(controller.signal),
        api.backtestCapabilities(controller.signal),
      ]);
      if (
        capabilities.backtest?.policy_version !== "holding-next-open-1" ||
        capabilities.backtest.schema_version !== "backtest-2"
      )
        throw new Error(
          "Backtest version mismatch. Update the backend and WASM assets, then refresh the app.",
        );
      if (
        ignore ||
        controller.signal.aborted ||
        session.getIdentityRevision() !== revision
      )
        return;
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
    setHistoryMessage("");
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
      let evaluatedRule: RuleResource | undefined;
      const report = await runBacktest(
        snapshot,
        settings,
        ruleId,
        entries,
        controller.signal,
        setStage,
        (rule) => {
          evaluatedRule = rule;
        },
      );
      controller.signal.throwIfAborted();
      if (operation.current !== controller) return;
      setResult(report);
      setReportCurrency(snapshot.manifest.currency);
      setArchived(false);
      const id = crypto.randomUUID();
      setResultId(id);
      const universe = universes.find((u) => u.id === universeId)!;
      const rule = evaluatedRule;
      const title = `${settings.mode === "rule" ? (rule?.name ?? "Rule") : "Manual"} · ${universe.name} · ${settings.from}–${settings.to}`;
      setReportTitle(title);
      setStage("Backtest complete.");
      if (owner && owner.revision === snapshot.revision) {
        const archive: BacktestArchive = {
          format_version: 1,
          id,
          owner_id: owner.id,
          saved_at: new Date().toISOString(),
          title,
          currency: snapshot.manifest.currency,
          source: {
            dataset_id: snapshot.manifest.dataset_id,
            version: snapshot.manifest.version,
            checksum: snapshot.manifest.checksum,
            universe: {
              id: universe.id,
              name: universe.name,
              version: universe.version,
              symbols: [...snapshot.manifest.symbols],
            },
            ...(rule
              ? {
                  rule: {
                    id: rule.id,
                    name: rule.name,
                    version: rule.version,
                    definition_hash: rule.definition_hash,
                  },
                }
              : {}),
          },
          result: report,
        };
        setReportSource(archive.source);
        try {
          await saveBacktestArchive(
            archive,
            controller.signal,
            () =>
              operation.current === controller &&
              session.getIdentityRevision() === owner.revision &&
              !!session.getToken(),
          );
          if (operation.current === controller && !controller.signal.aborted)
            setHistoryMessage(
              "Saved to this account's local history. Uploading server copy…",
            );
          try {
            await uploadArchive(
              archive,
              controller.signal,
              () =>
                operation.current === controller &&
                session.getIdentityRevision() === owner.revision &&
                !!session.getToken(),
            );
            if (operation.current === controller && !controller.signal.aborted)
              setHistoryMessage(
                "Saved to this account's server history and this browser.",
              );
          } catch (cause) {
            if (operation.current === controller && !controller.signal.aborted)
              setHistoryMessage(
                `Saved locally only. Server sync failed: ${cause instanceof Error ? cause.message : "Retry from history."}`,
              );
          }
        } catch (cause) {
          if (operation.current === controller && !controller.signal.aborted)
            setHistoryMessage(
              `Result is available, but history was not saved. ${cause instanceof Error ? cause.message : "Check browser storage permissions and retry a new run."}`,
            );
        }
      }
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
  function addBulk() {
    if (!prepared) return;
    try {
      const added = parseBacktestEntries(
        bulk,
        prepared.dataset,
        config,
        entries,
      );
      setEntries((current) => [...current, ...added]);
      setBulk("");
      setBulkError("");
      setResult(null);
      setError("");
    } catch (cause) {
      setBulkError(
        cause instanceof Error
          ? cause.message
          : "Manual rows could not be added.",
      );
      bulkRef.current?.focus();
    }
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
        className="backtest-panel backtest-config"
        aria-labelledby="backtest-config-heading"
      >
        <div className="backtest-section-heading backtest-config-heading">
          <div className="resource-title-lockup">
            <span aria-hidden="true">
              <SlidersHorizontal />
            </span>
            <div>
              <h3 id="backtest-config-heading">Configuration</h3>
              <p className="backtest-note">
                Signals use completed candles. Entry is at the next candle's
                open; one position at a time.
              </p>
            </div>
          </div>
          <Badge variant="outline">Daily · Long only</Badge>
        </div>
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
            <fieldset disabled={busy} className="backtest-config-fields">
              <fieldset className="backtest-config-section">
                <legend>Entry setup</legend>
                <FieldGroup
                  className="backtest-fields"
                  data-columns={config.mode === "rule" ? 3 : 2}
                >
                  <Field className="backtest-field">
                    <FieldLabel htmlFor="bt-mode">Entry mode</FieldLabel>
                    <select
                      id="bt-mode"
                      value={config.mode}
                      onChange={(event) =>
                        update(
                          "mode",
                          event.target.value as BacktestConfig["mode"],
                        )
                      }
                    >
                      <option value="rule">Rule</option>
                      <option value="manual">Manual</option>
                    </select>
                  </Field>
                  <Field className="backtest-field">
                    <FieldLabel htmlFor="bt-universe">
                      Stock universe
                    </FieldLabel>
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
                  </Field>
                  {config.mode === "rule" && (
                    <Field className="backtest-field">
                      <FieldLabel htmlFor="bt-rule">Entry rule</FieldLabel>
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
                    </Field>
                  )}
                </FieldGroup>
              </fieldset>
              <fieldset className="backtest-config-section">
                <legend>Test period</legend>
                <FieldGroup className="backtest-fields">
                  <Field className="backtest-field">
                    <FieldLabel htmlFor="bt-from">From date (UTC)</FieldLabel>
                    <Input
                      id="bt-from"
                      type="date"
                      required
                      max={config.to}
                      value={config.from}
                      onChange={(event) => update("from", event.target.value)}
                    />
                  </Field>
                  <Field className="backtest-field">
                    <FieldLabel htmlFor="bt-to">To date (UTC)</FieldLabel>
                    <Input
                      id="bt-to"
                      type="date"
                      required
                      min={config.from}
                      max={new Date().toISOString().slice(0, 10)}
                      value={config.to}
                      onChange={(event) => update("to", event.target.value)}
                    />
                  </Field>
                  <Field className="backtest-field">
                    <FieldLabel htmlFor="bt-horizon">
                      Holding period (candles)
                    </FieldLabel>
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
                  </Field>
                </FieldGroup>
              </fieldset>
              <fieldset className="backtest-config-section">
                <legend>Capital & position</legend>
                <FieldGroup className="backtest-fields">
                  <Field className="backtest-field">
                    <FieldLabel htmlFor="bt-capital">
                      Initial capital
                    </FieldLabel>
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
                  </Field>
                  <Field className="backtest-field">
                    <FieldLabel htmlFor="bt-sizing">Position sizing</FieldLabel>
                    <select
                      id="bt-sizing"
                      value={config.position_sizing}
                      onChange={(event) =>
                        update(
                          "position_sizing",
                          event.target
                            .value as BacktestConfig["position_sizing"],
                        )
                      }
                    >
                      <option value="percent_equity">Percent of equity</option>
                      <option value="fixed_amount">Fixed amount</option>
                    </select>
                  </Field>
                  <Field className="backtest-field">
                    <FieldLabel htmlFor="bt-size">
                      {config.position_sizing === "percent_equity"
                        ? "Position size (%)"
                        : "Position amount"}
                    </FieldLabel>
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
                  </Field>
                </FieldGroup>
              </fieldset>
              <fieldset className="backtest-config-section">
                <legend>Trading costs</legend>
                <FieldGroup className="backtest-fields" data-columns={2}>
                  <Field className="backtest-field">
                    <FieldLabel htmlFor="bt-fee">
                      Commission per side (%)
                    </FieldLabel>
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
                  </Field>
                  <Field className="backtest-field">
                    <FieldLabel htmlFor="bt-slip">
                      Slippage per side (%)
                    </FieldLabel>
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
                  </Field>
                </FieldGroup>
              </fieldset>
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
                variant="destructive"
                disabled={busy}
                onClick={clearSnapshot}
              >
                <RotateCcw data-icon="inline-start" />
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
          <details>
            <summary>Add multiple manual entries</summary>
            <p className="backtest-note" id="bt-bulk-help">
              One symbol,timestamp per line, optional header. Use exact snapshot
              timestamps. BUY only; maximum 2,000 entries including the list
              below.
              {availableCandles[0] && (
                <>
                  {" "}
                  Example from this snapshot:{" "}
                  <code>
                    {entrySymbol},{availableCandles[0].timestamp}
                  </code>
                  .
                </>
              )}
            </p>
            <label htmlFor="bt-bulk">Manual entry rows</label>
            <textarea
              ref={bulkRef}
              id="bt-bulk"
              rows={6}
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              disabled={busy}
              aria-describedby="bt-bulk-help bt-bulk-error"
              aria-invalid={!!bulkError}
            />
            <p
              id="bt-bulk-error"
              className="backtest-error"
              role={bulkError ? "alert" : undefined}
            >
              {bulkError}
            </p>
            <Button
              variant="outline"
              disabled={busy || !bulk.trim()}
              onClick={addBulk}
            >
              Add all entries
            </Button>
          </details>
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

      {historyMessage && (
        <p role="status" className="backtest-note">
          {historyMessage}
        </p>
      )}
      {result && (
        <BacktestResults
          key={resultId}
          result={result}
          currency={reportCurrency}
          title={reportTitle}
          source={reportSource}
          archived={archived}
          onClose={() => setResult(null)}
        />
      )}
      {owner && (
        <BacktestHistoryPanel
          key={`${owner.id}:${owner.revision}`}
          owner={owner.id}
          revision={owner.revision}
          onOpen={(archive) => {
            clearSnapshot();
            setResult(archive.result);
            setResultId(archive.id);
            setReportCurrency(archive.currency);
            setReportTitle(archive.title);
            setReportSource(archive.source);
            setArchived(true);
            setHistoryMessage("");
            setError("");
            setStage("");
          }}
        />
      )}
    </div>
  );
}
