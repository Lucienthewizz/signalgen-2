import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
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
  Menu,
  NotebookTabs,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  SearchCheck,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  Trash2,
  TrendingUp,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { AccountMenu } from "@/components/account-menu";
import { TradingViewChart } from "@/components/tradingview-chart";
import { ThemeToggle } from "@/components/theme-toggle";
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
  type DemoTransaction,
} from "@/data/demo";
import type { User } from "@/types";
import {
  runLiveScreener,
  type LiveScreenerRun,
  type ScreenerStage,
} from "@/analysis/screener";
import { api } from "@/api/client";
import type { AccountDevice, AccountSession, AccountState } from "@/types";
import {
  OperatorPanel,
  StockUniversesPanel,
  SubscriptionPanel,
} from "@/pages/workspace-resource-panels";
import { ServerRulesPanel } from "@/pages/workspace-rules-panel";
import { WorkspaceScreenerPanel } from "@/pages/workspace-screener-panel";
import { WorkspaceOverviewPanel } from "@/pages/workspace-overview-panel";
import { journalPerformance, localJournalDate } from "@/lib/journal";

export type DemoView =
  | "overview"
  | "analysis"
  | "realtime"
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
    description: "A map of MVP features and their current integration status.",
    icon: Gauge,
  },
  analysis: {
    title: "Market screener",
    description:
      "Start from a goal, then inspect the evidence behind each result.",
    icon: SearchCheck,
  },
  realtime: {
    title: "Realtime market",
    description:
      "Move through an IDX watchlist and inspect the selected market on TradingView.",
    icon: Activity,
  },
  rules: {
    title: "Rule management",
    description: "Manage system and private rules within the MVP scope.",
    icon: ListChecks,
  },
  journal: {
    title: "Trade journal",
    description: "Record trades and review positions in one workflow.",
    icon: NotebookTabs,
  },
  access: {
    title: "Access & devices",
    description: "Review entitlements, sessions, devices, and user cache.",
    icon: SlidersHorizontal,
  },
  universes: {
    title: "Stock universes",
    description: "Group IDX instruments into reusable screening scopes.",
    icon: Boxes,
  },
  subscription: {
    title: "Plan & access",
    description: "Review your current subscription and server capabilities.",
    icon: BadgeCheck,
  },
  operator: {
    title: "Operator console",
    description: "Administer feature grants, subscriptions, and account roles.",
    icon: UsersRound,
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
      { view: "journal", label: "Trade journal", icon: NotebookTabs },
    ],
  },
  {
    label: "Configuration",
    items: [
      { view: "rules", label: "Rules", icon: ListChecks },
      { view: "universes", label: "Stock universes", icon: Boxes },
      { view: "access", label: "Access & devices", icon: SlidersHorizontal },
      { view: "subscription", label: "Plan & access", icon: BadgeCheck },
    ],
  },
  {
    label: "Live",
    items: [{ view: "realtime", label: "Realtime signal", icon: Activity }],
  },
  {
    label: "Administration",
    items: [
      {
        view: "operator",
        label: "Operator console",
        icon: UsersRound,
        operatorOnly: true,
      },
    ],
  },
];

type JournalRecord = {
  id: string;
  journal: "Momentum book" | "Swing review";
  symbol: string;
  direction: "Long" | "Short";
  entryAt: string;
  exitAt: string;
  size: string;
  entry: number;
  exit: number;
  pnl: number;
  pnlPercent: number;
  mfe: number;
  mae: number;
  note: string;
  tags: string[];
  rule: string;
};

const journalRecords: JournalRecord[] = [
  {
    id: "jr-bbca",
    journal: "Momentum book",
    symbol: "BBCA",
    direction: "Long",
    entryAt: "16 Sep · 09:38",
    exitAt: "16 Sep · 14:42",
    size: "12 lots",
    entry: 9550,
    exit: 9725,
    pnl: 198_600,
    pnlPercent: 1.83,
    mfe: 2.09,
    mae: -0.38,
    note: "Waited for volume confirmation after the opening range. Exit followed the planned partial target.",
    tags: ["opening range", "volume"],
    rule: "Momentum confirmation",
  },
  {
    id: "jr-tlkm",
    journal: "Momentum book",
    symbol: "TLKM",
    direction: "Long",
    entryAt: "15 Sep · 10:04",
    exitAt: "15 Sep · 15:21",
    size: "20 lots",
    entry: 3120,
    exit: 3165,
    pnl: 90_000,
    pnlPercent: 1.44,
    mfe: 1.92,
    mae: -0.47,
    note: "Kept the position small while the breakout volume was still below its preferred threshold.",
    tags: ["breakout", "patience"],
    rule: "Quiet breakout",
  },
  {
    id: "jr-asii",
    journal: "Swing review",
    symbol: "ASII",
    direction: "Long",
    entryAt: "12 Sep · 09:56",
    exitAt: "12 Sep · 13:08",
    size: "8 lots",
    entry: 5200,
    exit: 5160,
    pnl: -32_000,
    pnlPercent: -0.77,
    mfe: 0.21,
    mae: -1.12,
    note: "The trend was intact, but the retest did not reclaim the entry zone. Closed at the defined invalidation.",
    tags: ["pullback", "risk kept"],
    rule: "Pullback test",
  },
  {
    id: "jr-bmri",
    journal: "Momentum book",
    symbol: "BMRI",
    direction: "Short",
    entryAt: "10 Sep · 11:17",
    exitAt: "10 Sep · 14:56",
    size: "10 lots",
    entry: 6100,
    exit: 6030,
    pnl: 70_000,
    pnlPercent: 1.15,
    mfe: 1.48,
    mae: -0.31,
    note: "A rule exception was documented before entry: the price moved back below the EMA20 after a failed reclaim.",
    tags: ["failed reclaim", "exception"],
    rule: "Momentum confirmation",
  },
];

function formatRupiah(value: number) {
  return `Rp ${Math.abs(value).toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
}

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

type RealtimeAsset = {
  symbol: string;
  ticker: string;
  name: string;
  referencePrice: string;
  referenceChange: string;
  direction: "up" | "down";
};

const realtimeWatchlist: RealtimeAsset[] = [
  {
    symbol: "IDX:BBCA",
    ticker: "BBCA",
    name: "Bank Central Asia",
    referencePrice: "6,325",
    referenceChange: "−1.95%",
    direction: "down",
  },
  {
    symbol: "IDX:TLKM",
    ticker: "TLKM",
    name: "Telkom Indonesia",
    referencePrice: "2,610",
    referenceChange: "−1.13%",
    direction: "down",
  },
  {
    symbol: "IDX:BMRI",
    ticker: "BMRI",
    name: "Bank Mandiri",
    referencePrice: "5,050",
    referenceChange: "−0.98%",
    direction: "down",
  },
  {
    symbol: "IDX:BBRI",
    ticker: "BBRI",
    name: "Bank Rakyat Indonesia",
    referencePrice: "3,780",
    referenceChange: "+0.53%",
    direction: "up",
  },
  {
    symbol: "IDX:ASII",
    ticker: "ASII",
    name: "Astra International",
    referencePrice: "4,810",
    referenceChange: "+0.84%",
    direction: "up",
  },
];

function RealtimePanel() {
  const [selectedSymbol, setSelectedSymbol] = useState(
    realtimeWatchlist[0].symbol,
  );
  const selected =
    realtimeWatchlist.find((asset) => asset.symbol === selectedSymbol) ??
    realtimeWatchlist[0];

  return (
    <section className="realtime-workspace">
      <aside className="market-watchlist" aria-label="IDX market watchlist">
        <header className="market-watchlist__header">
          <div>
            <h3>Market watchlist</h3>
            <span>Select an IDX stock to update the daily chart.</span>
          </div>
          <span className="market-watchlist__pulse">
            <i /> Chart feed
          </span>
        </header>
        <div className="market-watchlist__items">
          {realtimeWatchlist.map((asset) => {
            const active = asset.symbol === selected.symbol;
            return (
              <button
                type="button"
                key={asset.symbol}
                className={active ? "is-active" : ""}
                aria-pressed={active}
                onClick={() => setSelectedSymbol(asset.symbol)}
              >
                <span className="market-watchlist__identity">
                  <strong>{asset.ticker}</strong>
                  <small>{asset.name}</small>
                </span>
                <span className="market-watchlist__quote">
                  <strong>Rp {asset.referencePrice}</strong>
                  <small className={asset.direction}>
                    {asset.direction === "up" ? (
                      <ArrowUpRight />
                    ) : (
                      <ArrowDownRight />
                    )}
                    {asset.referenceChange}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="realtime-chart-panel">
        <header className="realtime-chart-panel__header">
          <div className="realtime-chart-panel__symbol">
            <span>{selected.ticker}</span>
            <div>
              <strong>{selected.name}</strong>
              <small>Indonesia Stock Exchange</small>
            </div>
          </div>
          <div className="realtime-chart-panel__actions">
            <span>1D</span>
            <a
              href={`https://www.tradingview.com/symbols/${selected.symbol.replace(":", "-")}/`}
              target="_blank"
              rel="noreferrer"
            >
              Open TradingView <ExternalLink />
            </a>
          </div>
        </header>
        <div className="realtime-chart-panel__meta">
          <span>
            <i /> TradingView widget
          </span>
          <span>IDX · IDR</span>
          <span>Delay may apply</span>
        </div>
        <TradingViewChart symbol={selected.symbol} label={selected.ticker} />
      </div>
    </section>
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
                      {new Intl.NumberFormat("id-ID").format(
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

function JournalPanel({
  draftSymbol,
  clearDraft,
  transactions,
  setTransactions,
}: {
  draftSymbol: string | null;
  clearDraft: () => void;
  transactions: DemoTransaction[];
  setTransactions: Dispatch<SetStateAction<DemoTransaction[]>>;
}) {
  const [journal, setJournal] = useState<
    "All journals" | JournalRecord["journal"]
  >("All journals");
  const [instrument, setInstrument] = useState("All instruments");
  const [selectedId, setSelectedId] = useState(journalRecords[0].id);
  const [captureOpen, setCaptureOpen] = useState(Boolean(draftSymbol));
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [form, setForm] = useState({
    symbol: draftSymbol ?? "",
    side: "BUY" as "BUY" | "SELL",
    quantity: "",
    price: "",
    fee: "0",
    date: localJournalDate(),
  });
  useEffect(() => {
    if (draftSymbol) {
      setForm((current) => ({ ...current, symbol: draftSymbol }));
      setCaptureOpen(true);
    }
  }, [draftSymbol]);

  const visibleRecords = useMemo(
    () =>
      journalRecords.filter(
        (record) =>
          (journal === "All journals" || record.journal === journal) &&
          (instrument === "All instruments" || record.symbol === instrument),
      ),
    [instrument, journal],
  );
  const selectedRecord =
    visibleRecords.find((record) => record.id === selectedId) ??
    visibleRecords[0];
  const { totalPnl, winRate, averageWin, profitFactor, chartCoordinates } =
    journalPerformance(visibleRecords);

  function addTransaction(event: FormEvent) {
    event.preventDefault();
    const symbol = form.symbol.trim().toUpperCase();
    const quantity = Number(form.quantity);
    const price = Number(form.price);
    const fee = Number(form.fee);
    if (
      !/^[A-Z][A-Z0-9.:-]{0,19}$/.test(symbol) ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isFinite(fee) ||
      fee < 0 ||
      !form.date
    ) {
      setCaptureError(
        "Enter a valid symbol, whole lots, a positive entry price, and a date. Fees cannot be negative.",
      );
      return;
    }
    setTransactions((current) => [
      {
        id: crypto.randomUUID(),
        symbol,
        side: form.side,
        quantity: Number(form.quantity),
        price: Number(form.price),
        fee: Number(form.fee),
        date: form.date,
      },
      ...current,
    ]);
    setCaptureError(null);
    setForm({
      symbol: "",
      side: "BUY",
      quantity: "",
      price: "",
      fee: "0",
      date: localJournalDate(),
    });
    clearDraft();
    setCaptureOpen(false);
  }

  const chartPoints = chartCoordinates
    .map((point) => point.join(","))
    .join(" ");

  return (
    <div className="journal-workspace">
      <section className="journal-toolbar" aria-label="Journal filters">
        <div className="journal-toolbar__filters">
          <label>
            Journal
            <select
              value={journal}
              onChange={(event) => {
                setJournal(event.target.value as typeof journal);
                setSelectedId(journalRecords[0].id);
              }}
            >
              <option>All journals</option>
              <option>Momentum book</option>
              <option>Swing review</option>
            </select>
          </label>
          <label>
            Instrument
            <select
              value={instrument}
              onChange={(event) => {
                setInstrument(event.target.value);
                setSelectedId(journalRecords[0].id);
              }}
            >
              <option>All instruments</option>
              <option>BBCA</option>
              <option>TLKM</option>
              <option>ASII</option>
              <option>BMRI</option>
            </select>
          </label>
          <span className="journal-date">
            <CalendarRange />
            01–16 Sep 2026
          </span>
        </div>
        <div className="journal-toolbar__actions">
          <span>
            <SlidersHorizontal /> Static preview
          </span>
          <Button
            className="ui-button ui-button--primary"
            onClick={() => setCaptureOpen((open) => !open)}
            aria-expanded={captureOpen}
          >
            <Plus data-icon="inline-start" /> Add trade
          </Button>
        </div>
      </section>

      {captureOpen && (
        <section className="panel journal-capture">
          <div className="panel-heading">
            <div>
              <h3>Capture a trade draft</h3>
              <p>
                Save an entry in this browser. Drafts stay separate from sample
                closed trades.
              </p>
            </div>
            {draftSymbol && <Badge variant="outline">From analysis</Badge>}
          </div>
          <form onSubmit={addTransaction} className="control-grid">
            {captureError && (
              <p className="control-wide negative" role="alert">
                {captureError}
              </p>
            )}
            <label>
              Symbol
              <Input
                value={form.symbol}
                placeholder="e.g. BBCA"
                maxLength={20}
                onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                required
              />
            </label>
            <label>
              Side
              <select
                value={form.side}
                onChange={(e) =>
                  setForm({ ...form, side: e.target.value as "BUY" | "SELL" })
                }
              >
                <option>BUY</option>
                <option>SELL</option>
              </select>
            </label>
            <label>
              Lot
              <Input
                type="number"
                min="1"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                required
              />
            </label>
            <label>
              Entry price
              <Input
                type="number"
                min="1"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                required
              />
            </label>
            <label>
              Fee
              <Input
                type="number"
                min="0"
                value={form.fee}
                onChange={(e) => setForm({ ...form, fee: e.target.value })}
              />
            </label>
            <label>
              Entry date
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
              />
            </label>
            <Button
              className="ui-button ui-button--primary control-wide"
              type="submit"
            >
              <Save data-icon="inline-start" /> Save local draft
            </Button>
          </form>
        </section>
      )}

      <section className="journal-performance" aria-label="Trading performance">
        <div className="journal-performance__summary">
          <div>
            <span>Closed trade performance</span>
            <strong className={totalPnl >= 0 ? "positive" : "negative"}>
              {totalPnl >= 0 ? "+" : "-"}
              {formatRupiah(totalPnl)}
            </strong>
            <small>after the selected filters</small>
          </div>
          <dl>
            <div>
              <dt>Win rate</dt>
              <dd>{winRate}%</dd>
            </div>
            <div>
              <dt>Profit factor</dt>
              <dd>
                {profitFactor === null ? "—" : `${profitFactor.toFixed(1)}×`}
              </dd>
            </div>
            <div>
              <dt>Average win</dt>
              <dd>{formatRupiah(averageWin)}</dd>
            </div>
          </dl>
        </div>
        <figure className="journal-pnl-chart">
          <figcaption>
            <span>Realized P&amp;L sequence</span>
            <small>Ordered by closed trade, not a live price chart.</small>
          </figcaption>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-label="Illustrative realized profit and loss sequence"
          >
            <line x1="0" x2="100" y1="25" y2="25" />
            <line x1="0" x2="100" y1="50" y2="50" />
            <line x1="0" x2="100" y1="75" y2="75" />
            <polyline points={chartPoints} />
          </svg>
        </figure>
      </section>

      <section className="journal-ledger" aria-label="Closed trade history">
        <header>
          <div>
            <h3>Closed trades</h3>
            <p>
              Newest closed positions first. Select a row to inspect the trade
              note.
            </p>
          </div>
          <span>
            {visibleRecords.length}{" "}
            {visibleRecords.length === 1 ? "record" : "records"}
          </span>
        </header>
        <div className="journal-ledger__table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Closed</TableHead>
                <TableHead>Instrument</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Entry / exit</TableHead>
                <TableHead>P&amp;L</TableHead>
                <TableHead>MFE / MAE</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRecords.map((record) => (
                <TableRow
                  key={record.id}
                  className={
                    record.id === selectedRecord?.id ? "is-selected" : undefined
                  }
                  onClick={() => setSelectedId(record.id)}
                >
                  <TableCell>
                    <button
                      className="journal-trade-select"
                      type="button"
                      onClick={() => setSelectedId(record.id)}
                      aria-current={
                        record.id === selectedRecord?.id ? "true" : undefined
                      }
                    >
                      {record.exitAt}
                    </button>
                  </TableCell>
                  <TableCell>
                    <strong>{record.symbol}</strong>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`journal-direction is-${record.direction.toLowerCase()}`}
                    >
                      {record.direction === "Long" ? (
                        <ArrowUpRight />
                      ) : (
                        <ArrowDownRight />
                      )}
                      {record.direction}
                    </span>
                    <small>{record.size}</small>
                  </TableCell>
                  <TableCell>
                    {record.entry.toLocaleString("id-ID")} /{" "}
                    {record.exit.toLocaleString("id-ID")}
                  </TableCell>
                  <TableCell>
                    <b className={record.pnl > 0 ? "positive" : "negative"}>
                      {record.pnl > 0 ? "+" : "-"}
                      {formatRupiah(record.pnl)}
                    </b>
                    <small>
                      {record.pnlPercent > 0 ? "+" : ""}
                      {record.pnlPercent.toFixed(2)}%
                    </small>
                  </TableCell>
                  <TableCell>
                    {record.mfe.toFixed(2)}% / {record.mae.toFixed(2)}%
                  </TableCell>
                </TableRow>
              ))}
              {visibleRecords.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    No closed trades match these filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {selectedRecord && (
        <aside className="journal-detail" aria-live="polite">
          <div className="journal-detail__title">
            <div>
              <span>{selectedRecord.journal}</span>
              <h3>
                {selectedRecord.symbol} {selectedRecord.direction.toLowerCase()}{" "}
                review
              </h3>
            </div>
            <TrendingUp />
          </div>
          <p>{selectedRecord.note}</p>
          <div className="journal-detail__evidence">
            <div>
              <span>Rule context</span>
              <strong>{selectedRecord.rule}</strong>
            </div>
            <div>
              <span>Entry / exit</span>
              <strong>
                {selectedRecord.entryAt} → {selectedRecord.exitAt}
              </strong>
            </div>
          </div>
          <div className="journal-tags" aria-label="Trade tags">
            <Tag />
            {selectedRecord.tags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </aside>
      )}

      {transactions.length > 0 && (
        <section
          className="journal-drafts"
          aria-label="Locally captured trade drafts"
        >
          <div>
            <span>Local drafts</span>
            <p>
              {transactions.length} entries are waiting for an exit price and
              remain only in this browser preview.
            </p>
          </div>
          <div className="journal-drafts__items">
            {transactions.map((tx) => (
              <article key={tx.id}>
                <strong>{tx.symbol}</strong>
                <span>
                  {tx.side} · {tx.quantity} lots at{" "}
                  {tx.price.toLocaleString("id-ID")}
                </span>
                <button
                  className="icon-action"
                  onClick={() =>
                    setTransactions(
                      transactions.filter((item) => item.id !== tx.id),
                    )
                  }
                  aria-label={`Remove ${tx.symbol} local draft`}
                >
                  <Trash2 />
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AccessPanel({
  backendOnline,
  authenticated,
  cacheState,
  setCacheState,
}: {
  backendOnline: boolean;
  authenticated: boolean;
  cacheState: string;
  setCacheState: Dispatch<SetStateAction<string>>;
}) {
  const [account, setAccount] = useState<AccountState | null>(null);
  const [devices, setDevices] = useState<AccountDevice[]>([]);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deviceLabel, setDeviceLabel] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

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
          : "Data akses belum dapat dimuat.",
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
        caught instanceof Error ? caught.message : "Nama belum tersimpan.",
      );
    } finally {
      setSavingId(null);
    }
  }

  async function revokeDevice(device: AccountDevice) {
    if (
      !window.confirm(
        `Cabut akses ${device.label}? Semua app-session perangkat ini akan tidak berlaku.`,
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
          : "Perangkat belum dapat dicabut.",
      );
    } finally {
      setSavingId(null);
    }
  }

  async function revokeSession(item: AccountSession) {
    if (!window.confirm(`Akhiri sesi “${item.label}”?`)) return;
    setSavingId(item.id);
    setError(null);
    try {
      await api.revokeSession(item.id);
      await loadAccess();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Sesi belum dapat diakhiri.",
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
            <h3>Akses riset</h3>
          </div>
          <Badge variant="outline">
            {account ? account.user.role : authenticated ? "Memuat" : "Guest"}
          </Badge>
        </div>
        <div className="entitlement-row">
          <span>Screening</span>
          {account?.features.includes("screener") ? (
            <strong>
              <Check /> Diizinkan
            </strong>
          ) : (
            <em>
              <X /> Belum aktif
            </em>
          )}
        </div>
        <div className="entitlement-row">
          <span>Backtest</span>
          {account?.features.includes("backtest") ? (
            <strong>
              <Check /> Diizinkan
            </strong>
          ) : (
            <em>
              <X /> Belum aktif
            </em>
          )}
        </div>
        <div className="entitlement-row">
          <span>Realtime feed</span>
          <em>
            <X /> Di luar MVP
          </em>
        </div>
        <div className="auth-contract">
          <KeyRound />
          <div>
            <strong>{ready ? "Sesi terverifikasi" : "Backend API"}</strong>
            <span>
              {!backendOnline
                ? "Go API belum terhubung."
                : !authenticated
                  ? "Masuk untuk membaca entitlement dan perangkat milik akun."
                  : account
                    ? `${account.user.email} · ${account.capabilities_version}`
                    : "Memvalidasi akun dan app-session…"}
            </span>
          </div>
        </div>
        {!authenticated && (
          <a className="access-login" href="#login">
            Masuk ke akun
          </a>
        )}
      </section>
      <section className="panel sessions-panel">
        <div className="panel-heading">
          <div>
            <span>PERANGKAT</span>
            <h3>Instalasi akun</h3>
          </div>
          <span className="muted-meta">
            {loading ? "memuat…" : `${devices.length} perangkat`}
          </span>
        </div>
        {loading && !account && (
          <div className="device-loading" aria-label="Memuat perangkat">
            <Skeleton />
            <Skeleton />
          </div>
        )}
        {!loading && authenticated && devices.length === 0 && !error && (
          <div className="device-empty">
            <Activity />
            <strong>Belum ada perangkat</strong>
            <span>App-session pertama akan muncul setelah login berhasil.</span>
          </div>
        )}
        {!authenticated && (
          <div className="device-empty">
            <KeyRound />
            <strong>Autentikasi diperlukan</strong>
            <span>Daftar ini hanya dibaca dari resource milik akun.</span>
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
                    aria-label={`Nama baru untuk ${device.label}`}
                    autoFocus
                  />
                  <button type="submit" disabled={savingId === device.id}>
                    Simpan
                  </button>
                  <button type="button" onClick={() => setEditingId(null)}>
                    Batal
                  </button>
                </form>
              ) : (
                <>
                  <strong>
                    {device.label}
                    {device.current && (
                      <Badge variant="outline">Saat ini</Badge>
                    )}
                  </strong>
                  <span>
                    {device.status} · terakhir aktif{" "}
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
                  aria-label={`Ubah nama ${device.label}`}
                >
                  <Pencil />
                </button>
                {!device.current && device.status === "active" && (
                  <button
                    className="table-action is-danger"
                    disabled={savingId === device.id}
                    onClick={() => void revokeDevice(device)}
                  >
                    Cabut
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
              <strong>Data akses belum siap</strong>
              {error}
            </span>
            <button onClick={() => void loadAccess()}>Coba lagi</button>
          </div>
        )}
      </section>
      <section className="panel account-sessions-panel">
        <div className="panel-heading">
          <div>
            <span>SESI WEB</span>
            <h3>Login aktif</h3>
          </div>
          <span className="muted-meta">{sessions.length} sesi</span>
        </div>
        {sessions.length === 0 ? (
          <div className="device-empty">
            <KeyRound />
            <strong>Belum ada sesi yang dapat ditampilkan</strong>
            <span>Sesi aktif akan muncul setelah autentikasi berhasil.</span>
          </div>
        ) : (
          <div className="account-session-ledger">
            {sessions.map((item) => (
              <article key={item.id}>
                <div>
                  <strong>{item.label}</strong>
                  <span>
                    {item.status} · terakhir aktif{" "}
                    {formatDeviceTime(item.last_seen_at)}
                  </span>
                </div>
                {item.current ? (
                  <Badge variant="outline">Sesi ini</Badge>
                ) : item.status === "active" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={savingId === item.id}
                    onClick={() => void revokeSession(item)}
                  >
                    Akhiri sesi
                  </Button>
                ) : (
                  <Badge variant="secondary">{item.status}</Badge>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="panel cache-panel">
        <div>
          <Database />
          <span>
            <strong>User cache</strong>
            <small>{cacheState}</small>
          </span>
        </div>
        <Button
          className="ui-button"
          onClick={() => setCacheState("Empty · cleared just now")}
        >
          <Trash2 /> Clear cache
        </Button>
      </section>
    </div>
  );
}

function formatDeviceTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "waktu tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function readJournalDrafts(key: string): DemoTransaction[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return initialTransactions;
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return initialTransactions;
    return value.filter(
      (item): item is DemoTransaction =>
        item &&
        typeof item.id === "string" &&
        typeof item.symbol === "string" &&
        (item.side === "BUY" || item.side === "SELL") &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0 &&
        Number.isFinite(item.price) &&
        item.price > 0 &&
        Number.isFinite(item.fee) &&
        item.fee >= 0 &&
        typeof item.date === "string",
    );
  } catch {
    return initialTransactions;
  }
}

export function DemoWorkspace({
  view,
  backendOnline,
  authenticated,
  user,
  onLogout,
}: {
  view: DemoView;
  backendOnline: boolean;
  authenticated: boolean;
  user: User | null;
  onLogout: () => void | Promise<void>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const workspaceRef = useRef<HTMLElement>(null);
  const workspaceMotion = useRef<Animation | null>(null);
  const previousWorkspaceLeft = useRef<number | null>(null);

  function rememberWorkspacePosition() {
    if (
      !window.matchMedia("(min-width: 861px)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    previousWorkspaceLeft.current =
      workspaceRef.current?.getBoundingClientRect().left ?? null;
    workspaceMotion.current?.cancel();
  }

  useLayoutEffect(() => {
    const element = workspaceRef.current;
    const previousLeft = previousWorkspaceLeft.current;
    previousWorkspaceLeft.current = null;
    if (!element || previousLeft === null) return;
    const delta = previousLeft - element.getBoundingClientRect().left;
    if (Math.abs(delta) < 1) return;
    workspaceMotion.current = element.animate(
      [{ transform: `translateX(${delta}px)` }, { transform: "translateX(0)" }],
      { duration: 300, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
  }, [menuOpen, sidebarCollapsed]);

  useEffect(() => () => workspaceMotion.current?.cancel(), []);
  const [draftSymbol, setDraftSymbol] = useState<string | null>(null);
  const journalKey = `signalgen:journal-drafts:${user?.id ?? "guest"}`;
  const [journalState, setJournalState] = useState(() => ({
    key: journalKey,
    items: readJournalDrafts(journalKey),
  }));
  const transactions =
    journalState.key === journalKey
      ? journalState.items
      : readJournalDrafts(journalKey);
  const setTransactions: Dispatch<SetStateAction<DemoTransaction[]>> = (
    update,
  ) => {
    setJournalState((current) => {
      const previous =
        current.key === journalKey
          ? current.items
          : readJournalDrafts(journalKey);
      return {
        key: journalKey,
        items: typeof update === "function" ? update(previous) : update,
      };
    });
  };
  useEffect(() => {
    try {
      localStorage.setItem(
        journalState.key,
        JSON.stringify(journalState.items),
      );
    } catch {
      // The journal remains usable in memory when browser storage is unavailable.
    }
  }, [journalState]);
  const [cacheState, setCacheState] = useState("14.8 MB · encrypted (sample)");
  const meta = viewMeta[view];
  const PageIcon = meta.icon;
  function go(next: DemoView) {
    rememberWorkspacePosition();
    location.hash = `app/${next}`;
    setMenuOpen(false);
    setSidebarCollapsed(true);
  }
  function draft(symbol: string) {
    setDraftSymbol(symbol);
    go("journal");
  }
  return (
    <main
      className={`workbench demo-workbench ${sidebarCollapsed ? "is-sidebar-collapsed" : ""} ${menuOpen ? "is-menu-open" : ""}`}
    >
      <aside
        className={`sidebar ${menuOpen ? "is-open" : ""} ${sidebarCollapsed ? "is-collapsed" : ""}`}
      >
        <div className="sidebar__brand">
          <a className="sidebar__brand-link" href="#home">
            <Brand compact />
          </a>
          <button
            onClick={() => {
              rememberWorkspacePosition();
              setMenuOpen(false);
              setSidebarCollapsed(true);
            }}
            aria-label="Close menu"
          >
            <X />
          </button>
        </div>
        <nav aria-label="Workspace navigation">
          {navGroups.map((group, index) => {
            const visibleItems = group.items.filter(
              (item) =>
                !item.operatorOnly ||
                user?.role === "operator" ||
                user?.role === "admin",
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
                    <button
                      key={item.view}
                      className={view === item.view ? "active" : ""}
                      onClick={() => go(item.view)}
                    >
                      <Icon aria-hidden="true" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="sidebar__footer">
          {authenticated && user ? (
            <AccountMenu user={user} onLogout={onLogout} variant="sidebar" />
          ) : (
            <a className="back-home" href="#login">
              <KeyRound /> Sign in
            </a>
          )}
        </div>
      </aside>
      {menuOpen && (
        <button
          className="backdrop"
          onClick={() => setMenuOpen(false)}
          aria-label="Close menu"
        />
      )}
      <section className="workspace" ref={workspaceRef}>
        <header className="topbar">
          <div className="topbar__inner">
            <div className="topbar__title">
              <button
                className="menu-button"
                onClick={() => {
                  rememberWorkspacePosition();
                  setMenuOpen(true);
                }}
                aria-label="Open workspace menu"
              >
                <Menu />
              </button>
              <h1>Trading workspace</h1>
            </div>
            <div className="topbar__actions">
              <ThemeToggle compact />
            </div>
          </div>
        </header>
        <div className="workspace__content demo-content">
          <DemoNotice view={view} />
          <div className="page-heading">
            <span className="page-heading__icon" aria-hidden="true">
              <PageIcon />
            </span>
            <div>
              <h2>{meta.title}</h2>
              <p>{meta.description}</p>
            </div>
          </div>
          <div className="route-stage" key={view}>
            {view === "overview" && (
              <WorkspaceOverviewPanel
                authenticated={authenticated}
                backendOnline={backendOnline}
                go={go}
              />
            )}
            {view === "analysis" && (
              <WorkspaceScreenerPanel
                onDraft={draft}
                authenticated={authenticated}
                backendOnline={backendOnline}
              />
            )}
            {view === "realtime" && <RealtimePanel />}
            {view === "rules" && (
              <ServerRulesPanel
                authenticated={authenticated}
                backendOnline={backendOnline}
                onRun={() => go("analysis")}
              />
            )}
            {view === "journal" && (
              <JournalPanel
                draftSymbol={draftSymbol}
                clearDraft={() => setDraftSymbol(null)}
                transactions={transactions}
                setTransactions={setTransactions}
              />
            )}
            {view === "access" && (
              <AccessPanel
                backendOnline={backendOnline}
                authenticated={authenticated}
                cacheState={cacheState}
                setCacheState={setCacheState}
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
              <OperatorPanel
                authenticated={authenticated}
                backendOnline={backendOnline}
              />
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
