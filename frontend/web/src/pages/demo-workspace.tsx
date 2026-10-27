import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import type { BackendConnection } from "@/api/backend-status";
import { Tooltip } from "@base-ui/react/tooltip";
import {
  Activity,
  BadgeCheck,
  BarChart3,
  BookOpenCheck,
  Boxes,
  Braces,
  CalendarRange,
  Check,
  ChevronRight,
  CircleAlert,
  CircleDot,
  Database,
  ExternalLink,
  Gauge,
  KeyRound,
  LineChart,
  ListChecks,
  NotebookTabs,
  Newspaper,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  SearchCheck,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { JournalPanel } from "@/pages/workspace-journal-panel";
import { AccountMenu } from "@/components/account-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { HistoricalCachePanel } from "@/components/historical-cache-panel";
import { useActionNotifications } from "@/components/ui/toast";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import type { JournalScreeningDraft } from "@/lib/journal-screening";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  demoRules,
  demoSignals,
  initialTransactions,
  type DemoRule,
} from "@/data/demo";
import type { User } from "@/types";
import {
  runLiveScreener,
  type LiveScreenerRun,
  type ScreenerStage,
} from "@/analysis/screener";
import { api, session } from "@/api/client";
import { useWorkspaceSync } from "@/lib/use-workspace-sync";
import type { AccountDevice, AccountSession, AccountState } from "@/types";
import { RouteBoundary, RouteLoading } from "@/components/route-boundary";
const StockUniversesPanel = lazy(() =>
  import("@/pages/workspace-resource-panels").then((m) => ({
    default: m.StockUniversesPanel,
  })),
);
const SubscriptionPanel = lazy(() =>
  import("@/pages/workspace-resource-panels").then((m) => ({
    default: m.SubscriptionPanel,
  })),
);
const ServerRulesPanel = lazy(() =>
  import("@/pages/workspace-rules-panel").then((m) => ({
    default: m.ServerRulesPanel,
  })),
);
const WorkspaceScreenerPanel = lazy(() =>
  import("@/pages/workspace-screener-panel").then((m) => ({
    default: m.WorkspaceScreenerPanel,
  })),
);
const WorkspaceBacktestPanel = lazy(() =>
  import("@/pages/workspace-backtest-panel").then((m) => ({
    default: m.WorkspaceBacktestPanel,
  })),
);
const WorkspaceOverviewPanel = lazy(() =>
  import("@/pages/workspace-overview-panel").then((m) => ({
    default: m.WorkspaceOverviewPanel,
  })),
);
const AdminPage = lazy(() =>
  import("@/pages/admin-page").then((m) => ({ default: m.AdminPage })),
);
const MarketMonitorPanel = lazy(() =>
  import("@/pages/market-monitor-panel").then((m) => ({
    default: m.MarketMonitorPanel,
  })),
);
const WorkspaceNewsPanel = lazy(() =>
  import("@/pages/workspace-news-panel").then((m) => ({
    default: m.WorkspaceNewsPanel,
  })),
);

export type DemoView =
  | "overview"
  | "analysis"
  | "backtest"
  | "realtime"
  | "news"
  | "rules"
  | "journal"
  | "universes"
  | "access"
  | "subscription"
  | "operator";

type JobState =
  "idle" | "preparing" | "running" | "completed" | "cancelled" | "failed";

const viewMeta: Record<
  DemoView,
  { title: string; description: string; icon: typeof Gauge }
> = {
  overview: {
    title: "Workspace overview",
    description: "Continue your analysis and review recent screening activity.",
    icon: Gauge,
  },
  analysis: {
    title: "Stock screener",
    description:
      "Choose a rule and stock universe, then review the results and evidence.",
    icon: SearchCheck,
  },
  backtest: {
    title: "Backtesting",
    description:
      "Test a daily rule or manual entries against historical candles.",
    icon: CalendarRange,
  },
  realtime: {
    title: "Market monitor",
    description:
      "Follow your stocks, daily charts, and rule results in one view.",
    icon: Activity,
  },
  rules: {
    title: "Manage rules",
    description: "Create screening conditions or review your saved rules.",
    icon: ListChecks,
  },
  news: {
    title: "News",
    description: "Videos and news from the stock market.",
    icon: Newspaper,
  },
  journal: {
    title: "Trade journal",
    description: "Record your trade plans and review positions.",
    icon: NotebookTabs,
  },
  access: {
    title: "Account & devices",
    description: "Review your account access, active sessions, and devices.",
    icon: SlidersHorizontal,
  },
  universes: {
    title: "Stock universes",
    description: "Group stocks by market for your next screening.",
    icon: Boxes,
  },
  subscription: {
    title: "Plan & access",
    description: "Review your active plan and available features.",
    icon: BadgeCheck,
  },
  operator: {
    title: "Administration",
    description: "Manage account access, plans, and operator permissions.",
    icon: ShieldCheck,
  },
};

const navGroups: Array<{
  label?: string;
  items: Array<{
    view: DemoView;
    label: string;
    icon: typeof Gauge;
    operatorOnly?: boolean;
  }>;
}> = [
  {
    items: [{ view: "overview", label: "Dashboard", icon: Gauge }],
  },
  {
    label: "Analysis",
    items: [
      { view: "analysis", label: "Screener", icon: SearchCheck },
      { view: "backtest", label: "Backtesting", icon: CalendarRange },
      { view: "journal", label: "Trade journal", icon: NotebookTabs },
    ],
  },
  {
    label: "Configuration",
    items: [
      { view: "rules", label: "Rules", icon: ListChecks },
      { view: "universes", label: "Stock universes", icon: Boxes },
    ],
  },
  {
    label: "Market",
    items: [
      { view: "realtime", label: "Market monitor", icon: Activity },
      { view: "news", label: "News", icon: Newspaper },
    ],
  },
];

function DemoNotice({ view }: { view: DemoView }) {
  if (view !== "realtime") return null;

  return (
    <div className="demo-notice demo-notice--market" role="note">
      <Activity />
      <div>
        <strong>TradingView market preview</strong>
        <span>
          The chart uses TradingView&apos;s external widget. Exchange delay and
          availability follow TradingView&apos;s market coverage.
        </span>
      </div>
      <Badge variant="outline">External feed</Badge>
    </div>
  );
}

function OverviewPanel({ go }: { go: (view: DemoView) => void }) {
  const matchingSignals = demoSignals.filter(
    (signal) => signal.state === "Match",
  ).length;
  const activeRules = demoRules.filter((rule) => rule.enabled).length;
  const metrics = [
    {
      label: "Screening coverage",
      value: demoSignals.length.toString(),
      unit: "stocks",
      note: "IDX fixture",
      icon: SearchCheck,
    },
    {
      label: "Matched signals",
      value: matchingSignals.toString(),
      unit: `of ${demoSignals.length}`,
      note: "Passed every condition",
      icon: LineChart,
    },
    {
      label: "Active rules",
      value: activeRules.toString(),
      unit: "rule",
      note: "Saved versions",
      icon: ListChecks,
    },
    {
      label: "Recorded positions",
      value: initialTransactions.length.toString(),
      unit: "positions",
      note: "Local journal state",
      icon: NotebookTabs,
    },
  ];
  const quickActions = [
    ["Open analysis", "Run a fixture screening", "analysis", BarChart3],
    ["Manage rules", "Review logic and versions", "rules", Braces],
    ["Open journal", "Turn a signal into a position", "journal", BookOpenCheck],
    ["Review access", "Check sessions and devices", "access", ShieldCheck],
  ] as const;

  return (
    <div className="overview-command">
      <section className="overview-summary">
        <div className="overview-summary__copy">
          <span className="overview-eyebrow">
            <CircleDot /> Workspace snapshot
          </span>
          <h2>Read the market from one screen.</h2>
          <p>
            Track screening results, active rules, and journal positions without
            losing the evidence behind each signal.
          </p>
        </div>
        <div className="overview-summary__status" aria-label="Workspace status">
          <span>Workspace status</span>
          <strong>Ready to test</strong>
          <small>Authorization active · analysis uses local fixtures</small>
          <button onClick={() => go("analysis")}>
            Run analysis <ChevronRight />
          </button>
        </div>
      </section>
      <section className="overview-metrics" aria-label="Demo data summary">
        {metrics.map(({ label, value, unit, note, icon: Icon }) => (
          <article key={label} className="overview-metric">
            <div>
              <span>{label}</span>
              <Icon />
            </div>
            <strong>
              {value} <small>{unit}</small>
            </strong>
            <p>{note}</p>
          </article>
        ))}
      </section>

      <section className="overview-market">
        <article className="overview-chart">
          <header>
            <div>
              <span>SIGNAL SCORE · LOCAL FIXTURE</span>
              <h3>Screening result quality</h3>
            </div>
            <div className="overview-chart__score">
              <strong>82</strong>
              <span>/ 100</span>
            </div>
          </header>
          <div className="overview-chart__legend" aria-label="Chart legend">
            <span>
              <i className="is-primary" /> Composite score
            </span>
            <span>
              <i /> Rule threshold
            </span>
            <em>Last 8 scans</em>
          </div>
          <div
            className="overview-chart__plot"
            aria-label="Demo signal score chart"
          >
            <svg
              viewBox="0 0 800 280"
              role="img"
              aria-labelledby="overview-chart-title"
            >
              <title id="overview-chart-title">
                Signal score across eight fixture scans
              </title>
              <defs>
                <linearGradient id="overview-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#43df9b" stopOpacity="0.28" />
                  <stop offset="1" stopColor="#43df9b" stopOpacity="0" />
                </linearGradient>
              </defs>
              <g className="overview-chart__grid">
                <path d="M20 44H780M20 104H780M20 164H780M20 224H780" />
                <path d="M112 20V250M224 20V250M336 20V250M448 20V250M560 20V250M672 20V250" />
              </g>
              <path className="overview-chart__threshold" d="M20 168H780" />
              <path
                className="overview-chart__area"
                d="M20 216 C78 210 100 188 132 192 S196 178 228 157 S288 168 326 142 S392 126 438 134 S508 112 550 119 S618 91 662 98 S730 57 780 64 L780 250 L20 250 Z"
              />
              <path
                className="overview-chart__line"
                d="M20 216 C78 210 100 188 132 192 S196 178 228 157 S288 168 326 142 S392 126 438 134 S508 112 550 119 S618 91 662 98 S730 57 780 64"
              />
              <g className="overview-chart__points">
                <circle cx="20" cy="216" r="4" />
                <circle cx="132" cy="192" r="4" />
                <circle cx="228" cy="157" r="4" />
                <circle cx="326" cy="142" r="4" />
                <circle cx="438" cy="134" r="4" />
                <circle cx="550" cy="119" r="4" />
                <circle cx="662" cy="98" r="4" />
                <circle cx="780" cy="64" r="5" />
              </g>
            </svg>
            <div className="overview-chart__axis" aria-hidden="true">
              <span>Session start</span>
              <span>Latest scan</span>
            </div>
          </div>
          <footer>
            <div>
              <span>Dominant rule</span>
              <strong>Momentum confirmation</strong>
            </div>
            <div>
              <span>Data quality</span>
              <strong>
                <Check /> Complete
              </strong>
            </div>
            <div>
              <span>Mode</span>
              <strong>Screening 1D</strong>
            </div>
          </footer>
        </article>

        <aside className="overview-signal-panel">
          <header>
            <div>
              <span>LATEST RESULTS</span>
              <h3>Tracked signals</h3>
            </div>
            <button onClick={() => go("analysis")}>View all</button>
          </header>
          <div className="overview-signal-list">
            {demoSignals.map((signal) => (
              <button key={signal.symbol} onClick={() => go("analysis")}>
                <span
                  className={`signal-state is-${signal.state.toLowerCase().replace(" ", "-")}`}
                />
                <div>
                  <strong>{signal.symbol}</strong>
                  <small>{signal.reason}</small>
                </div>
                <em>{signal.score}</em>
              </button>
            ))}
          </div>
          <div className="overview-signal-panel__note">
            <Database />
            <p>
              <strong>Demo data</strong>
              <span>These values do not represent live market conditions.</span>
            </p>
          </div>
        </aside>
      </section>

      <section
        className="overview-actions"
        aria-label="Workspace feature shortcuts"
      >
        {quickActions.map(([label, description, view, Icon]) => (
          <button key={view} onClick={() => go(view)}>
            <Icon />
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
            <ChevronRight />
          </button>
        ))}
      </section>
    </div>
  );
}

function AnalysisSkeleton() {
  return (
    <div className="analysis-skeleton" aria-label="Preparing analysis results">
      <div className="analysis-skeleton__metrics">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
      <div className="analysis-skeleton__table">
        <Skeleton />
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    </div>
  );
}

function AnalysisPanel({
  onDraft,
  authenticated,
  backendOnline,
  rules,
}: {
  onDraft: (symbol: string) => void;
  authenticated: boolean;
  backendOnline: boolean;
  rules: DemoRule[];
}) {
  const [job, setJob] = useState<JobState>("idle");
  const [selectedRuleId, setSelectedRuleId] = useState("r-momentum");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("Ready to screen");
  const [error, setError] = useState<string | null>(null);
  const [liveRun, setLiveRun] = useState<LiveScreenerRun | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  function updateStage(next: ScreenerStage) {
    const stages: Record<ScreenerStage, [string, number]> = {
      validating_access: ["Checking screener access", 20],
      preparing_data: ["Preparing the IDX fixture", 45],
      loading_engine: ["Calculating indicators", 70],
      private_scoring: ["Evaluating the selected rule", 88],
    };
    setStage(stages[next][0]);
    setProgress(stages[next][1]);
    setJob(next === "private_scoring" ? "running" : "preparing");
  }

  async function run() {
    if (!authenticated) {
      setError("Sign in first to create an app session.");
      setStage("Sign-in required");
      setProgress(0);
      setJob("failed");
      return;
    }
    if (!backendOnline) {
      setError("The Go backend is not connected. Start the API and try again.");
      setStage("Backend unavailable");
      setProgress(0);
      setJob("failed");
      return;
    }
    if (!selectedRule?.backendRuleId) {
      setError("This rule is not available to the screening engine yet.");
      setStage("Rule not ready");
      setProgress(0);
      setJob("failed");
      return;
    }
    controller.current?.abort();
    controller.current = new AbortController();
    setError(null);
    setLiveRun(null);
    setJob("preparing");
    try {
      const result = await runLiveScreener(
        selectedRule.backendRuleId,
        "unused-demo-universe",
        controller.current.signal,
        updateStage,
      );
      setLiveRun(result);
      setStage("Screen complete");
      setProgress(100);
      setJob("completed");
    } catch (caught) {
      if (controller.current.signal.aborted) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "The screen could not be completed.",
      );
      setStage("Screen failed");
      setProgress(0);
      setJob("failed");
    }
  }

  function cancel() {
    controller.current?.abort();
    setStage("Screen cancelled");
    setProgress(0);
    setJob("cancelled");
  }

  const status = liveRun?.latestDecision.matched ? "Match" : "No match";
  const reasons = liveRun?.latestDecision.reason_codes
    .map((reason) => reason.toLowerCase().replaceAll("_", " "))
    .join(", ");
  const availableRules = rules.filter(
    (rule) => rule.enabled && rule.backendRuleId,
  );
  const selectedRule =
    availableRules.find((rule) => rule.id === selectedRuleId) ??
    availableRules[0];
  const selectedConditions = selectedRule?.logic.split(" · ") ?? [];

  useEffect(() => {
    if (selectedRule && selectedRule.id !== selectedRuleId) {
      setSelectedRuleId(selectedRule.id);
    }
  }, [selectedRule, selectedRuleId]);

  return (
    <div className="analysis-layout">
      <section className="panel configure-panel">
        <div className="panel-heading panel-heading--feature">
          <span className="panel-heading__icon" aria-hidden="true">
            <SearchCheck />
          </span>
          <div>
            <h3>Choose a rule to screen the market</h3>
            <p>Signalgen will check every condition in the selected rule.</p>
          </div>
          <span className="panel-heading__status">
            {availableRules.length} ready{" "}
            {availableRules.length === 1 ? "rule" : "rules"}
          </span>
        </div>
        <div className="screener-setup">
          <label className="screener-rule-control" htmlFor="screening-rule">
            <span>Screening rule</span>
            <select
              id="screening-rule"
              value={selectedRule?.id ?? ""}
              onChange={(event) => {
                setSelectedRuleId(event.target.value);
                setJob("idle");
                setLiveRun(null);
                setError(null);
                setProgress(0);
                setStage("Ready to screen");
              }}
            >
              {availableRules.map((rule) => (
                <option key={rule.id} value={rule.id}>
                  {rule.name}
                </option>
              ))}
            </select>
            <small>
              Only active rules connected to the screening engine appear here.
            </small>
          </label>
          <div className="screener-rule-summary">
            <ListChecks />
            <div>
              <span>Checks in this run</span>
              <strong>{selectedRule?.name ?? "No rule is ready"}</strong>
              {selectedRule ? (
                <div className="screener-condition-list">
                  {selectedConditions.map((condition) => (
                    <span key={condition}>{condition}</span>
                  ))}
                </div>
              ) : (
                <span>Enable a server-ready rule before running a screen.</span>
              )}
            </div>
          </div>
          <div className="run-controls">
            <span>
              {selectedRule
                ? "Ready to analyze the IDX daily fixture."
                : "No executable rule selected."}
            </span>
            <div>
              <Button
                className="ui-button ui-button--primary"
                onClick={run}
                disabled={
                  !selectedRule || job === "running" || job === "preparing"
                }
              >
                {job === "completed" ? (
                  <RefreshCw data-icon="inline-start" />
                ) : (
                  <BarChart3 data-icon="inline-start" />
                )}
                {job === "completed" ? "Run again" : "Run screen"}
              </Button>
              {(job === "running" || job === "preparing") && (
                <Button className="ui-button" onClick={cancel}>
                  <XCircle data-icon="inline-start" /> Cancel
                </Button>
              )}
            </div>
          </div>
        </div>
        {(job === "preparing" || job === "running" || job === "completed") && (
          <div className={`job-status is-${job}`} role="status">
            <div>
              <span>{stage}</span>
              <strong>{progress}%</strong>
            </div>
            <i
              style={{
                transform: `scaleX(${progress / 100})`,
              }}
            />
          </div>
        )}
        {error && (
          <div className="analysis-error" role="alert">
            <CircleAlert />
            <span>
              <strong>Screening did not complete</strong>
              {error}
            </span>
            <div className="analysis-error__actions">
              {!authenticated ? (
                <a href="#login">Sign in</a>
              ) : (
                <Button className="ui-button" onClick={run}>
                  <RefreshCw data-icon="inline-start" /> Try again
                </Button>
              )}
            </div>
          </div>
        )}
      </section>
      <section className="panel results-panel">
        <div className="panel-heading panel-heading--feature">
          <span className="panel-heading__icon" aria-hidden="true">
            <BarChart3 />
          </span>
          <div>
            <h3>Results and evidence</h3>
            <p>Matched stocks, indicator values, and decision evidence.</p>
          </div>
          <span className="panel-heading__status">
            {job === "completed" ? "Screen complete" : "Waiting to run"}
          </span>
        </div>
        {job === "preparing" || job === "running" ? (
          <AnalysisSkeleton />
        ) : job !== "completed" || !liveRun ? (
          <div className="results-empty">
            <div className="results-empty__message">
              <BarChart3 />
              <div>
                <strong>Ready when you are</strong>
                <p>
                  Run the selected rule to review its match and the evidence
                  behind the decision.
                </p>
              </div>
            </div>
            <div
              className="results-empty__facts"
              aria-label="Screening configuration"
            >
              <span>
                <small>Rule</small>
                <strong>{selectedRule?.name ?? "Not selected"}</strong>
              </span>
              <span>
                <small>Market</small>
                <strong>IDX · BBCA</strong>
              </span>
              <span>
                <small>Interval</small>
                <strong>Daily</strong>
              </span>
            </div>
          </div>
        ) : (
          <div className="results-loaded">
            <div className="result-metrics">
              <div>
                <span>Decision</span>
                <strong>{status}</strong>
              </div>
              <div>
                <span>Decision version</span>
                <strong>{liveRun.result.decision_version}</strong>
              </div>
              <div>
                <span>Data quality</span>
                <strong>{liveRun.manifest.quality.status}</strong>
              </div>
            </div>
            <div className="result-table-wrap">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Close</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      <strong>{liveRun.latestDecision.symbol}</strong>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`signal-state is-${status.toLowerCase().replace(" ", "-")}`}
                      >
                        {status}
                      </span>
                    </TableCell>
                    <TableCell>
                      {new Intl.NumberFormat("en-GB").format(
                        liveRun.latestClose,
                      )}
                    </TableCell>
                    <TableCell>
                      {liveRun.latestDecision.matched
                        ? "Matched"
                        : "Not matched"}
                    </TableCell>
                    <TableCell>
                      {reasons || "No required conditions were met"}
                    </TableCell>
                    <TableCell>
                      <button
                        className="table-action"
                        onClick={() => onDraft(liveRun.latestDecision.symbol)}
                      >
                        Add to journal
                      </button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <div className="assumption-line">
              <CircleAlert />
              <span>
                <strong>How it works:</strong> Signalgen calculates the
                indicators and evaluates the selected rule. Results are analysis
                support, not investment advice.
              </span>
            </div>
            <div
              className="feature-evidence"
              aria-label="Calculated indicator values"
            >
              <span>
                RSI14 <strong>{liveRun.features.rsi14.toFixed(2)}</strong>
              </span>
              <span>
                EMA9 <strong>{liveRun.features.ema9.toFixed(2)}</strong>
              </span>
              <span>
                EMA20 <strong>{liveRun.features.ema20.toFixed(2)}</strong>
              </span>
              <span>
                Latest price{" "}
                <strong>{liveRun.features.price.toFixed(2)}</strong>
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function RulesPanel({
  rules,
  setRules,
  onRun,
}: {
  rules: DemoRule[];
  setRules: Dispatch<SetStateAction<DemoRule[]>>;
  onRun: () => void;
}) {
  const [editingId, setEditingId] = useState<string>("new");
  const [editorRevision, setEditorRevision] = useState(0);
  const [feedback, setFeedback] = useState("");
  const ruleBlueprints = [
    {
      key: "momentum",
      name: "Momentum confirmation",
      description:
        "Look for stocks with a healthy trend, constructive momentum, and supporting volume.",
      logic: "Close > EMA20 · RSI(14) 52–68 · Volume > SMA20",
      conditions: [
        { metric: "Closing price", operator: "is above", value: "EMA 20" },
        { metric: "RSI (14)", operator: "is between", value: "52 and 68" },
        { metric: "Volume", operator: "is above", value: "20-day average" },
      ],
    },
    {
      key: "breakout",
      name: "Quiet breakout",
      description:
        "Find stocks leaving a recent range after volatility contracts and volume expands.",
      logic: "Close > High(20) · ATR contraction · Volume 1.5×",
      conditions: [
        { metric: "Closing price", operator: "is above", value: "20-day high" },
        { metric: "ATR", operator: "is below", value: "20-day average" },
        { metric: "Volume", operator: "is above", value: "1.5× average" },
      ],
    },
    {
      key: "pullback",
      name: "Pullback continuation",
      description:
        "Watch an established trend retest its average before buyers regain control.",
      logic: "Trend up · Low ≤ EMA20 · Close > Open",
      conditions: [
        { metric: "Trend direction", operator: "equals", value: "Uptrend" },
        { metric: "Daily low", operator: "touches", value: "EMA 20" },
        {
          metric: "Closing price",
          operator: "is above",
          value: "Opening price",
        },
      ],
    },
  ];
  const [draft, setDraft] = useState({
    name: "",
    description: "",
    universe: "IHSG",
  });
  const [conditions, setConditions] = useState([
    { metric: "Closing price", operator: "is above", value: "" },
  ]);
  const generatedLogic = conditions
    .map((condition) =>
      `${condition.metric} ${condition.operator} ${condition.value}`.trim(),
    )
    .join(" · ");

  function openNew() {
    setDraft({
      name: "",
      description: "",
      universe: "IHSG",
    });
    setConditions([
      { metric: "Closing price", operator: "is above", value: "" },
    ]);
    setEditingId("new");
    setEditorRevision((current) => current + 1);
    setFeedback("");
    window.requestAnimationFrame(() => {
      document.querySelector(".rule-builder")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function openEdit(rule: DemoRule) {
    const matchingBlueprint = ruleBlueprints.find(
      (blueprint) => blueprint.logic === rule.logic,
    );
    if (matchingBlueprint) {
      setConditions(
        matchingBlueprint.conditions.map((condition) => ({ ...condition })),
      );
    } else {
      setConditions([
        { metric: "Custom rule", operator: "uses", value: rule.logic },
      ]);
    }
    setDraft({
      name: rule.name,
      description:
        matchingBlueprint?.description ??
        "Review and update the conditions for this private rule.",
      universe: "IHSG",
    });
    setEditingId(rule.id);
    setEditorRevision((current) => current + 1);
    setFeedback("");
  }

  function updateCondition(
    index: number,
    field: "metric" | "operator" | "value",
    value: string,
  ) {
    setConditions(
      conditions.map((condition, conditionIndex) =>
        conditionIndex === index ? { ...condition, [field]: value } : condition,
      ),
    );
    setFeedback("");
  }

  function saveRule(event: FormEvent) {
    event.preventDefault();
    if (
      !draft.name.trim() ||
      conditions.some((condition) => !condition.value.trim())
    ) {
      setFeedback("Add a rule name and complete every condition.");
      return;
    }
    if (editingId === "new") {
      const nextId = crypto.randomUUID();
      setRules([
        ...rules,
        {
          id: nextId,
          name: draft.name,
          logic: generatedLogic,
          version: "draft 01",
          scope: "Yours",
          enabled: true,
        },
      ]);
      setEditingId(nextId);
    } else {
      setRules(
        rules.map((rule) =>
          rule.id === editingId
            ? { ...rule, name: draft.name, logic: generatedLogic }
            : rule,
        ),
      );
    }
    setFeedback(
      editingId === "new" ? "Rule saved to your library." : "Changes saved.",
    );
  }
  return (
    <div className="rules-workspace">
      <section className="panel rule-builder">
        <header className="rule-builder__header">
          <div>
            <h3>
              {editingId === "new"
                ? "Create a screening rule"
                : "Edit your screening rule"}
            </h3>
            <p>
              Build the rule one condition at a time. Saved rules stay in the
              library below.
            </p>
          </div>
        </header>

        <form
          key={editorRevision}
          className="rule-builder__form"
          onSubmit={saveRule}
        >
          <div className="rule-field-grid">
            <label className="rule-field">
              <span>Rule name</span>
              <Input
                value={draft.name}
                onChange={(event) => {
                  setDraft({ ...draft, name: event.target.value });
                  setFeedback("");
                }}
                placeholder="Example: Healthy momentum"
                required
              />
              <small>
                Use a name you will recognize when reviewing results.
              </small>
            </label>
            <label className="rule-field">
              <span>Stock universe</span>
              <select
                value={draft.universe}
                onChange={(event) =>
                  setDraft({ ...draft, universe: event.target.value })
                }
              >
                <option value="IHSG">IHSG · All listed stocks</option>
                <option value="LQ45">LQ45 · Highly liquid stocks</option>
                <option value="IDX30">IDX30 · Large and liquid stocks</option>
              </select>
              <small>This determines which stocks will be checked.</small>
            </label>
            <label className="rule-field rule-field--wide">
              <span>Description</span>
              <Textarea
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
                rows={2}
                placeholder="What market setup should this rule find?"
              />
            </label>
          </div>

          <fieldset className="rule-conditions">
            <legend>Screening conditions</legend>
            <p>Every condition below must be true for a stock to match.</p>
            <div className="rule-conditions__list">
              {conditions.map((condition, index) => (
                <div
                  className="rule-condition"
                  key={`${index}-${condition.metric}`}
                >
                  <span className="rule-condition__index">{index + 1}</span>
                  <label>
                    <span className="sr-only">
                      Indicator for condition {index + 1}
                    </span>
                    <select
                      value={condition.metric}
                      onChange={(event) =>
                        updateCondition(index, "metric", event.target.value)
                      }
                    >
                      <option>Closing price</option>
                      <option>Opening price</option>
                      <option>Daily low</option>
                      <option>Daily high</option>
                      <option>RSI (14)</option>
                      <option>Volume</option>
                      <option>ATR</option>
                      <option>Trend direction</option>
                      <option>Custom rule</option>
                    </select>
                  </label>
                  <label>
                    <span className="sr-only">
                      Comparison for condition {index + 1}
                    </span>
                    <select
                      value={condition.operator}
                      onChange={(event) =>
                        updateCondition(index, "operator", event.target.value)
                      }
                    >
                      <option>is above</option>
                      <option>is below</option>
                      <option>is between</option>
                      <option>equals</option>
                      <option>touches</option>
                      <option>uses</option>
                    </select>
                  </label>
                  <label>
                    <span className="sr-only">
                      Value for condition {index + 1}
                    </span>
                    <Input
                      value={condition.value}
                      onChange={(event) =>
                        updateCondition(index, "value", event.target.value)
                      }
                      placeholder="Value or indicator"
                      required
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-action rule-condition__remove"
                    onClick={() =>
                      conditions.length > 1 &&
                      setConditions(
                        conditions.filter(
                          (_, conditionIndex) => conditionIndex !== index,
                        ),
                      )
                    }
                    disabled={conditions.length === 1}
                    aria-label={`Remove condition ${index + 1}`}
                  >
                    <X />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="rule-add-condition"
              onClick={() => {
                setConditions([
                  ...conditions,
                  { metric: "Closing price", operator: "is above", value: "" },
                ]);
                setFeedback("");
              }}
            >
              <Plus /> Add condition
            </button>
          </fieldset>

          <footer className="rule-builder__footer">
            <div aria-live="polite">
              {feedback ||
                `${conditions.length} conditions · ${draft.universe} universe`}
            </div>
            <div>
              {editingId !== "new" && (
                <Button className="ui-button" type="button" onClick={openNew}>
                  Create new
                </Button>
              )}
              <Button className="ui-button" type="button" onClick={onRun}>
                <BarChart3 data-icon="inline-start" /> Run screener
              </Button>
              <Button className="ui-button ui-button--primary" type="submit">
                <Save data-icon="inline-start" />
                {editingId === "new" ? "Save rule" : "Save changes"}
              </Button>
            </div>
          </footer>
        </form>
      </section>

      <section className="panel rule-list">
        <div className="panel-heading">
          <div>
            <h3>Saved rules</h3>
            <p>
              {rules.length} rules are available. System rules are read-only;
              your rules can be edited.
            </p>
          </div>
          <Button className="ui-button" type="button" onClick={openNew}>
            <Plus data-icon="inline-start" /> New rule
          </Button>
        </div>
        {rules.map((rule) => (
          <article key={rule.id}>
            <div className="rule-toggle">
              <Switch
                checked={rule.enabled}
                onCheckedChange={(checked) =>
                  setRules(
                    rules.map((item) =>
                      item.id === rule.id
                        ? { ...item, enabled: checked }
                        : item,
                    ),
                  )
                }
                aria-label={`Enable ${rule.name}`}
              />
            </div>
            <div>
              <div className="rule-title">
                <strong>{rule.name}</strong>
                <Badge variant="outline">{rule.scope}</Badge>
              </div>
              <p>{rule.logic}</p>
              <small>
                {rule.version} ·{" "}
                {rule.scope === "System" ? "read-only" : "editable"}
              </small>
            </div>
            {rule.scope === "Yours" && (
              <div className="rule-actions">
                <button
                  className="icon-action"
                  onClick={() => openEdit(rule)}
                  aria-label={`Edit ${rule.name}`}
                >
                  <Pencil />
                </button>
                <button
                  className="icon-action"
                  onClick={() =>
                    setRules(rules.filter((item) => item.id !== rule.id))
                  }
                  aria-label={`Delete ${rule.name}`}
                >
                  <Trash2 />
                </button>
              </div>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}

export function AccessPanel({
  backendOnline,
  authenticated,
}: {
  backendOnline: boolean;
  authenticated: boolean;
}) {
  const [account, setAccount] = useState<AccountState | null>(null);
  const [devices, setDevices] = useState<AccountDevice[]>([]);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [hiddenHistory, setHiddenHistory] = useState<{
    owner: string;
    ids: string[];
  }>({ owner: "", ids: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deviceLabel, setDeviceLabel] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    const owner = account?.user.id ?? "";
    let ids: string[] = [];
    if (owner) {
      try {
        const value: unknown = JSON.parse(
          localStorage.getItem(
            `signalgen:hidden-session-history:v1:${owner}`,
          ) ?? "[]",
        );
        if (Array.isArray(value))
          ids = [
            ...new Set(
              value.filter(
                (id): id is string =>
                  typeof id === "string" && id.length > 0 && id.length <= 128,
              ),
            ),
          ].slice(0, 1000);
      } catch {
        /* Unavailable or malformed preferences do not hide server records. */
      }
    }
    setHiddenHistory({ owner, ids });
  }, [account?.user.id]);
  const hiddenIds =
    hiddenHistory.owner === account?.user.id ? hiddenHistory.ids : [];
  const visibleSessions = sessions.filter(
    (item) =>
      item.current || item.status === "active" || !hiddenIds.includes(item.id),
  );
  const endedSessions = visibleSessions.filter(
    (item) => !item.current && item.status !== "active",
  );
  const hiddenCount = sessions.length - visibleSessions.length;
  function updateHistoryVisibility(ids: string[]) {
    if (!account) return;
    try {
      const next = [...new Set(ids)].slice(-1000);
      localStorage.setItem(
        `signalgen:hidden-session-history:v1:${account.user.id}`,
        JSON.stringify(next),
      );
      setHiddenHistory({ owner: account.user.id, ids: next });
      setError(null);
    } catch {
      setError(
        "Session history could not be hidden. Allow browser storage and try again.",
      );
    }
  }
  function hideSessionHistory(id?: string) {
    const removable = endedSessions
      .filter((item) => !id || item.id === id)
      .map((item) => item.id);
    updateHistoryVisibility([...hiddenIds, ...removable]);
  }

  async function loadAccess() {
    if (!authenticated || !backendOnline) return;
    setLoading(true);
    setError(null);
    try {
      const [nextAccount, response, sessionResponse] = await Promise.all([
        api.account(),
        api.listDevices(),
        api.listSessions(),
      ]);
      setAccount(nextAccount);
      setDevices(response.items);
      setSessions(sessionResponse.items);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Access data could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAccess();
  }, [authenticated, backendOnline]);

  async function renameDevice(event: FormEvent, device: AccountDevice) {
    event.preventDefault();
    const label = deviceLabel.trim();
    if (!label) return;
    setSavingId(device.id);
    setError(null);
    try {
      await api.renameDevice(device.id, label);
      setEditingId(null);
      await loadAccess();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Device name could not be saved.",
      );
    } finally {
      setSavingId(null);
    }
  }

  async function revokeDevice(device: AccountDevice) {
    if (
      !window.confirm(
        `Revoke access for ${device.label}? All application sessions on this device will become invalid.`,
      )
    )
      return;
    setSavingId(device.id);
    setError(null);
    try {
      await api.revokeDevice(device.id);
      await loadAccess();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Device access could not be revoked.",
      );
    } finally {
      setSavingId(null);
    }
  }

  async function revokeSession(item: AccountSession) {
    if (!window.confirm(`End session “${item.label}”?`)) return;
    setSavingId(item.id);
    setError(null);
    try {
      await api.revokeSession(item.id);
      await loadAccess();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Session could not be ended.",
      );
    } finally {
      setSavingId(null);
    }
  }

  const ready = authenticated && backendOnline && account;

  return (
    <div className="access-grid">
      <section className="panel entitlement-panel">
        <div className="panel-heading">
          <div>
            <span>ENTITLEMENT</span>
            <h3>Analysis access</h3>
          </div>
          <Badge variant="outline">
            {account ? account.user.role : authenticated ? "Loading" : "Guest"}
          </Badge>
        </div>
        <div className="entitlement-row">
          <span>Screening</span>
          {account?.features.includes("screener") ? (
            <strong>
              <Check /> Allowed
            </strong>
          ) : (
            <em>
              <X /> Not active
            </em>
          )}
        </div>
        <div className="entitlement-row">
          <span>Backtest</span>
          {account?.features.includes("backtest") ? (
            <strong>
              <Check /> Allowed
            </strong>
          ) : (
            <em>
              <X /> Not active
            </em>
          )}
        </div>
        <div className="entitlement-row">
          <span>Realtime feed</span>
          <em>
            <X /> Outside MVP
          </em>
        </div>
        <div className="auth-contract">
          <KeyRound />
          <div>
            <strong>{ready ? "Session verified" : "Backend API"}</strong>
            <span>
              {!backendOnline
                ? "The Go API is unavailable."
                : !authenticated
                  ? "Sign in to view your account access and devices."
                  : account
                    ? `${account.user.email} · ${account.capabilities_version}`
                    : "Verifying account and application session…"}
            </span>
          </div>
        </div>
        {!authenticated && (
          <a className="access-login" href="#login">
            Sign in
          </a>
        )}
      </section>
      <section className="panel sessions-panel">
        <div className="panel-heading">
          <div>
            <span>Devices</span>
            <h3>Account devices</h3>
          </div>
          <span className="muted-meta">
            {loading ? "loading…" : `${devices.length} devices`}
          </span>
        </div>
        {loading && !account && (
          <div className="device-loading" aria-label="Loading devices">
            <Skeleton />
            <Skeleton />
          </div>
        )}
        {!loading && authenticated && devices.length === 0 && !error && (
          <div className="device-empty">
            <Activity />
            <strong>No devices yet</strong>
            <span>
              Your first device appears after you sign in successfully.
            </span>
          </div>
        )}
        {!authenticated && (
          <div className="device-empty">
            <KeyRound />
            <strong>Sign-in required</strong>
            <span>This list only shows devices belonging to your account.</span>
          </div>
        )}
        {devices.map((device) => (
          <article key={device.id}>
            <div className="device-icon">
              <Activity />
            </div>
            <div>
              {editingId === device.id ? (
                <form
                  className="device-rename"
                  onSubmit={(event) => renameDevice(event, device)}
                >
                  <Input
                    value={deviceLabel}
                    onChange={(event) => setDeviceLabel(event.target.value)}
                    maxLength={100}
                    aria-label={`New name for ${device.label}`}
                    autoFocus
                  />
                  <button type="submit" disabled={savingId === device.id}>
                    Save
                  </button>
                  <button type="button" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <strong>
                    {device.label}
                    {device.current && <Badge variant="outline">Current</Badge>}
                  </strong>
                  <span>
                    {device.status} · last active{" "}
                    {formatDeviceTime(device.last_seen_at)}
                  </span>
                </>
              )}
            </div>
            {editingId !== device.id && (
              <div className="device-actions">
                <button
                  className="icon-action"
                  onClick={() => {
                    setEditingId(device.id);
                    setDeviceLabel(device.label);
                  }}
                  aria-label={`Rename ${device.label}`}
                >
                  <Pencil />
                </button>
                {!device.current && device.status === "active" && (
                  <button
                    className="table-action is-danger"
                    disabled={savingId === device.id}
                    onClick={() => void revokeDevice(device)}
                  >
                    Revoke
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
        {error && (
          <div className="access-error" role="alert">
            <CircleAlert />
            <span>
              <strong>Access data unavailable</strong>
              {error}
            </span>
            <button onClick={() => void loadAccess()}>Try again</button>
          </div>
        )}
      </section>
      <section className="panel account-sessions-panel">
        <div className="panel-heading">
          <div>
            <span>Web sessions</span>
            <h3>Session history</h3>
          </div>
          <div className="session-history-actions">
            <span className="muted-meta" role="status">
              {visibleSessions.length} sessions
            </span>
            {hiddenCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateHistoryVisibility([])}
              >
                Restore history
              </Button>
            )}
            <Button
              variant="destructive"
              size="sm"
              disabled={loading || savingId !== null || !endedSessions.length}
              onClick={() => hideSessionHistory()}
            >
              <Trash2 data-icon="inline-start" />
              Delete history
            </Button>
          </div>
        </div>
        <p className="session-history-note">
          Delete hides ended sessions on this device only. Active sessions and
          server records are kept.
        </p>
        {visibleSessions.length === 0 ? (
          <div className="device-empty">
            <KeyRound />
            <strong>No sessions to show</strong>
            <span>Active sessions appear after you sign in successfully.</span>
          </div>
        ) : (
          <div className="account-session-ledger">
            {visibleSessions.map((item) => (
              <article key={item.id}>
                <div>
                  <strong>{item.label}</strong>
                  <span>
                    {item.status} · last active{" "}
                    {formatDeviceTime(item.last_seen_at)}
                  </span>
                </div>
                {item.current ? (
                  <Badge variant="outline">This session</Badge>
                ) : item.status === "active" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={savingId === item.id}
                    onClick={() => void revokeSession(item)}
                  >
                    End session
                  </Button>
                ) : (
                  <div className="session-history-row-actions">
                    <Badge variant="secondary">{item.status}</Badge>
                    <Button
                      variant="destructive"
                      size="sm"
                      aria-label={`Delete history for ${item.label}`}
                      onClick={() => hideSessionHistory(item.id)}
                    >
                      <Trash2 data-icon="inline-start" />
                      Delete
                    </Button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
      <HistoricalCachePanel authenticated={authenticated} />
    </div>
  );
}

function formatDeviceTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "time unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function SidebarToggleIcon({
  open,
  panel = false,
}: {
  open: boolean;
  panel?: boolean;
}) {
  return (
    <svg
      className={`sidebar-toggle-icon${panel ? " sidebar-toggle-icon--panel" : ""}`}
      data-open={open || undefined}
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      {panel ? (
        <>
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M10 5v14" />
          <rect
            className="sidebar-toggle-icon__pane"
            x="5.5"
            y="7"
            width="2"
            height="10"
            rx="1"
            fill="currentColor"
            stroke="none"
          />
        </>
      ) : (
        <>
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h16" />
        </>
      )}
    </svg>
  );
}

export function DemoWorkspace({
  connection = "checking",
  view,
  backendOnline,
  authenticated,
  user,
  onLogout,
}: {
  connection?: BackendConnection;
  view: DemoView;
  backendOnline: boolean;
  authenticated: boolean;
  user: User | null;
  onLogout: () => void | Promise<void>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(
    () => window.matchMedia("(max-width: 860px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 860px)");
    const change = () => {
      setMobileViewport(query.matches);
      setMenuOpen(false);
    };
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  const sync = useWorkspaceSync(authenticated ? user?.id : undefined);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [operatorViewer, setOperatorViewer] = useState<string | null>(null);
  const operatorVerified =
    authenticated && backendOnline && operatorViewer === user?.id;

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setMenuOpen(false);
      document.querySelector<HTMLButtonElement>(".menu-button")?.focus();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);

  useEffect(() => {
    if (view === "operator")
      document.getElementById("workspace-route-heading")?.focus();
  }, [view]);

  useEffect(() => {
    let active = true;
    let request = 0;
    setOperatorViewer(null);
    if (!authenticated || !backendOnline || !user?.id) return;
    const viewer = user.id;
    const refresh = async () => {
      const current = ++request;
      if (!session.getToken()) {
        setOperatorViewer(null);
        return;
      }
      const revision = session.getIdentityRevision();
      try {
        const account = await api.account();
        if (
          active &&
          current === request &&
          revision === session.getIdentityRevision()
        )
          setOperatorViewer(
            account.user.id === viewer &&
              account.user.role === "operator" &&
              account.user.status === "active"
              ? viewer
              : null,
          );
      } catch {
        if (active && current === request) setOperatorViewer(null);
      }
    };
    const identityChanged = () => {
      request++;
      setOperatorViewer(null);
    };
    const unsubscribe = session.onIdentityChange(identityChanged);
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("hashchange", refresh);
    window.addEventListener("signalgen:account-role", refresh);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("hashchange", refresh);
      window.removeEventListener("signalgen:account-role", refresh);
    };
  }, [authenticated, backendOnline, user?.id]);

  const [draftSymbol, setDraftSymbol] = useState<string | null>(null);
  const [screeningDraft, setScreeningDraft] =
    useState<JournalScreeningDraft | null>(null);
  useEffect(() => {
    setDraftSymbol(null);
    setScreeningDraft(null);
  }, [user?.id]);
  const meta = viewMeta[view];
  const PageIcon = meta.icon;
  function go(next: DemoView) {
    if (window.matchMedia("(max-width: 860px)").matches) setMenuOpen(false);
    location.hash = `app/${next}`;
  }
  function draft(symbol: string, evidence?: JournalScreeningDraft) {
    setDraftSymbol(symbol);
    setScreeningDraft(evidence ?? null);
    go("journal");
  }
  return (
    <main
      className={`workbench demo-workbench ${sidebarCollapsed ? "is-sidebar-collapsed" : ""} ${menuOpen ? "is-menu-open" : ""}`}
    >
      <aside
        id="workspace-sidebar"
        className={`sidebar ${menuOpen ? "is-open" : ""} ${sidebarCollapsed ? "is-collapsed" : ""}`}
      >
        <div className="sidebar__brand">
          <a
            className="sidebar__brand-link"
            href="#home"
            aria-label="Signalgen home"
          >
            <Brand compact />
          </a>
          <Tooltip.Root disabled={mobileViewport}>
            <Tooltip.Trigger
              render={
                <button
                  type="button"
                  className="sidebar-boundary-toggle"
                  aria-label={
                    mobileViewport || !sidebarCollapsed
                      ? "Close menu"
                      : "Open workspace menu"
                  }
                  aria-controls="workspace-sidebar"
                  aria-expanded={mobileViewport ? menuOpen : !sidebarCollapsed}
                  onClick={() => {
                    if (mobileViewport) setMenuOpen(false);
                    else setSidebarCollapsed((current) => !current);
                  }}
                />
              }
            >
              <SidebarToggleIcon
                open={mobileViewport ? menuOpen : !sidebarCollapsed}
                panel={!mobileViewport}
              />
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Positioner side="bottom" sideOffset={10}>
                <Tooltip.Popup role="tooltip" className="workspace-nav-tooltip">
                  {sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                </Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
        </div>
        <Tooltip.Provider delay={250}>
          <nav aria-label="Workspace navigation">
            {navGroups.map((group, index) => {
              const visibleItems = group.items.filter(
                (item) => !item.operatorOnly || operatorVerified,
              );
              if (!visibleItems.length) return null;
              return (
                <div
                  className="nav-group"
                  key={group.label ?? `primary-${index}`}
                >
                  {group.label && <span>{group.label}</span>}
                  {visibleItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Tooltip.Root
                        key={item.view}
                        disabled={!sidebarCollapsed || mobileViewport}
                      >
                        <Tooltip.Trigger
                          render={
                            <button
                              className={`${view === item.view ? "active" : ""}${item.operatorOnly ? " workspace-admin-nav" : ""}`}
                              aria-label={item.label}
                              aria-current={
                                view === item.view ? "page" : undefined
                              }
                              onClick={() => go(item.view)}
                            />
                          }
                        >
                          <Icon aria-hidden="true" />
                          <span>
                            {item.label}
                            {item.operatorOnly && (
                              <small>Members &amp; access</small>
                            )}
                          </span>
                        </Tooltip.Trigger>
                        <Tooltip.Portal>
                          <Tooltip.Positioner side="right" sideOffset={20}>
                            <Tooltip.Popup
                              role="tooltip"
                              className="workspace-nav-tooltip"
                            >
                              {item.label}
                            </Tooltip.Popup>
                          </Tooltip.Positioner>
                        </Tooltip.Portal>
                      </Tooltip.Root>
                    );
                  })}
                </div>
              );
            })}
          </nav>
        </Tooltip.Provider>
        <div className="sidebar__footer">
          {authenticated && user ? (
            <AccountMenu
              user={user}
              onLogout={onLogout}
              variant="sidebar"
              collapsed={sidebarCollapsed && !mobileViewport}
            />
          ) : (
            <a className="back-home" href="#login">
              <KeyRound /> Sign in
            </a>
          )}
        </div>
      </aside>
      {menuOpen && (
        <button
          type="button"
          className="backdrop"
          aria-label="Close workspace menu"
          tabIndex={-1}
          onClick={() => setMenuOpen(false)}
        />
      )}
      <section className="workspace">
        <header className="topbar">
          <div className="topbar__inner">
            <div className="topbar__title">
              {mobileViewport && (
                <button
                  className="menu-button"
                  onClick={() => {
                    setMenuOpen((current) => !current);
                  }}
                  aria-label={
                    menuOpen ? "Close workspace menu" : "Open workspace menu"
                  }
                  aria-controls="workspace-sidebar"
                  aria-expanded={menuOpen}
                >
                  <SidebarToggleIcon open={menuOpen} />
                </button>
              )}
              <h1>
                {view === "operator" ? "Administration" : "Trading workspace"}
              </h1>
            </div>
            <div className="topbar__actions">
              <span
                className="workspace-connection"
                data-state={connection}
                role="status"
                aria-live="polite"
              >
                <i aria-hidden="true" />
                {connection === "online"
                  ? "Connected"
                  : connection === "offline"
                    ? "Offline"
                    : connection === "reconnecting"
                      ? "Reconnecting"
                      : "Checking connection"}
              </span>
              <ThemeToggle compact />
            </div>
          </div>
        </header>
        <div className="workspace__content demo-content">
          <DemoNotice view={view} />
          <div className="workspace-page-intro">
            <div className="page-heading">
              <span className="page-heading__icon" aria-hidden="true">
                <PageIcon />
              </span>
              <div>
                <h2 id="workspace-route-heading" tabIndex={-1}>
                  {meta.title}
                </h2>
                <p>{meta.description}</p>
              </div>
            </div>
            {authenticated && view !== "journal" && sync.state !== "saved" && (
              <div className="workspace-sync" role="status" aria-live="polite">
                <span>
                  {sync.state === "loading"
                    ? "Loading account data…"
                    : sync.state === "saving"
                      ? "Saving changes…"
                      : sync.state === "conflict"
                        ? "Changes were made on another device. Choose which copy to keep."
                        : "A local copy is available. Sync is not complete."}
                </span>
                {sync.state === "local" && (
                  <Button variant="ghost" size="sm" onClick={sync.retry}>
                    Retry sync
                  </Button>
                )}
                {sync.state === "conflict" && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void sync.useAccount()}
                    >
                      Use account copy
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void sync.useDevice()}
                    >
                      Keep this device's copy
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="route-stage" key={`${view}:${sync.epoch}`}>
            <RouteBoundary>
              <Suspense fallback={<RouteLoading />}>
                {!sync.ready ? (
                  <RouteLoading />
                ) : (
                  <>
                    {view === "overview" && (
                      <WorkspaceOverviewPanel
                        authenticated={authenticated}
                        userId={user?.id}
                        backendOnline={backendOnline}
                        go={go}
                      />
                    )}
                    {view === "analysis" && (
                      <WorkspaceScreenerPanel
                        onDraft={draft}
                        userId={user?.id}
                        authenticated={authenticated}
                        backendOnline={backendOnline}
                      />
                    )}
                    {view === "backtest" && (
                      <WorkspaceBacktestPanel
                        authenticated={authenticated}
                        backendOnline={backendOnline}
                        userId={user?.id}
                      />
                    )}
                    {view === "realtime" && (
                      <MarketMonitorPanel userId={user?.id} />
                    )}
                    {view === "news" && (
                      <WorkspaceNewsPanel
                        key={user?.id ?? "guest"}
                        userId={user?.id}
                      />
                    )}
                    {view === "rules" && (
                      <ServerRulesPanel
                        authenticated={authenticated}
                        userId={user?.id}
                        backendOnline={backendOnline}
                        onRun={() => go("analysis")}
                      />
                    )}
                    {view === "journal" && (
                      <JournalPanel
                        draftSymbol={draftSymbol}
                        screeningDraft={screeningDraft}
                        userId={user?.id}
                        clearDraft={() => {
                          setDraftSymbol(null);
                          setScreeningDraft(null);
                        }}
                      />
                    )}
                    {view === "access" && (
                      <AccessPanel
                        backendOnline={backendOnline}
                        authenticated={authenticated}
                      />
                    )}
                    {view === "universes" && (
                      <StockUniversesPanel
                        authenticated={authenticated}
                        backendOnline={backendOnline}
                      />
                    )}
                    {view === "subscription" && (
                      <SubscriptionPanel
                        authenticated={authenticated}
                        backendOnline={backendOnline}
                      />
                    )}
                    {view === "operator" && (
                      <AdminPage
                        authenticated={authenticated}
                        backendOnline={backendOnline}
                      />
                    )}
                  </>
                )}
              </Suspense>
            </RouteBoundary>
          </div>
        </div>
      </section>
    </main>
  );
}
