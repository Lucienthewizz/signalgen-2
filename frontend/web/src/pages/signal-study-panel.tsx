import { Profiler, useEffect, useRef, useState, type FormEvent } from "react";
import { api, session, ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field";
import { SlidersHorizontal, Play, Square, RefreshCw } from "lucide-react";
import { runSignalStudy, type StudyProgress } from "@/analysis/signal-study";
import {
  clearStudyOwner,
  studyEventPage,
} from "@/analysis/signal-study-storage";
import type {
  StudyConfig,
  StudyEvent,
  StudyMetrics,
} from "@/analysis/signal-study-types";
import type { RuleResource, StockUniverse } from "@/types";
import { csvCell, downloadCsv } from "@/lib/csv";
import { CACHE_RESET_EVENT } from "@/data/historical-cache";

function defaults(): StudyConfig {
  const now = new Date(),
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)),
    start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
    n_steps: 3,
  };
}
const pct = (n: number | null) => (n == null ? "—" : `${n.toFixed(2)}%`);
export function SignalStudyPanel({
  authenticated,
  backendOnline,
  userId,
}: {
  authenticated: boolean;
  backendOnline: boolean;
  userId?: string;
}) {
  const [config, setConfig] = useState(defaults),
    [source, setSource] = useState("IDX"),
    [rule, setRule] = useState("default-scalping-v1"),
    [rules, setRules] = useState<RuleResource[]>([]),
    [universes, setUniverses] = useState<StockUniverse[]>([]),
    [universe, setUniverse] = useState("");
  const [progress, setProgress] = useState<StudyProgress | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [optionsError, setOptionsError] = useState(""),
    [closed, setClosed] = useState(false),
    [reload, setReload] = useState(0);
  const [page, setPage] = useState(0),
    [rows, setRows] = useState<StudyEvent[]>([]),
    [total, setTotal] = useState(0),
    [groupPage, setGroupPage] = useState(0);
  const [horizonPage, setHorizonPage] = useState(0);
  const operation = useRef<AbortController | null>(null),
    current = useRef<StudyProgress | null>(null),
    ownerRef = useRef(userId);
  const frozenSelection = useRef("");
  const selectionSignature = JSON.stringify({ source, rule, universe, config });
  ownerRef.current = userId;
  const contextKey = `signalgen.study.context:${userId ?? ""}`;
  async function discardContext(id: string, keepalive = false) {
    try {
      await api.cancelStudy(id, keepalive);
    } catch (e) {
      if (!(e instanceof ApiError) || ![403, 404].includes(e.status)) throw e;
    }
    if (sessionStorage.getItem(contextKey) === id)
      sessionStorage.removeItem(contextKey);
  }
  const measurements = useRef<
    Record<string, { count: number; values: number[] }>
  >({});
  const recordSample = (stage: string, ms: number) => {
    const row = (measurements.current[stage] ??= { count: 0, values: [] });
    row.count++;
    row.values.push(ms);
    if (row.values.length > 2048) row.values.shift();
  };
  const exportPerformance = () => {
    const stages = Object.fromEntries(
      Object.entries(measurements.current).map(([key, row]) => {
        const sorted = [...row.values].sort((a, b) => a - b);
        return [
          key,
          {
            count: row.count,
            retained_samples: sorted.length,
            p50: sorted[Math.max(0, Math.ceil(sorted.length * 0.5) - 1)],
            p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)],
          },
        ];
      }),
    );
    const evidence = {
      kind: "browser_elapsed_stages",
      user_agent: navigator.userAgent,
      logical_cpus: navigator.hardwareConcurrency,
      study: progress?.context,
      completed: progress?.completed,
      failed: progress?.failures.length,
      traffic: progress?.traffic,
      stages,
      limits:
        "Last 2048 samples per stage; access/prepare/grant/scoring include network and server waiting. React duration excludes paint. No production capacity claim.",
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(evidence, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "signal-study-performance.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const cancel = () => {
    operation.current?.abort();
    setClosed(true);
    setBusy(false);
    setMessage(
      "Stopped. Completed results remain available; this is not a complete-market result.",
    );
    if (current.current)
      void discardContext(current.current.context.id).catch(() => {});
  };
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    if (!authenticated || !userId) return;
    const revision = session.getIdentityRevision();
    void (async () => {
      await api.ensureAppSession();
      const result = await Promise.allSettled([
        api.listRules(controller.signal),
        api.listStockUniverses(controller.signal),
      ]);
      if (!active || revision !== session.getIdentityRevision()) return;
      if (result[0].status === "fulfilled") setRules(result[0].value.items);
      if (result[1].status === "fulfilled") {
        setUniverses(result[1].value.items);
        setUniverse(
          (v) =>
            v ||
            (result[1].status === "fulfilled" &&
              result[1].value.items[0]?.id) ||
            "",
        );
      }
      setOptionsError(
        result.some((r) => r.status === "rejected")
          ? "Some saved selections could not be loaded. Default rule and whole-market sources remain available; retry selections when the service recovers."
          : "",
      );
    })().catch((e) => {
      if (active)
        setOptionsError(
          e instanceof Error ? e.message : "Could not load selections.",
        );
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [authenticated, userId, reload]);
  useEffect(() => {
    const stop = () => operation.current?.abort();
    const reset = () => {
      stop();
      setClosed(true);
      setProgress(null);
      current.current = null;
      setRows([]);
      setBusy(false);
    };
    const clear = session.onIdentityChange(() => {
      stop();
      if (userId) void clearStudyOwner(userId).catch(() => {});
      setProgress(null);
      current.current = null;
      setRows([]);
      setBusy(false);
    });
    const pageHide = () => {
      stop();
      if (current.current)
        void discardContext(current.current.context.id, true).catch(() => {});
    };
    window.addEventListener("pagehide", pageHide);
    window.addEventListener(CACHE_RESET_EVENT, reset);
    return () => {
      stop();
      clear();
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener(CACHE_RESET_EVENT, reset);
      if (current.current && session.getToken())
        void discardContext(current.current.context.id).catch(() => {});
      if (userId) void clearStudyOwner(userId).catch(() => {});
    };
  }, [userId]);
  useEffect(() => {
    if (!progress || !userId) return;
    let active = true;
    const id = progress.context.id;
    void studyEventPage(userId, id, page)
      .then((p) => {
        if (active && current.current?.context.id === id) {
          setRows(p.rows);
          setTotal(p.total);
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [progress?.completed, progress?.context.id, userId, page]);
  async function start(retry = false) {
    if (operation.current || !userId) return;
    if (retry && frozenSelection.current !== selectionSignature) {
      setError(
        "Settings changed. Start a new study; retry cannot change the frozen rule, market or dates.",
      );
      return;
    }
    const controller = new AbortController();
    operation.current = controller;
    const owner = userId,
      revision = session.getIdentityRevision();
    setBusy(true);
    setError("");
    setMessage("Checking access and preparing historical batches…");
    const active = () =>
      operation.current === controller &&
      !controller.signal.aborted &&
      ownerRef.current === owner &&
      revision === session.getIdentityRevision();
    try {
      if (!retry) {
        frozenSelection.current = selectionSignature;
        measurements.current = {};
        setClosed(false);
        await api.ensureAppSession();
        if (!active()) return;
        const previousContext =
          current.current?.context.id ?? sessionStorage.getItem(contextKey);
        if (previousContext) await discardContext(previousContext);
        await clearStudyOwner(owner);
        controller.signal.throwIfAborted();
        setProgress(null);
        current.current = null;
        setRows([]);
        setPage(0);
        setGroupPage(0);
        setHorizonPage(0);
      }
      const result = await runSignalStudy(
        {
          source: source === "universe" ? "universe" : "market",
          market: source === "US" ? "US" : "IDX",
          ...(source === "universe" ? { universe_id: universe } : {}),
          rule_id: rule,
          config,
        },
        owner,
        controller.signal,
        (p) => {
          if (active()) {
            current.current = p;
            sessionStorage.setItem(contextKey, p.context.id);
            setProgress(p);
            setMessage(
              p.waitingUntil
                ? `Server rate limit. Waiting until ${new Date(p.waitingUntil).toLocaleTimeString()} before retrying; Stop remains available.`
                : `Processed ${p.completed}/${p.context.total} stocks; ${p.failures.length} failed, ${p.failedBatches.length} interrupted batches.`,
            );
          }
        },
        retry ? (current.current ?? undefined) : undefined,
        recordSample,
      );
      if (active()) {
        setMessage(
          result.completed === result.context.total
            ? "Completed the frozen catalog. Review data-quality limits before interpreting results."
            : "Partial result. Failed or remaining stocks are not counted as successfully evaluated.",
        );
        if (result.completed === result.context.total)
          await discardContext(result.context.id).catch(() => {});
      }
    } catch (e) {
      if (active()) {
        setError(e instanceof Error ? e.message : "Study failed.");
        if (
          e &&
          typeof e === "object" &&
          "status" in e &&
          [401, 403, 404, 409].includes(Number(e.status))
        )
          setClosed(true);
      }
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  async function exportEvents() {
    if (!userId || !progress) return;
    const owner = userId,
      run = progress.context.id,
      revision = session.getIdentityRevision();
    try {
      const chunks: BlobPart[] = [
        "\uFEFF" +
          [
            "symbol",
            "signal_time",
            "direction",
            "reference_close",
            "horizon",
            "basis",
            "status",
            "price",
            "return_pct",
            "currency",
            "policy",
            "catalog_hash",
          ]
            .map(csvCell)
            .join(",") +
          "\r\n",
      ];
      for (let p = 0; ; p++) {
        const found = await studyEventPage(owner, run, p, 100);
        if (
          ownerRef.current !== owner ||
          revision !== session.getIdentityRevision()
        )
          return;
        chunks.push(
          found.rows
            .flatMap((e) =>
              [...e.outcomes, e.swing].map((o) =>
                [
                  e.symbol,
                  e.timestamp,
                  e.signal_type,
                  e.reference_price,
                  o.step,
                  o.basis,
                  o.status,
                  o.price,
                  o.return_pct,
                  progress.context.currency,
                  progress.context.policy_version,
                  progress.context.catalog_hash,
                ]
                  .map(csvCell)
                  .join(","),
              ),
            )
            .join("\r\n") + "\r\n",
        );
        if ((p + 1) * 100 >= found.total) break;
      }
      const url = URL.createObjectURL(
          new Blob(chunks, { type: "text/csv;charset=utf-8" }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = "signal-study-events.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    }
  }
  if (!authenticated || !userId)
    return <p role="status">Sign in to analyse historical signals.</p>;
  const ready = progress?.context;
  const selectedMetrics = progress?.swing;
  const summaries = (items: Array<StudyMetrics & { key: string }>) =>
    items.slice(groupPage * 25, groupPage * 25 + 25);
  return (
    <Profiler
      id="signal-study"
      onRender={(_id, _phase, duration) =>
        recordSample("react_render_ms", duration)
      }
    >
      <section className="signal-study-panel" aria-labelledby="study-heading">
        <header className="study-config-heading">
          <span className="study-config-heading__icon" aria-hidden="true">
            <SlidersHorizontal />
          </span>
          <div>
            <h2 id="study-heading">Analyse every signal</h2>
            <p>
              Independent daily observations from the signal candle’s close. Not
              a cash portfolio or executed trades.
            </p>
          </div>
          <Badge variant="outline">Daily candles</Badge>
        </header>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void start();
          }}
        >
          <fieldset disabled={busy} className="study-fields">
            <legend className="sr-only">Historical study settings</legend>
            <FieldSet className="study-settings-section">
              <FieldLegend>Source &amp; rule</FieldLegend>
              <FieldGroup className="study-form-grid" data-columns="2">
                <Field>
                  <FieldLabel htmlFor="study-source">Stock source</FieldLabel>
                  <select
                    id="study-source"
                    aria-label="Stock source"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    <option value="IDX">Entire IDX catalog · IDR</option>
                    <option value="US">Entire US catalog · USD</option>
                    <option value="universe" disabled={!universes.length}>
                      My stock universe
                    </option>
                  </select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="study-rule">Screening rule</FieldLabel>
                  <select
                    id="study-rule"
                    aria-label="Screening rule"
                    required
                    value={rule}
                    onChange={(e) => setRule(e.target.value)}
                  >
                    <option value="default-scalping-v1">
                      Default Scalping
                    </option>
                    {rules
                      .filter((r) => r.id !== "default-scalping-v1")
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ·{" "}
                          {r.definition?.signal_type ?? "System rule"}
                        </option>
                      ))}
                  </select>
                </Field>
                {source === "universe" && (
                  <Field className="study-universe-field">
                    <FieldLabel htmlFor="study-universe">
                      Stock universe
                    </FieldLabel>
                    <select
                      id="study-universe"
                      aria-label="Stock universe"
                      required
                      value={universe}
                      onChange={(e) => setUniverse(e.target.value)}
                    >
                      {universes.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </FieldGroup>
            </FieldSet>
            <FieldSet className="study-settings-section">
              <FieldLegend>Test period</FieldLegend>
              <FieldGroup className="study-form-grid" data-columns="3">
                <Field>
                  <FieldLabel htmlFor="study-from">
                    From (daily session, UTC)
                  </FieldLabel>
                  <Input
                    id="study-from"
                    required
                    type="date"
                    value={config.from}
                    onChange={(e) =>
                      setConfig({ ...config, from: e.target.value })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="study-to">
                    To (inclusive, UTC)
                  </FieldLabel>
                  <Input
                    id="study-to"
                    required
                    type="date"
                    value={config.to}
                    onChange={(e) =>
                      setConfig({ ...config, to: e.target.value })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="study-horizon">
                    Trading candles after signal
                  </FieldLabel>
                  <Input
                    id="study-horizon"
                    required
                    type="number"
                    min={1}
                    max={100}
                    value={config.n_steps}
                    onChange={(e) =>
                      setConfig({ ...config, n_steps: Number(e.target.value) })
                    }
                  />
                  <FieldDescription>
                    1–100 completed daily candles, not calendar days.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </FieldSet>
            <FieldSet className="study-settings-section">
              <FieldLegend>Take profit &amp; stop loss</FieldLegend>
              <FieldGroup className="study-form-grid" data-columns="2">
                <Field>
                  <FieldLabel htmlFor="study-tp">
                    Take profit % (optional)
                  </FieldLabel>
                  <Input
                    id="study-tp"
                    type="number"
                    min="0.01"
                    max="99.99"
                    step="any"
                    value={config.take_profit_pct ?? ""}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        take_profit_pct: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="study-sl">
                    Stop loss % (optional)
                  </FieldLabel>
                  <Input
                    id="study-sl"
                    type="number"
                    min="0.01"
                    max="99.99"
                    step="any"
                    value={config.stop_loss_pct ?? ""}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        stop_loss_pct: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      })
                    }
                  />
                </Field>
              </FieldGroup>
              <p className="study-settings-note">
                Leave a target empty to skip it. If both are touched in the same
                candle, stop loss comes first.
              </p>
            </FieldSet>
          </fieldset>
          <div className="study-actions study-config-actions">
            <Button type="submit" disabled={busy || !backendOnline}>
              <Play data-icon="inline-start" />
              Start signal study
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!busy}
              onClick={cancel}
            >
              <Square data-icon="inline-start" />
              Stop study
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setReload((n) => n + 1)}
            >
              <RefreshCw data-icon="inline-start" />
              Reload selections
            </Button>
          </div>
        </form>
        {optionsError && <p role="status">{optionsError}</p>}
        {!backendOnline && (
          <p role="status">
            Backend unavailable. Existing results remain visible; reconnect
            before starting.
          </p>
        )}
        <p role="status" aria-live="polite" aria-atomic="true">
          {message}
        </p>
        {error && <p role="alert">{error}</p>}
        {progress && (
          <>
            <progress
              aria-label="Catalog study progress"
              max={ready!.total}
              value={progress.completed}
            />
            <p>
              {progress.completed}/{ready!.total} stocks processed ·{" "}
              {progress.failures.length} failed · {progress.remaining} remaining
              · {ready!.market}/{ready!.currency}
            </p>
            <p>
              Frozen period: {ready!.config.from}–{ready!.config.to}; T+
              {ready!.config.n_steps}. Catalog{" "}
              {ready!.catalog_hash.slice(0, 20)}…
            </p>
            <p>
              Signals: {selectedMetrics!.signals} · Evaluated swing:{" "}
              {selectedMetrics!.evaluated} · Missing future data:{" "}
              {selectedMetrics!.missing} · Win rate:{" "}
              {pct(selectedMetrics!.win_rate)}
            </p>
            {!!(
              progress.failures.some((f) => f.retryable) ||
              progress.failedBatches.length
            ) && (
              <Button
                disabled={
                  busy ||
                  closed ||
                  frozenSelection.current !== selectionSignature
                }
                variant="outline"
                onClick={() => void start(true)}
              >
                Retry failed stocks
              </Button>
            )}
            {frozenSelection.current !== selectionSignature && (
              <p role="status">
                Settings changed. Start a new study to apply them; the displayed
                result still uses its frozen context.
              </p>
            )}
            <div className="study-actions">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void exportEvents()}
              >
                Export signal details CSV
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  downloadCsv("signal-study-horizons.csv", [
                    [
                      "step",
                      "basis",
                      "evaluated",
                      "missing",
                      "wins",
                      "losses",
                      "flats",
                      "win_rate_pct",
                      "mean_return_pct",
                    ],
                    ...progress.horizons.map((h) => [
                      h.step,
                      h.basis,
                      h.evaluated,
                      h.missing,
                      h.wins,
                      h.losses,
                      h.flats,
                      h.win_rate,
                      h.mean_return_pct,
                    ]),
                  ])
                }
              >
                Export all horizons CSV
              </Button>
            </div>
            <p>
              High is historical potential, not an obtainable sale price.
              Same-candle TP/SL assumes SL first. No broker orders, fees, or
              cash allocation are simulated in this mode.
            </p>
            <div className="study-table-scroll">
              <table>
                <caption>All signal outcomes by horizon</caption>
                <thead>
                  <tr>
                    <th>Horizon</th>
                    <th>Basis</th>
                    <th>Evaluated</th>
                    <th>Missing</th>
                    <th>Win / loss / flat</th>
                    <th>Win rate</th>
                    <th>Mean return</th>
                  </tr>
                </thead>
                <tbody>
                  {progress.horizons
                    .slice(horizonPage * 30, (horizonPage + 1) * 30)
                    .map((h) => (
                      <tr key={h.step + h.basis}>
                        <td>T+{h.step}</td>
                        <td>{h.basis}</td>
                        <td>{h.evaluated}</td>
                        <td>{h.missing}</td>
                        <td>
                          {h.wins}/{h.losses}/{h.flats}
                        </td>
                        <td>{pct(h.win_rate)}</td>
                        <td>{pct(h.mean_return_pct)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="study-actions">
              <Button
                variant="ghost"
                disabled={!horizonPage}
                onClick={() => setHorizonPage((p) => p - 1)}
              >
                Previous horizons
              </Button>
              <Button
                variant="ghost"
                disabled={(horizonPage + 1) * 30 >= progress.horizons.length}
                onClick={() => setHorizonPage((p) => p + 1)}
              >
                Next horizons
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  downloadCsv("signal-study-coverage.csv", [
                    [
                      "study_id",
                      "catalog_hash",
                      "rule_hash",
                      "market",
                      "currency",
                      "total",
                      "completed",
                      "failed",
                      "remaining",
                      "status",
                    ],
                    [
                      ready!.id,
                      ready!.catalog_hash,
                      ready!.definition_hash,
                      ready!.market,
                      ready!.currency,
                      ready!.total,
                      progress.completed,
                      progress.failures.length,
                      progress.remaining,
                      progress.completed === ready!.total
                        ? "complete"
                        : "partial",
                    ],
                    ["symbol", "error_code", "retryable", "batch"],
                    ...progress.failures.map((f) => [
                      f.symbol,
                      f.code,
                      f.retryable,
                      f.batch,
                    ]),
                    ["unresolved_batches", ...progress.pendingBatches],
                  ])
                }
              >
                Export coverage CSV
              </Button>
            </div>
            <details>
              <summary>By stock and signal day (swing outcomes)</summary>
              {[progress.bySymbol, progress.byDay].map((items, i) => (
                <div key={i} className="study-table-scroll">
                  <table>
                    <caption>{i ? "By signal day" : "By stock"}</caption>
                    <thead>
                      <tr>
                        <th>{i ? "Day" : "Symbol"}</th>
                        <th>Signals</th>
                        <th>Evaluated</th>
                        <th>Missing</th>
                        <th>Win rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaries(items).map((r) => (
                        <tr key={r.key}>
                          <td>{r.key}</td>
                          <td>{r.signals}</td>
                          <td>{r.evaluated}</td>
                          <td>{r.missing}</td>
                          <td>{pct(r.win_rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              <Button
                variant="ghost"
                disabled={groupPage === 0}
                onClick={() => setGroupPage((p) => p - 1)}
              >
                Previous summary
              </Button>
              <Button
                variant="ghost"
                disabled={
                  (groupPage + 1) * 25 >=
                  Math.max(progress.bySymbol.length, progress.byDay.length)
                }
                onClick={() => setGroupPage((p) => p + 1)}
              >
                Next summary
              </Button>
            </details>
            <div className="study-table-scroll">
              <table>
                <caption>
                  Signal details — T+{ready!.config.n_steps} and swing; {total}{" "}
                  signals
                </caption>
                <thead>
                  <tr>
                    <th>Stock</th>
                    <th>Signal candle</th>
                    <th>Direction</th>
                    <th>Reference close</th>
                    <th>Open return</th>
                    <th>High return</th>
                    <th>Close return</th>
                    <th>Swing</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.symbol + e.timestamp}>
                      <td>{e.symbol}</td>
                      <td>{e.timestamp.slice(0, 10)}</td>
                      <td>{e.signal_type}</td>
                      <td>{e.reference_price}</td>
                      {e.outcomes
                        .filter((o) => o.step === ready!.config.n_steps)
                        .map((o) => (
                          <td key={o.basis}>{pct(o.return_pct)}</td>
                        ))}
                      <td>
                        {e.swing.status} · {pct(e.swing.return_pct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="study-actions">
              <Button
                variant="ghost"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous signals
              </Button>
              <span>Page {page + 1}</span>
              <Button
                variant="ghost"
                disabled={(page + 1) * 50 >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next signals
              </Button>
            </div>
            {!!progress.failures.length && (
              <details>
                <summary>
                  Provider and history failures ({progress.failures.length})
                </summary>
                <ul>
                  {progress.failures.slice(0, 100).map((f) => (
                    <li key={f.symbol}>
                      {f.symbol}: {f.code}{" "}
                      {f.retryable
                        ? "(retry available)"
                        : "(insufficient history)"}
                    </li>
                  ))}
                </ul>
                {progress.failures.length > 100 && (
                  <p>
                    First 100 failures shown. Coverage counts include all
                    failures.
                  </p>
                )}
              </details>
            )}
            <details>
              <summary>Measured stages for this run (milliseconds)</summary>
              <pre>{JSON.stringify(progress.timings, null, 2)}</pre>
              <p>
                Decoded candle bytes:{" "}
                {progress.traffic.decoded_candle_bytes.toLocaleString()} ·
                Feature candidate JSON bytes:{" "}
                {progress.traffic.candidate_json_bytes.toLocaleString()}.
                Excludes HTTP headers, grant/context metadata, and compression.
              </p>
              <Button variant="outline" onClick={exportPerformance}>
                Export measured stages JSON
              </Button>
              <p>
                Client elapsed time includes requests and waiting; it is not
                server CPU time or a production benchmark.
              </p>
            </details>
          </>
        )}
      </section>
    </Profiler>
  );
}
