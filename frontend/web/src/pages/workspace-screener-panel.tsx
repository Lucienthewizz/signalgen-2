import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CircleCheck,
  CircleAlert,
  Database,
  ListChecks,
  LoaderCircle,
  Plus,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  XCircle,
  Download,
} from "lucide-react";
import {
  runLiveScreener,
  type LiveScreenerRun,
  type ScreenerStage,
} from "@/analysis/screener";
import { api, ApiError } from "@/api/client";
import {
  ScreenerMonitor,
  screenerIntervals,
  stoppedMonitor,
  type MonitorState,
} from "@/analysis/screener-monitor";
import { CACHE_RESET_EVENT } from "@/data/historical-cache";
import { TradingViewChart } from "@/components/tradingview-chart";
import { candleDate } from "@/lib/data-freshness";
import {
  conditionEvidence,
  decisionLabel,
  decisionDescription,
  decisionReasons,
  screeningFailure,
} from "@/lib/workspace-feedback";
import {
  recordMonitorRun,
  monitorRuns,
  type MonitorRun,
  frozenRule,
  compareMonitorRuns,
} from "@/lib/market-monitor";
import { downloadCsv } from "@/lib/csv";
import { formatStockPrice, snapshotChartSymbol } from "@/lib/stock-market";
import {
  filteredRows,
  readScreenerPreferences,
  saveScreenerPreferences,
  type ScreenerPreferences,
} from "@/lib/screener-preferences";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { conditionSummary } from "@/lib/rule-workflow";
import { screeningStatus, screeningStatusLabels } from "@/lib/screening-status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  AccountState,
  RuleResource,
  StockUniverse,
  ScreenerTimeframe,
} from "@/types";

type Props = {
  authenticated: boolean;
  backendOnline: boolean;
  userId?: string;
  onDraft: (symbol: string) => void;
};

type RunState = "idle" | "loading" | "completed" | "failed";

const stages: Record<ScreenerStage, [string, number]> = {
  validating_access: ["Checking account access", 15],
  preparing_data: ["Preparing daily data", 40],
  loading_engine: ["Calculating indicators", 68],
  private_scoring: ["Checking rule conditions", 88],
};

function ruleSummary(rule?: RuleResource) {
  if (!rule?.definition?.conditions.length) return [];
  return rule.definition.conditions.map(
    (condition) => `${condition.left} ${condition.op} ${condition.right}`,
  );
}

export function WorkspaceScreenerPanel({
  authenticated,
  backendOnline,
  userId,
  onDraft,
}: Props) {
  const [account, setAccount] = useState<AccountState | null>(null);
  const [rules, setRules] = useState<RuleResource[]>([]);
  const [universes, setUniverses] = useState<StockUniverse[]>([]);
  const [ruleId, setRuleId] = useState("");
  const [universeId, setUniverseId] = useState("");
  const [loadingResources, setLoadingResources] = useState(true);
  const [state, setState] = useState<RunState>("idle");
  const [stage, setStage] = useState("Ready to screen");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<LiveScreenerRun | null>(null);
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!detailSymbol) return;
    detailRef.current?.focus({ preventScroll: true });
    detailRef.current?.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [detailSymbol]);
  const detailRow = run?.rows.find(
    (row) => row.decision.symbol === detailSymbol,
  );
  const [monitor] = useState(() => new ScreenerMonitor<LiveScreenerRun>());
  const [monitorState, setMonitorState] = useState<MonitorState>({
    ...stoppedMonitor,
  });
  const [timeframe, setTimeframe] = useState<ScreenerTimeframe>("5m");
  const intervalPolicy = screenerIntervals.find(
    (item) => item.value === timeframe,
  )!;
  const mounted = useRef(false);
  const resourceVersion = useRef(0);
  const [failure, setFailure] = useState<ReturnType<
    typeof screeningFailure
  > | null>(null);
  const [resultFilter, setResultFilter] = useState("all");
  const [signalFilter, setSignalFilter] =
    useState<keyof typeof screeningStatusLabels>("all");
  const [historySearch, setHistorySearch] = useState("");
  const [historyMarket, setHistoryMarket] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ScreenerPreferences["sort"]>("symbol");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [history, setHistory] = useState<MonitorRun[]>([]);
  const [historicalRun, setHistoricalRun] = useState<MonitorRun | null>(null);
  const [compareIndex, setCompareIndex] = useState("1");
  const comparison =
    history[0] && history[Number(compareIndex)]
      ? compareMonitorRuns(history[Number(compareIndex)], history[0])
      : null;
  const restoredUser = useRef<string | null>(null);
  const [runContext, setRunContext] = useState<{
    rule: RuleResource;
    universe: string;
    count: number;
  } | null>(null);
  const evidenceRule = historicalRun?.context?.ruleSnapshot ?? runContext?.rule;

  async function loadResources() {
    if (!authenticated || !backendOnline) return;
    const version = ++resourceVersion.current;
    setLoadingResources(true);
    setError(null);
    setFailure(null);
    try {
      const [accountResponse, ruleResponse, universeResponse] =
        await Promise.all([
          api.account(),
          api.listRules(),
          api.listStockUniverses(),
        ]);
      if (!mounted.current || version !== resourceVersion.current) return;
      setAccount(accountResponse);
      setRules(ruleResponse.items);
      setUniverses(universeResponse.items);
      const saved = readScreenerPreferences(accountResponse.user.id);
      setRuleId((current) =>
        ruleResponse.items.some((item) => item.id === (current || saved.ruleId))
          ? current || saved.ruleId
          : (ruleResponse.items[0]?.id ?? ""),
      );
      setUniverseId((current) =>
        universeResponse.items.some(
          (item) => item.id === (current || saved.universeId),
        )
          ? current || saved.universeId
          : (universeResponse.items[0]?.id ?? ""),
      );
      if (restoredUser.current !== accountResponse.user.id) {
        const recent = monitorRuns(accountResponse.user.id);
        restoredUser.current = accountResponse.user.id;
        setResultFilter(saved.filter);
        setSearch(saved.search);
        setSort(saved.sort);
        setHistory(recent);
        if (recent[0]) {
          setRun(recent[0].run);
          setHistoricalRun(recent[0]);
          setState("completed");
        }
      }
      setPreferencesReady(true);
    } catch (caught) {
      if (!mounted.current || version !== resourceVersion.current) return;
      const feedback = screeningFailure(
        caught instanceof ApiError
          ? caught
          : { message: "Screener resources could not be loaded." },
      );
      setFailure(
        feedback.action === "retry"
          ? { ...feedback, action: "resources" }
          : feedback,
      );
      setError(
        caught instanceof Error
          ? caught.message
          : "Screener resources could not be loaded.",
      );
    } finally {
      if (mounted.current && version === resourceVersion.current)
        setLoadingResources(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    setAccount(null);
    setRun(null);
    setRunContext(null);
    setHistoricalRun(null);
    setHistory([]);
    setRuleId("");
    setUniverseId("");
    setPreferencesReady(false);
    setState("idle");
    restoredUser.current = null;
    void loadResources();
    return () => {
      mounted.current = false;
      ++resourceVersion.current;
      monitor.stop();
    };
  }, [authenticated, backendOnline, userId]);

  useEffect(() => {
    const stop = () => monitor.stop();
    window.addEventListener(CACHE_RESET_EVENT, stop);
    window.addEventListener("pagehide", stop);
    window.addEventListener("signalgen:unauthorized", stop);
    return () => {
      window.removeEventListener(CACHE_RESET_EVENT, stop);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("signalgen:unauthorized", stop);
      monitor.stop();
    };
  }, [monitor]);

  useEffect(() => {
    if (!preferencesReady || !account) return;
    setStorageUnavailable(
      !saveScreenerPreferences(account.user.id, {
        ruleId,
        universeId,
        filter: resultFilter as ScreenerPreferences["filter"],
        search,
        sort,
      }),
    );
  }, [
    account,
    preferencesReady,
    ruleId,
    universeId,
    resultFilter,
    search,
    sort,
  ]);

  const visibleRows = useMemo(
    () => filteredRows(run?.rows ?? [], resultFilter, search, sort),
    [run, resultFilter, search, sort],
  );

  const selectedRule = rules.find((rule) => rule.id === ruleId);
  const selectedUniverse = universes.find(
    (universe) => universe.id === universeId,
  );
  const conditions = useMemo(() => ruleSummary(selectedRule), [selectedRule]);
  const canScreen = account?.features.includes("screener") ?? false;

  function updateStage(next: ScreenerStage) {
    setStage(stages[next][0]);
    setProgress(stages[next][1]);
  }

  function execute() {
    if (!selectedRule || !selectedUniverse || !canScreen || monitorState.active)
      return;
    let previous: LiveScreenerRun | null = null;
    monitor.start(intervalPolicy.periodMs, {
      state: (next) => {
        if (mounted.current) setMonitorState(next);
      },
      task: async (signal) => {
        setFailure(null);
        setError(null);
        setState("loading");
        setProgress(5);
        setStage("Checking completed candles");
        return runLiveScreener(
          selectedRule.id,
          selectedUniverse.id,
          signal,
          (next) => {
            if (mounted.current && !signal.aborted) updateStage(next);
          },
          { timeframe, previous },
        );
      },
      result: (result) => {
        previous = result;
        setRun(result);
        setDetailSymbol(null);
        setRunContext({
          rule: result.ruleSnapshot ?? selectedRule,
          universe: selectedUniverse.name,
          count: selectedUniverse.symbols.length,
        });
        setHistoricalRun(null);
        if (account) {
          recordMonitorRun(account.user.id, selectedRule.name, result, {
            ruleId: selectedRule.id,
            universeId: selectedUniverse.id,
            universeName: selectedUniverse.name,
            universeVersion: selectedUniverse.version,
            ruleSnapshot: frozenRule(result.ruleSnapshot ?? selectedRule),
          });
          setHistory(monitorRuns(account.user.id));
        }
        setProgress(100);
        setStage("Waiting for the next data check");
        setState("completed");
      },
      error: (caught, retrying) => {
        setFailure(
          screeningFailure(
            caught instanceof ApiError
              ? caught
              : {
                  message: caught instanceof Error ? caught.message : undefined,
                },
          ),
        );
        setError(
          caught instanceof Error
            ? caught.message
            : "Screening could not be completed.",
        );
        setProgress(0);
        setStage(
          retrying
            ? "Data check failed; retry scheduled"
            : "Monitoring stopped",
        );
        setState("failed");
      },
    });
  }

  function cancel() {
    monitor.stop();
    setState(run ? "completed" : "idle");
    setProgress(0);
    setStage("Monitoring stopped");
  }

  if (!authenticated || !backendOnline) {
    return (
      <Empty className="workspace-empty-state">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldCheck />
          </EmptyMedia>
          <EmptyTitle>Screener unavailable</EmptyTitle>
          <EmptyDescription>
            {!backendOnline
              ? "Start the Go API to use the screener."
              : "Sign in to verify your screener access."}
          </EmptyDescription>
        </EmptyHeader>
        {backendOnline && (
          <EmptyContent>
            <Button nativeButton={false} render={<a href="#login" />}>
              Sign in
            </Button>
          </EmptyContent>
        )}
      </Empty>
    );
  }

  return (
    <div className="screener-workspace">
      <section
        className="screener-console"
        aria-labelledby="screener-console-title"
      >
        <header className="screener-console__header">
          <div className="resource-title-lockup">
            <span aria-hidden="true">
              <SearchCheck />
            </span>
            <div>
              <h3 id="screener-console-title">Choose stocks, run your rule</h3>
              <p>Choose a rule and universe. Screening results appear below.</p>
            </div>
          </div>
          <Badge variant="outline">Closed candles · Yahoo Finance</Badge>
        </header>

        {loadingResources ? (
          <div
            className="screener-resource-loading"
            role="status"
            aria-label="Loading rules and stock universes"
            aria-busy="true"
          >
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ) : !account ? (
          <Empty className="screener-access-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleAlert />
              </EmptyMedia>
              <EmptyTitle>Screening resources could not be loaded</EmptyTitle>
              <EmptyDescription>
                Retry to load your access, rules, and stock universes.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : !canScreen ? (
          <Empty className="screener-access-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ShieldCheck />
              </EmptyMedia>
              <EmptyTitle>Screener access is not active</EmptyTitle>
              <EmptyDescription>
                Open Plan & access to review your plan, or ask an operator for
                screener access.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                nativeButton={false}
                render={<a href="#app/subscription" />}
              >
                View access
              </Button>
            </EmptyContent>
          </Empty>
        ) : !rules.length || !universes.length ? (
          <div className="screener-prerequisites">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  {!rules.length ? <ListChecks /> : <Database />}
                </EmptyMedia>
                <EmptyTitle>
                  {!rules.length
                    ? "Create a rule first"
                    : "Create a stock universe first"}
                </EmptyTitle>
                <EmptyDescription>
                  {!rules.length
                    ? "You need at least one active rule to run screening."
                    : "Choose 1–10 stocks to analyze together."}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  nativeButton={false}
                  render={
                    <a href={!rules.length ? "#app/rules" : "#app/universes"} />
                  }
                >
                  <Plus data-icon="inline-start" />{" "}
                  {!rules.length ? "Create rule" : "Create universe"}
                </Button>
              </EmptyContent>
            </Empty>
          </div>
        ) : (
          <div className="screener-console__body">
            <FieldGroup className="screener-pickers">
              <Field>
                <FieldLabel htmlFor="screen-rule">Screening rule</FieldLabel>
                <Select
                  items={rules.map((rule) => ({
                    value: rule.id,
                    label: rule.name,
                  }))}
                  value={ruleId}
                  disabled={monitorState.active}
                  onValueChange={(value) => setRuleId(value ?? "")}
                >
                  <SelectTrigger id="screen-rule">
                    <SelectValue>{selectedRule?.name}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {rules.map((rule) => (
                        <SelectItem key={rule.id} value={rule.id}>
                          {rule.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {selectedRule?.owner_type === "system"
                    ? "System rule managed by Signalgen."
                    : "Your saved rule."}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="screen-universe">
                  Stock universe
                </FieldLabel>
                <Select
                  items={universes.map((universe) => ({
                    value: universe.id,
                    label: universe.name,
                  }))}
                  value={universeId}
                  disabled={monitorState.active}
                  onValueChange={(value) => setUniverseId(value ?? "")}
                >
                  <SelectTrigger id="screen-universe">
                    <SelectValue>{selectedUniverse?.name}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {universes.map((universe) => (
                        <SelectItem key={universe.id} value={universe.id}>
                          {universe.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {selectedUniverse && (
                  <ul
                    className="screener-universe-stocks"
                    aria-label="Selected universe stocks"
                  >
                    {selectedUniverse.symbols.map((symbol) => (
                      <li key={symbol}>
                        <Badge variant="outline">
                          {symbol.replace(/\.JK$/, "")}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
                <FieldDescription>
                  {selectedUniverse &&
                    `${selectedUniverse.symbols[0]?.endsWith(".JK") ? "IDX / IDR" : "US / USD"} · Price and EMA thresholds use this currency.`}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="screen-interval">
                  Candle interval
                </FieldLabel>
                <Select
                  items={screenerIntervals.map((item) => ({
                    value: item.value,
                    label: item.label,
                  }))}
                  value={timeframe}
                  disabled={monitorState.active}
                  onValueChange={(value) => {
                    if (screenerIntervals.some((item) => item.value === value))
                      setTimeframe(value as ScreenerTimeframe);
                  }}
                >
                  <SelectTrigger id="screen-interval">
                    <SelectValue>{intervalPolicy.label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {screenerIntervals.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Automatic history: {intervalPolicy.range}. Up to 100 valid
                  closed candles per stock; at least 20 required.
                </FieldDescription>
              </Field>
            </FieldGroup>

            <div className="screener-run-summary">
              <div>
                <div className="screener-run-summary__title">
                  <strong>{selectedRule?.name}</strong>
                  <small>
                    {selectedUniverse?.symbols.length ?? 0} stocks ·{" "}
                    {intervalPolicy.label}
                  </small>
                </div>
                {!conditions.length && (
                  <p>System rule conditions are checked automatically.</p>
                )}
                {conditions.length > 0 && (
                  <div className="screener-criteria">
                    <p>
                      {selectedRule?.definition?.signal_type} · Match{" "}
                      {selectedRule?.definition?.logic === "OR" ? "any" : "all"}{" "}
                      {conditions.length}{" "}
                      {conditions.length === 1 ? "condition" : "conditions"}
                    </p>
                    <ol>
                      {selectedRule?.definition?.conditions.map(
                        (condition, index) => (
                          <li key={index}>
                            <span>{index + 1}</span>
                            {conditionSummary(condition)}
                          </li>
                        ),
                      )}
                    </ol>
                    <Button
                      variant="link"
                      size="sm"
                      nativeButton={false}
                      render={<a href="#app/rules" />}
                    >
                      Edit criteria or choose a preset
                    </Button>
                  </div>
                )}
              </div>
              <div className="screener-run-summary__action">
                <Button
                  size="lg"
                  onClick={() => void execute()}
                  disabled={
                    monitorState.active || !selectedRule || !selectedUniverse
                  }
                >
                  {state === "loading" ? (
                    <LoaderCircle
                      className="is-spinning"
                      data-icon="inline-start"
                    />
                  ) : (
                    <BarChart3 data-icon="inline-start" />
                  )}
                  {monitorState.active
                    ? "Monitoring active"
                    : "Start screening"}
                </Button>
                {monitorState.active && (
                  <Button variant="ghost" onClick={cancel}>
                    <XCircle data-icon="inline-start" /> Stop
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        <div
          className="screener-monitor-status"
          role="status"
          aria-live="polite"
        >
          <strong>
            {monitorState.active
              ? monitorState.busy
                ? "Checking data"
                : monitorState.retrying
                  ? "Retry scheduled · previous result is not updated"
                  : "Waiting for new completed candles"
              : "Monitoring stopped"}
          </strong>
          <span>
            Periodic Yahoo updates, not a licensed real-time feed. Monitoring
            ends when you leave this page.
          </span>
          <span>
            Last successful check:{" "}
            {monitorState.lastCheckedAt
              ? new Date(monitorState.lastCheckedAt).toLocaleTimeString("en-GB")
              : "—"}{" "}
            · Next check:{" "}
            {monitorState.nextCheckAt
              ? new Date(monitorState.nextCheckAt).toLocaleTimeString("en-GB")
              : "—"}
          </span>
          {run && (
            <span>
              Actual data:{" "}
              {run.manifest.available_timestamp_range?.from ??
                run.manifest.available_range.from}{" "}
              —{" "}
              {run.manifest.available_timestamp_range?.to ??
                run.manifest.available_range.to}{" "}
              · {run.manifest.candle_count} candles total ·{" "}
              {run.manifest.timeframe}
            </span>
          )}
          {run?.manifest.requested_timestamp_range && (
            <span>
              Requested history: {run.manifest.requested_timestamp_range.from} —{" "}
              {run.manifest.requested_timestamp_range.to}
            </span>
          )}
        </div>
        {state === "loading" && (
          <div className="screener-progress" role="status">
            <span>
              {stage}
              <strong>{progress}%</strong>
            </span>
            <Progress value={progress} />
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>
              {failure?.title || "Resources could not be loaded"}
            </AlertTitle>
            <AlertDescription>{failure?.detail || error}</AlertDescription>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (failure?.action === "login") location.hash = "login";
                else if (failure?.action === "subscription")
                  location.hash = "app/subscription";
                else
                  void (state === "failed" && failure?.action !== "resources"
                    ? execute()
                    : loadResources());
              }}
            >
              <RefreshCw data-icon="inline-start" />{" "}
              {failure?.action === "login"
                ? "Sign in"
                : failure?.action === "subscription"
                  ? "Check access"
                  : failure?.action === "resources"
                    ? "Reload selections"
                    : "Try again"}
            </Button>
          </Alert>
        )}
      </section>

      {storageUnavailable && (
        <Alert>
          <CircleAlert />
          <AlertTitle>Preferences not saved</AlertTitle>
          <AlertDescription>
            Browser storage is unavailable. Your selections and results remain
            available while this page is open.
          </AlertDescription>
        </Alert>
      )}

      {history.length > 0 && (
        <details className="screener-history">
          <summary>Screening history ({history.length})</summary>
          <FieldGroup className="screener-history-filters">
            <Field>
              <FieldLabel htmlFor="history-search">
                Find a past screen
              </FieldLabel>
              <Input
                id="history-search"
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="Rule, universe or date"
                maxLength={100}
              />
            </Field>
            <Field>
              <FieldLabel id="history-market-label">Market</FieldLabel>
              <ToggleGroup
                aria-labelledby="history-market-label"
                value={[historyMarket]}
                onValueChange={(values) => setHistoryMarket(values[0] || "all")}
                variant="outline"
              >
                <ToggleGroupItem value="all">All markets</ToggleGroupItem>
                <ToggleGroupItem value="IDX">IDX</ToggleGroupItem>
                <ToggleGroupItem value="US">US</ToggleGroupItem>
              </ToggleGroup>
            </Field>
          </FieldGroup>
          <ul>
            {history
              .filter(
                (item) =>
                  (historyMarket === "all" ||
                    item.run.manifest.market === historyMarket) &&
                  `${item.rule} ${item.context?.universeName ?? ""} ${item.recordedAt} ${new Date(item.recordedAt).toLocaleString("en-GB")}`
                    .toLowerCase()
                    .includes(historySearch.toLowerCase().trim()),
              )
              .map((item) => (
                <li key={`${item.run.result.request_id}-${item.recordedAt}`}>
                  <div>
                    <strong>{item.rule}</strong>
                    <span>
                      {item.context?.universeName || "Saved universe"} ·{" "}
                      {item.run.manifest.market} · {item.run.manifest.currency}
                    </span>
                    <time dateTime={item.recordedAt}>
                      {new Date(item.recordedAt).toLocaleString("en-GB")}
                    </time>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={monitorState.active}
                    onClick={() => {
                      setRun(item.run);
                      setRunContext(null);
                      setHistoricalRun(item);
                      setDetailSymbol(null);
                      setState("completed");
                      setFailure(null);
                      setError(null);
                    }}
                  >
                    Review result
                  </Button>
                </li>
              ))}
          </ul>
          {history.length > 1 && (
            <section
              className="screener-comparison"
              aria-label="Compare screening history"
            >
              <Field>
                <FieldLabel htmlFor="compare-run">
                  Compare the latest result with
                </FieldLabel>
                <Select
                  value={compareIndex}
                  onValueChange={(value) => setCompareIndex(value ?? "1")}
                >
                  <SelectTrigger id="compare-run">
                    <SelectValue>
                      {history[Number(compareIndex)]
                        ? `${history[Number(compareIndex)].rule} · ${new Date(history[Number(compareIndex)].recordedAt).toLocaleString("en-GB")}`
                        : "Choose a past run"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {history.slice(1).map((item, index) => (
                        <SelectItem
                          key={`${item.recordedAt}-${index}`}
                          value={String(index + 1)}
                        >
                          {item.rule} ·{" "}
                          {new Date(item.recordedAt).toLocaleString("en-GB")}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              {comparison && (
                <>
                  <p>
                    {comparison.common} stocks appear in both results.{" "}
                    {!comparison.sameRule &&
                      "Rule versions differ or were not recorded. This compares results, not signal changes under the same rule."}
                  </p>
                  <dl>
                    {[
                      ["New matches", comparison.gained],
                      ["No longer matched", comparison.lost],
                      ["Still matched", comparison.retained],
                      ["Not compared", comparison.unpaired],
                    ].map(([label, symbols]) => (
                      <div key={String(label)}>
                        <dt>{label}</dt>
                        <dd>{(symbols as string[]).join(", ") || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                  <p>
                    Stocks present in only one result are not counted as
                    failures. Snapshots are not automated signals.
                  </p>
                </>
              )}
            </section>
          )}
        </details>
      )}

      <section
        className="screener-results"
        aria-labelledby="screener-results-title"
      >
        <header className="screener-results__header">
          <div className="resource-title-lockup">
            <span aria-hidden="true">
              <BarChart3 />
            </span>
            <div>
              <h3 id="screener-results-title">Screening results</h3>
              <p>
                Matching stocks, candle prices, and the evidence behind each
                decision.
              </p>
            </div>
          </div>
          <Badge variant="outline">
            {run
              ? `${run.rows.filter((row) => row.decision.matched).length} matched · ${run.rows.filter((row) => !row.decision.matched).length} not matched`
              : "Not run yet"}
          </Badge>
        </header>
        {state === "loading" && !run ? (
          <div
            className="screener-result-loading"
            role="status"
            aria-label="Preparing screening results"
            aria-busy="true"
          >
            <Skeleton />
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ) : !run ? (
          <Empty className="screener-results-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BarChart3 />
              </EmptyMedia>
              <EmptyTitle>Start with a rule and stock universe</EmptyTitle>
              <EmptyDescription>
                Start screening above to see each stock's result and decision
                evidence.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="screener-result-toolbar">
              <div>
                <strong>{historicalRun?.rule ?? runContext?.rule.name}</strong>
                <p>
                  {historicalRun?.context?.universeName ??
                    runContext?.universe ??
                    "Saved history"}{" "}
                  · {run.rows.length} stocks screened.
                </p>
                <p>
                  {state === "loading"
                    ? "A new screening is running. Your last result is still shown."
                    : historicalRun
                      ? `Result saved ${new Date(historicalRun.recordedAt).toLocaleString("en-GB")}. Not live prices.`
                      : `${run.manifest.timeframe} open and close · ${run.manifest.currency} · periodically fetched, not live prices.`}
                </p>
                <p>
                  {run.manifest.timeframe} snapshot · latest candle{" "}
                  {candleDate(
                    run.latestDecision.timestamp,
                    run.manifest.timeframe,
                    run.manifest.market,
                  )}{" "}
                  · not real-time prices.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() =>
                  downloadCsv("signalgen-screening.csv", [
                    [
                      "Stock",
                      "Decision",
                      "Market",
                      "Currency",
                      `Open ${run.manifest.currency}`,
                      `Close ${run.manifest.currency}`,
                      "RSI14",
                      "EMA9",
                      "EMA20",
                      "Candle time",
                      "Rule",
                      "Rule version",
                      "Reason codes",
                    ],
                    ...visibleRows
                      .filter(
                        (row) =>
                          signalFilter === "all" ||
                          screeningStatus(row.decision) === signalFilter,
                      )
                      .map((row) => [
                        row.decision.symbol,
                        screeningStatusLabels[screeningStatus(row.decision)],
                        run.manifest.market,
                        run.manifest.currency,
                        row.latestOpen,
                        row.latestClose,
                        row.features.rsi14,
                        row.features.ema9,
                        row.features.ema20,
                        row.decision.timestamp,
                        historicalRun?.rule ?? runContext?.rule.name,
                        evidenceRule?.version,
                        row.decision.reason_codes.join("; "),
                      ]),
                  ])
                }
              >
                <Download data-icon="inline-start" /> Export CSV
              </Button>
            </div>
            {detailRow && (
              <section
                className="stock-detail"
                ref={detailRef}
                tabIndex={-1}
                aria-label={`Detail ${detailRow.decision.symbol}`}
              >
                <header className="stock-detail__heading">
                  <div>
                    <h3>{detailRow.decision.symbol.replace(".JK", "")}</h3>
                    <p>
                      Candle{" "}
                      {candleDate(
                        detailRow.decision.timestamp,
                        run.manifest.timeframe,
                        run.manifest.market,
                      )}{" "}
                      · {decisionDescription(detailRow.decision)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDetailSymbol(null)}
                  >
                    Close details
                  </Button>
                </header>
                <dl className="stock-detail__values">
                  {[
                    [
                      `Open price (${run.manifest.currency})`,
                      detailRow.latestOpen,
                    ],
                    [
                      `Close price (${run.manifest.currency})`,
                      detailRow.latestClose,
                    ],
                    [
                      `EMA 9 (${run.manifest.currency})`,
                      detailRow.features.ema9,
                    ],
                    [
                      `EMA 20 (${run.manifest.currency})`,
                      detailRow.features.ema20,
                    ],
                    ["RSI 14", detailRow.features.rsi14],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>
                        {typeof value === "number"
                          ? label === "RSI 14"
                            ? new Intl.NumberFormat("en-GB", {
                                maximumFractionDigits: 2,
                              }).format(value)
                            : formatStockPrice(value, run.manifest.currency)
                          : "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p>
                  {decisionReasons(
                    detailRow.decision.reason_codes,
                    evidenceRule?.definition?.logic,
                  )}
                </p>
                <div className="stock-detail__evidence">
                  <h4>
                    Condition evidence{" "}
                    {evidenceRule
                      ? `· rule version ${evidenceRule.version}`
                      : ""}
                  </h4>
                  {evidenceRule?.definition ? (
                    <ul>
                      {evidenceRule.definition.conditions.map(
                        (condition, index) => {
                          const evidence = conditionEvidence(
                            condition,
                            detailRow.features,
                            detailRow.prevFeatures,
                          );
                          return (
                            <li key={index}>
                              {evidence ? (
                                <>
                                  <Badge
                                    variant={
                                      !evidence.available
                                        ? "outline"
                                        : evidence.passed
                                          ? "success"
                                          : "destructive"
                                    }
                                  >
                                    {!evidence.available
                                      ? "Unavailable"
                                      : evidence.passed
                                        ? "Met"
                                        : "Not met"}
                                  </Badge>
                                  <span className="stock-detail__condition">
                                    <strong>{evidence.label}</strong>
                                    {evidence.previous && (
                                      <small>
                                        Previous candle:{" "}
                                        {new Intl.NumberFormat("en-GB", {
                                          maximumFractionDigits: 2,
                                        }).format(evidence.previous.left)}{" "}
                                        compared with{" "}
                                        {new Intl.NumberFormat("en-GB", {
                                          maximumFractionDigits: 2,
                                        }).format(evidence.previous.right)}
                                      </small>
                                    )}
                                    <small>
                                      {evidence.previous && "Current candle: "}
                                      {new Intl.NumberFormat("en-GB", {
                                        maximumFractionDigits: 2,
                                      }).format(evidence.left)}{" "}
                                      compared with{" "}
                                      {new Intl.NumberFormat("en-GB", {
                                        maximumFractionDigits: 2,
                                      }).format(evidence.right)}
                                    </small>
                                  </span>
                                </>
                              ) : condition.op === "CROSS_UP" ||
                                condition.op === "CROSS_DOWN" ? (
                                "Previous-candle values are unavailable; this crossover cannot be verified."
                              ) : (
                                "Condition values are unavailable."
                              )}
                            </li>
                          );
                        },
                      )}
                    </ul>
                  ) : (
                    <p>
                      {historicalRun
                        ? "The rule definition from this run is unavailable. Past results are not recalculated using the current rule."
                        : "System rule condition details are not shown."}
                    </p>
                  )}
                </div>
                <div className="stock-detail__chart">
                  <TradingViewChart
                    symbol={snapshotChartSymbol(
                      detailRow.decision.symbol,
                      run.manifest,
                    )}
                    label={detailRow.decision.symbol.replace(".JK", "")}
                  />
                </div>
                <p className="stock-detail__note">
                  The provider's chart may update separately. The values and
                  decisions above come from the screening snapshot, not the
                  chart.
                </p>
              </section>
            )}
            <FieldGroup className="screener-result-filters">
              <Field>
                <FieldLabel htmlFor="screen-search">Search stocks</FieldLabel>
                <Input
                  id="screen-search"
                  placeholder="e.g. BBCA"
                  value={search}
                  maxLength={80}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="screen-filter">Show</FieldLabel>
                <Select
                  value={resultFilter}
                  items={[
                    { value: "all", label: "All stocks" },
                    { value: "matched", label: "Matched" },
                    { value: "rejected", label: "Not matched" },
                  ]}
                  onValueChange={(value) => setResultFilter(value || "all")}
                >
                  <SelectTrigger id="screen-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">All stocks</SelectItem>
                      <SelectItem value="matched">Matched</SelectItem>
                      <SelectItem value="rejected">Not matched</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="screen-sort">Sort by</FieldLabel>
                <Select
                  value={sort}
                  items={[
                    { value: "symbol", label: "Stock symbol" },
                    { value: "matched", label: "Matches first" },
                    { value: "close", label: "Highest close price" },
                    { value: "rsi", label: "Highest RSI" },
                  ]}
                  onValueChange={(v) =>
                    setSort((v ?? "symbol") as ScreenerPreferences["sort"])
                  }
                >
                  <SelectTrigger id="screen-sort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="symbol">Stock symbol</SelectItem>
                      <SelectItem value="matched">Matches first</SelectItem>
                      <SelectItem value="close">Highest close price</SelectItem>
                      <SelectItem value="rsi">Highest RSI</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
            <ToggleGroup
              className="screener-signal-filters"
              aria-label="Signal status"
              variant="outline"
              value={[signalFilter]}
              onValueChange={(values) =>
                setSignalFilter(
                  (values[0] || "all") as keyof typeof screeningStatusLabels,
                )
              }
            >
              {(
                Object.keys(
                  screeningStatusLabels,
                ) as (keyof typeof screeningStatusLabels)[]
              ).map((status) => (
                <ToggleGroupItem key={status} value={status}>
                  {screeningStatusLabels[status]}{" "}
                  <span>
                    {
                      run.rows.filter(
                        (row) =>
                          status === "all" ||
                          screeningStatus(row.decision) === status,
                      ).length
                    }
                  </span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="screener-result-count" role="status">
              {
                visibleRows.filter(
                  (row) =>
                    signalFilter === "all" ||
                    screeningStatus(row.decision) === signalFilter,
                ).length
              }{" "}
              of {run.rows.length} stocks shown
            </p>
            <div className="screener-result-ledger">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stock</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead>Open price ({run.manifest.currency})</TableHead>
                    <TableHead>Close price ({run.manifest.currency})</TableHead>
                    <TableHead>RSI14</TableHead>
                    <TableHead>EMA20</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows
                    .filter(
                      (row) =>
                        signalFilter === "all" ||
                        screeningStatus(row.decision) === signalFilter,
                    )
                    .map((row) => (
                      <TableRow key={row.decision.symbol}>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-expanded={detailSymbol === row.decision.symbol}
                            onClick={() => setDetailSymbol(row.decision.symbol)}
                          >
                            {row.decision.symbol.replace(".JK", "")}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              row.decision.matched
                                ? row.decision.signal_type === "SELL"
                                  ? "destructive"
                                  : "success"
                                : "outline"
                            }
                          >
                            {row.decision.matched ? (
                              row.decision.signal_type === "SELL" ? (
                                <>
                                  <CircleAlert
                                    data-icon="inline-start"
                                    aria-hidden="true"
                                  />
                                  SELL
                                </>
                              ) : (
                                <>
                                  <CircleCheck
                                    data-icon="inline-start"
                                    aria-hidden="true"
                                  />
                                  {decisionLabel(row.decision)}
                                </>
                              )
                            ) : (
                              <>
                                <XCircle
                                  data-icon="inline-start"
                                  aria-hidden="true"
                                />
                                {screeningStatus(row.decision) === "cooldown"
                                  ? "Cooldown"
                                  : "Not matched"}
                              </>
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {row.latestOpen != null &&
                          Number.isFinite(row.latestOpen)
                            ? formatStockPrice(
                                row.latestOpen,
                                run.manifest.currency,
                              )
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {formatStockPrice(
                            row.latestClose,
                            run.manifest.currency,
                          )}
                        </TableCell>
                        <TableCell>{row.features.rsi14.toFixed(2)}</TableCell>
                        <TableCell>{row.features.ema20.toFixed(2)}</TableCell>
                        <TableCell>
                          {decisionReasons(
                            row.decision.reason_codes,
                            evidenceRule?.definition?.logic,
                          )}
                          <Button
                            variant="link"
                            size="sm"
                            onClick={() => setDetailSymbol(row.decision.symbol)}
                          >
                            View details
                          </Button>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              onDraft(row.decision.symbol.replace(".JK", ""))
                            }
                          >
                            Add to journal
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  {!visibleRows.filter(
                    (row) =>
                      signalFilter === "all" ||
                      screeningStatus(row.decision) === signalFilter,
                  ).length && (
                    <TableRow>
                      <TableCell colSpan={8}>
                        No stocks match these filters.{" "}
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setSearch("");
                            setResultFilter("all");
                            setSignalFilter("all");
                          }}
                        >
                          Reset filters
                        </Button>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </section>
      {run && (
        <section
          className="screener-technical"
          aria-labelledby="screener-technical-title"
        >
          <h4 id="screener-technical-title">Data information</h4>
          <footer className="dataset-provenance">
            <div>
              <span>Provider</span>
              <strong>Yahoo Finance</strong>
            </div>
            <div>
              <span>Dataset</span>
              <strong>{run.manifest.schema_version}</strong>
            </div>
            <div>
              <span>Range</span>
              <strong>
                {run.manifest.available_range.from} —{" "}
                {run.manifest.available_range.to}
              </strong>
            </div>
            <div>
              <span>Quality</span>
              <strong>{run.manifest.quality.status}</strong>
            </div>
            <div>
              <span>Checksum</span>
              <code>{run.manifest.checksum.slice(0, 12)}…</code>
            </div>
            {run.metrics && (
              <>
                <div>
                  <span>Client computation</span>
                  <strong>{run.metrics.feature_ms.toFixed(1)} ms</strong>
                </div>
                <div>
                  <span>Candidates / connections</span>
                  <strong>
                    {run.metrics.candidates} / {run.metrics.sockets}
                  </strong>
                </div>
              </>
            )}
          </footer>
        </section>
      )}
    </div>
  );
}
