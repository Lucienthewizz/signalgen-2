import { StudyRecovery, useStudyRecovery } from "@/components/study-recovery";
import Stepper from "@/components/react-bits/Stepper";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "@/api/client";
import {
  runSignalStudy,
  studyCanRetry,
  type StudyProgress,
} from "@/analysis/signal-study";
import {
  StudyRunIssues,
  StudyRunSummary,
} from "@/components/study-run-summary";
import { studyEventPage } from "@/analysis/signal-study-storage";
import type { StudyEvent } from "@/analysis/signal-study-types";
import type { RuleResource, StockUniverse } from "@/types";
import { SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/date-input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";

export function MarketScreenPanel({
  userId,
  backendOnline,
}: {
  userId?: string;
  backendOnline: boolean;
}) {
  const [source, setSource] = useState("IDX"),
    [rule, setRule] = useState("default-scalping-v1");
  const [rules, setRules] = useState<RuleResource[]>([]),
    [universes, setUniverses] = useState<StockUniverse[]>([]);
  const [from, setFrom] = useState(
    new Date(Date.now() - 86400000).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(from),
    [busy, setBusy] = useState(false),
    [closed, setClosed] = useState(false),
    [error, setError] = useState("");
  const [progress, setProgress] = useState<StudyProgress | null>(null),
    [page, setPage] = useState(0);
  const [result, setResult] = useState<{ rows: StudyEvent[]; total: number }>({
    rows: [],
    total: 0,
  });
  const recovery = useStudyRecovery(userId, "screen", backendOnline);
  const operation = useRef<AbortController | null>(null),
    current = useRef<StudyProgress | null>(null);
  const runClock = useRef({ started: 0, priorElapsed: 0, contextId: "" });
  const frozenSelection = useRef("");
  const selection = JSON.stringify([source, rule, from, to]);
  const [reload, setReload] = useState(0),
    [optionsError, setOptionsError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api.listRules(controller.signal),
      api.listStockUniverses(controller.signal),
    ])
      .then(([r, u]) => {
        if (!controller.signal.aborted) {
          setRules(r.items);
          setUniverses(u.items);
          setOptionsError("");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setOptionsError(
            "Selections unavailable. Retry loading your rules and universes.",
          );
      });
    return () => controller.abort();
  }, [userId, reload]);
  useEffect(
    () => () => {
      operation.current?.abort();
      if (current.current)
        void api
          .cancelStudy(current.current.context.id, true, "screen")
          .catch(() => {});
    },
    [userId],
  );
  useEffect(() => {
    let active = true;
    if (userId && progress)
      void studyEventPage(userId, progress.context.id, page)
        .then((r) => {
          if (active) setResult(r);
        })
        .catch(() => {
          if (active)
            setError("Cannot read local signal results. Retry screening.");
        });
    return () => {
      active = false;
    };
  }, [userId, progress?.completed, progress?.context.id, page]);
  async function start(retry = false) {
    if (!userId || operation.current || recovery.blocked || !backendOnline)
      return;
    const previous = current.current;
    if (retry && (!previous || closed || frozenSelection.current !== selection))
      return;
    const controller = new AbortController();
    operation.current = controller;
    runClock.current = {
      started: performance.now(),
      priorElapsed: retry ? (previous?.elapsedMs ?? 0) : 0,
      contextId: retry ? (previous?.context.id ?? "") : "",
    };
    setBusy(true);
    setError("");
    try {
      if (!retry) {
        if (previous)
          await api
            .cancelStudy(previous.context.id, false, "screen")
            .catch((e) => {
              if (!(e instanceof ApiError) || e.status !== 404) throw e;
            });
        controller.signal.throwIfAborted();
        frozenSelection.current = selection;
        current.current = null;
        setClosed(false);
        setProgress(null);
        setPage(0);
        setResult({ rows: [], total: 0 });
      }
      const p = await runSignalStudy(
        {
          purpose: "screen",
          source: source === "IDX" || source === "US" ? "market" : "universe",
          market: source === "US" ? "US" : "IDX",
          ...(source !== "IDX" && source !== "US"
            ? { universe_id: source }
            : {}),
          rule_id: rule,
          config: { from, to, n_steps: 1 },
        },
        userId,
        controller.signal,
        (p) => {
          if (!controller.signal.aborted) {
            runClock.current.contextId = p.context.id;
            current.current = p;
            setProgress(p);
          }
        },
        retry ? previous! : undefined,
      );
      if (!controller.signal.aborted) {
        current.current = p;
        setProgress(p);
        if (!studyCanRetry(p)) {
          setClosed(true);
          await api.cancelStudy(p.context.id, false, "screen").catch(() => {});
        }
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "STUDY_CAPACITY")
        void recovery.refresh(true);
      if (
        !controller.signal.aborted &&
        e instanceof ApiError &&
        [401, 403, 404, 409].includes(e.status)
      )
        setClosed(true);
      if (
        !controller.signal.aborted &&
        !(e instanceof ApiError && e.code === "STUDY_CAPACITY")
      )
        setError(
          e instanceof Error
            ? e.message
            : "Screening failed. Retry when connected.",
        );
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  function stop() {
    operation.current?.abort();
    setClosed(true);
    if (current.current) {
      if (current.current.context.id === runClock.current.contextId) {
        current.current = {
          ...current.current,
          elapsedMs:
            runClock.current.priorElapsed +
            performance.now() -
            runClock.current.started,
        };
        setProgress(current.current);
      }
      void api
        .cancelStudy(current.current.context.id, false, "screen")
        .catch(() => {});
    }
  }
  const complete =
    progress && !busy && progress.completed === progress.context.total;
  const canRetry = progress && !closed && studyCanRetry(progress);
  function submit(event: FormEvent) {
    event.preventDefault();
    void start();
  }
  return (
    <section
      className="signal-study-panel"
      aria-labelledby="market-screen-title"
    >
      <header className="study-config-heading">
        <span className="study-config-heading__icon" aria-hidden="true">
          <SlidersHorizontal />
        </span>
        <div>
          <h2 id="market-screen-title">Market &amp; historical screening</h2>
          <p>
            Find stocks and signal dates across a market or your universe. Each
            batch processes up to 10 stocks; the search covers the full
            selection.
          </p>
        </div>
        <Badge variant="outline">Daily candles</Badge>
      </header>
      <form onSubmit={submit}>
        <Stepper
          stage={busy ? 1 : progress ? 2 : 0}
          partial={!!progress && progress.completed !== progress.context.total}
        />
        <fieldset disabled={busy} className="study-fields">
          <legend>Screening settings</legend>
          <FieldGroup className="study-form-grid">
            <Field>
              <FieldLabel htmlFor="scan-source">Stock source</FieldLabel>
              <select
                id="scan-source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="IDX">Entire IDX catalog</option>
                <option value="US">Entire US catalog</option>
                {universes.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="scan-rule">Screening rule</FieldLabel>
              <select
                id="scan-rule"
                value={rule}
                onChange={(e) => setRule(e.target.value)}
              >
                <option value="default-scalping-v1">Default Scalping</option>
                {rules
                  .filter((r) => r.id !== "default-scalping-v1")
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field>
              <FieldLabel htmlFor="scan-from">Signal date from</FieldLabel>
              <DateInput
                id="scan-from"
                required
                value={from}
                onValueChange={setFrom}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="scan-to">
                Signal date to (inclusive)
              </FieldLabel>
              <DateInput
                id="scan-to"
                required
                value={to}
                onValueChange={setTo}
              />
            </Field>
          </FieldGroup>
          <p>
            Choose the same date for a single session, or a range of up to one
            year. Only completed daily candles are used.
          </p>
        </fieldset>
        <div className="study-actions">
          <Button
            type="submit"
            disabled={busy || !backendOnline || recovery.blocked}
          >
            Start screening
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!busy}
            onClick={stop}
          >
            Stop screening
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setReload((n) => n + 1)}
          >
            Reload selections
          </Button>
        </div>
      </form>
      <p role="status">
        {optionsError}
        {!backendOnline ? " Reconnect to start screening." : ""}
      </p>
      <p role="status">
        {progress
          ? busy
            ? `${progress.completed}/${progress.context.total} stocks processed. Screening…`
            : complete
              ? "Selection complete."
              : "Partial results. Completed signals are available below."
          : busy
            ? "Checking access and preparing data…"
            : recovery.blocked
              ? "Resolve the previous run status before starting."
              : "Ready to screen."}
      </p>
      {!busy && <StudyRecovery recovery={recovery} />}
      {error && !recovery.previous && <p role="alert">{error}</p>}
      {progress && (
        <>
          <progress
            aria-label="Screening progress"
            max={progress.context.total}
            value={progress.completed}
          />
          {!busy && (
            <StudyRunSummary
              elapsedMs={progress.elapsedMs}
              completed={progress.completed}
              failed={progress.failures.length}
              remaining={progress.remaining}
              total={progress.context.total}
            />
          )}
          <p>
            Frozen screening period: {progress.context.config.from} to{" "}
            {progress.context.config.to} · Rule:{" "}
            {rules.find((item) => item.id === progress.context.rule_id)?.name ??
              progress.context.rule_id}
          </p>
          <p>
            {result.total} signals found. These results contain matching stocks
            and dates; returns are evaluated separately in Backtest.
          </p>
          {!busy && (
            <StudyRunIssues
              progress={progress}
              onRetry={canRetry ? () => void start(true) : undefined}
              retryDisabled={
                !backendOnline ||
                recovery.blocked ||
                frozenSelection.current !== selection
              }
            />
          )}
          {!busy && canRetry && frozenSelection.current !== selection && (
            <p>
              Settings changed. Restore the original selection to retry, or
              start a new run.
            </p>
          )}
          <div
            className="study-table-scroll"
            role="region"
            aria-label="Matching signals table"
            tabIndex={0}
          >
            <table>
              <caption>Matching stocks and signal dates</caption>
              <thead>
                <tr>
                  <th>Stock</th>
                  <th>Signal date (UTC)</th>
                  <th>Signal</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.symbol + r.timestamp}>
                    <td>{r.symbol}</td>
                    <td>{r.timestamp.slice(0, 10)}</td>
                    <td>{r.signal_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.total === 0 && (
            <p>
              {busy
                ? "No matches in the stocks processed so far."
                : "No matches in the processed stocks for this rule and date range."}
            </p>
          )}
          <div className="study-actions">
            <Button
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous signals
            </Button>
            <span>Page {page + 1}</span>
            <Button
              variant="outline"
              disabled={(page + 1) * 50 >= result.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next signals
            </Button>
            <Button
              nativeButton={false}
              variant="outline"
              render={
                <a
                  href="#app/backtest"
                  onClick={() => {
                    if (progress)
                      sessionStorage.setItem(
                        "signalgen.screening.evaluation",
                        JSON.stringify({
                          owner: userId,
                          rule: progress.context.rule_id,
                          source:
                            progress.context.source === "universe"
                              ? "universe"
                              : progress.context.market,
                          universe: progress.context.universe_id ?? "",
                          from: progress.context.config.from,
                          to: progress.context.config.to,
                        }),
                      );
                  }}
                />
              }
            >
              Open backtest evaluation
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
