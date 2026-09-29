import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  ArrowLeft,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BookOpenCheck,
  Braces,
  CalendarRange,
  Check,
  ChevronRight,
  CircleAlert,
  CircleHelp,
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
  Sparkles,
  Tag,
  Target,
  Trash2,
  TrendingUp,
  X,
  XCircle,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { AccountMenu } from "@/components/account-menu";
import { TradingViewChart } from "@/components/tradingview-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
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
import type { AccountDevice, AccountState } from "@/types";

export type DemoView =
  | "overview"
  | "analysis"
  | "realtime"
  | "rules"
  | "journal"
  | "access";

type JobState =
  "idle" | "preparing" | "running" | "completed" | "cancelled" | "failed";

const viewMeta: Record<DemoView, { title: string; description: string }> = {
  overview: {
    title: "Workspace overview",
    description: "A map of MVP features and their current integration status.",
  },
  analysis: {
    title: "Market screener",
    description: "Start from a goal, then inspect the evidence behind each result.",
  },
  realtime: {
    title: "Realtime market",
    description:
      "Move through an IDX watchlist and inspect the selected market on TradingView.",
  },
  rules: {
    title: "Rule management",
    description: "Manage system and private rules within the MVP scope.",
  },
  journal: {
    title: "Trade journal",
    description: "Record trades and review positions in one workflow.",
  },
  access: {
    title: "Access & devices",
    description: "Review entitlements, sessions, devices, and user cache.",
  },
};

const navItems: Array<{ view: DemoView; label: string; icon: typeof Gauge }> = [
  { view: "overview", label: "Overview", icon: Gauge },
  { view: "analysis", label: "Screener", icon: BarChart3 },
  { view: "realtime", label: "Realtime", icon: LineChart },
  { view: "rules", label: "Rules", icon: Braces },
  { view: "journal", label: "Journal", icon: BookOpenCheck },
  { view: "access", label: "Access", icon: ShieldCheck },
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
  return `Rp ${Math.abs(value).toLocaleString("id-ID")}`;
}

function DemoNotice({
  authenticated,
  view,
}: {
  authenticated: boolean;
  view: DemoView;
}) {
  if (view === "realtime") {
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

  return (
    <div className="demo-notice" role="note">
      <Database />
      <div>
        <strong>
          {authenticated
            ? "Go-connected features are ready"
            : "Demo data is active"}
        </strong>
        <span>
          {authenticated
            ? "Analysis and account access use the Go API; rules and journal remain previews."
            : "Sign in to use Go-connected analysis and owner-scoped device controls."}
        </span>
      </div>
      <Badge variant="outline">
        {authenticated ? "Hybrid POC" : "Local data"}
      </Badge>
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
            <span>{realtimeWatchlist.length} IDX assets</span>
          </div>
          <span className="market-watchlist__pulse">
            <i /> Chart feed
          </span>
        </header>
        <div className="market-watchlist__columns" aria-hidden="true">
          <span>Asset</span>
          <span>Reference close</span>
        </div>
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
                <i className="market-watchlist__rail" aria-hidden="true" />
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
                <ChevronRight className="market-watchlist__open" />
              </button>
            );
          })}
        </div>
        <footer>
          Watchlist values are illustrative snapshots. Use the TradingView
          chart for the available market feed.
        </footer>
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
            <span>15 min</span>
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
}: {
  onDraft: (symbol: string) => void;
  authenticated: boolean;
  backendOnline: boolean;
}) {
  const [job, setJob] = useState<JobState>("idle");
  const [preset, setPreset] = useState("Momentum confirmation");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("Siap memulai");
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
      loading_engine: ["Computing features through Go/WASM", 70],
      private_scoring: ["Requesting the private server decision", 88],
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
    controller.current?.abort();
    controller.current = new AbortController();
    setError(null);
    setLiveRun(null);
    setJob("preparing");
    try {
      const result = await runLiveScreener(
        controller.current.signal,
        updateStage,
      );
      setLiveRun(result);
      setStage("Hybrid screen complete");
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
  const presets = [
    {
      name: "Momentum confirmation",
      description: "For stocks already moving with confirmed volume.",
      checks: "Trend · RSI · volume",
    },
    {
      name: "Quiet breakout",
      description: "For a price leaving a narrow range with growing interest.",
      checks: "Range · ATR · volume",
    },
    {
      name: "Pullback test",
      description: "For an uptrend returning to a planned entry area.",
      checks: "Trend · EMA20 · close",
    },
  ];

  return (
    <div className="analysis-layout">
      <section className="panel configure-panel">
        <div className="panel-heading">
          <div>
            <h3>Start with a screening goal</h3>
            <p>Choose a ready-made checklist. You can inspect every condition before running it.</p>
          </div>
          <Badge variant="outline">Go/WASM + Gin</Badge>
        </div>
        <div className="screener-presets" aria-label="Screener presets">
          {presets.map((item) => (
            <button
              key={item.name}
              type="button"
              className={preset === item.name ? "is-active" : undefined}
              onClick={() => setPreset(item.name)}
              aria-current={preset === item.name ? "true" : undefined}
            >
              <Sparkles />
              <span>
                <strong>{item.name}</strong>
                <small>{item.description}</small>
              </span>
              <em>{item.checks}</em>
            </button>
          ))}
        </div>
        <div className="screener-guide">
          <Target />
          <div>
            <strong>What this preset checks</strong>
            <span>{preset === "Momentum confirmation" ? "Price is above its trend line, RSI is in a constructive range, and volume supports the move." : preset === "Quiet breakout" ? "Price exits a compact range, volatility is controlled, and participation starts to improve." : "The larger trend is intact, price revisits EMA20, then closes back above its open."}</span>
          </div>
          <button type="button" aria-label="Learn how Signalgen uses this preset">
            <CircleHelp />
          </button>
        </div>
        <div className="control-grid">
          <label>
            Scan mode
            <select value="Screening" disabled>
              <option>Screening</option>
            </select>
          </label>
          <label>
            Timeframe
            <select value="1D" disabled>
              <option>1D</option>
            </select>
          </label>
          <label className="control-wide">
            Sample instrument
            <Input value="BBCA.JK" disabled />
          </label>
          <label>
            Selected preset
            <select value={preset} disabled>
              <option>{preset}</option>
            </select>
          </label>
          <label>
            Fixture window
            <select value="01 Jan—09 Feb 2026" disabled>
              <option>01 Jan—09 Feb 2026</option>
            </select>
          </label>
        </div>
        <div className="dataset-readout">
          <Database />
          <div>
            <strong>IDX daily fixture · 1 instrument · 40 candles</strong>
            <span>
              Versioned synthetic data · verified hash · not live market data
            </span>
          </div>
        </div>
        <div className="run-controls">
          <Button
            className="ui-button ui-button--primary"
            onClick={run}
            disabled={job === "running" || job === "preparing"}
          >
            {job === "completed" ? <RefreshCw data-icon="inline-start" /> : <BarChart3 data-icon="inline-start" />}
            {job === "completed" ? "Run again" : "Run this screen"}
          </Button>
          {(job === "running" || job === "preparing") && (
            <Button className="ui-button" onClick={cancel}>
              <XCircle data-icon="inline-start" /> Cancel
            </Button>
          )}
        </div>
        {job !== "idle" && (
          <div className={`job-status is-${job}`} role="status">
            <div>
              <span>{stage}</span>
              <strong>
                {job === "cancelled" ? "Configuration saved" : `${progress}%`}
              </strong>
            </div>
            <i
              style={{
                transform: `scaleX(${job === "cancelled" ? 0 : progress / 100})`,
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
            {!authenticated && <a href="#login">Sign in</a>}
          </div>
        )}
      </section>
      <section className="panel results-panel">
        <div className="panel-heading">
          <div>
            <h3>Results and evidence</h3>
          </div>
          <span className="muted-meta">default-scalping-v1 · synthetic</span>
        </div>
        {job === "preparing" || job === "running" ? (
          <AnalysisSkeleton />
        ) : job !== "completed" || !liveRun ? (
          <div className="results-empty">
            <BarChart3 />
            <strong>Your matches will appear here</strong>
            <p>
              Run the selected screen to see browser-computed features, the
              server score, decision evidence, and the data version used.
            </p>
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
                    <TableCell>{liveRun.latestDecision.matched ? "Matched" : "Not matched"}</TableCell>
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
                <strong>How it works:</strong> indicators are calculated by
                Go/WASM in the browser, while the final decision is calculated
                by private Gin scoring. This fixture is not a price prediction
                or a trading recommendation.
              </span>
            </div>
            <div
              className="feature-evidence"
              aria-label="Go WebAssembly feature vector"
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
                Latest price <strong>{liveRun.features.price.toFixed(2)}</strong>
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
}: {
  rules: DemoRule[];
  setRules: Dispatch<SetStateAction<DemoRule[]>>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const ruleBlueprints = [
    {
      key: "momentum",
      name: "Momentum confirmation",
      logic: "Close > EMA20 · RSI(14) 52–68 · Volume > SMA20",
      price: "Price stays above the 20-day trend line",
      confirmation: "RSI is constructive and volume confirms",
    },
    {
      key: "breakout",
      name: "Quiet breakout",
      logic: "Close > High(20) · ATR contraction · Volume 1.5×",
      price: "Price closes above the 20-day high",
      confirmation: "Volatility contracts before volume expands",
    },
    {
      key: "pullback",
      name: "Pullback continuation",
      logic: "Trend up · Low ≤ EMA20 · Close > Open",
      price: "Price revisits the 20-day trend line",
      confirmation: "The candle closes back above its open",
    },
  ];
  const [blueprintKey, setBlueprintKey] = useState("momentum");
  const selectedBlueprint =
    ruleBlueprints.find((blueprint) => blueprint.key === blueprintKey) ??
    ruleBlueprints[0];
  const [draft, setDraft] = useState({
    name: selectedBlueprint.name,
    logic: selectedBlueprint.logic,
  });
  function applyBlueprint(key: string) {
    const blueprint = ruleBlueprints.find((item) => item.key === key);
    if (!blueprint) return;
    setBlueprintKey(key);
    setDraft({ name: blueprint.name, logic: blueprint.logic });
  }
  function openNew(nextDraft: { name: string; logic: string } = selectedBlueprint) {
    setDraft(nextDraft);
    setEditingId("new");
  }
  function openEdit(rule: DemoRule) {
    const matchingBlueprint = ruleBlueprints.find(
      (blueprint) => blueprint.logic === rule.logic,
    );
    if (matchingBlueprint) setBlueprintKey(matchingBlueprint.key);
    setDraft({ name: rule.name, logic: rule.logic });
    setEditingId(rule.id);
  }
  function saveRule(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.logic.trim()) return;
    if (editingId === "new") {
      setRules([
        ...rules,
        {
          id: crypto.randomUUID(),
          name: draft.name,
          logic: draft.logic,
          version: "draft 01",
          scope: "Yours",
          enabled: true,
        },
      ]);
    } else {
      setRules(
        rules.map((rule) =>
          rule.id === editingId
            ? { ...rule, name: draft.name, logic: draft.logic }
            : rule,
        ),
      );
    }
    setDraft({ name: "", logic: "Close > EMA20" });
    setEditingId(null);
  }
  return (
    <div className="rules-workspace">
      <section className="rules-starter">
        <div>
          <h3>Build from a known pattern</h3>
          <p>Start with a clear market behaviour. You can change the rule logic after the first draft is created.</p>
        </div>
        <div className="rules-starter__templates">
          {[
            ["Momentum", "Trend is confirmed before entry", "Close > EMA20 · RSI(14) 52–68 · Volume > SMA20"],
            ["Breakout", "Price leaves a defined range", "Close > High(20) · ATR contraction · Volume 1.5×"],
            ["Pullback", "Trend resumes after a controlled retest", "Trend up · Low ≤ EMA20 · Close > Open"],
          ].map(([name, description, logic]) => (
            <button key={name} type="button" onClick={() => {
              const blueprint = ruleBlueprints.find((item) => item.logic === logic);
              if (blueprint) applyBlueprint(blueprint.key);
              openNew({ name: `${name} setup`, logic });
            }}>
              <ListChecks />
              <span><strong>{name}</strong><small>{description}</small></span>
              <ChevronRight />
            </button>
          ))}
        </div>
      </section>
      <div className="two-column-page">
      <section className="panel rule-list">
        <div className="panel-heading">
          <div>
            <h3>Your rule library</h3>
            <p>{rules.length} saved rules. System rules stay visible so each screen has an explainable basis.</p>
          </div>
          <Button className="ui-button ui-button--primary" onClick={() => openNew()}>
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
                {rule.version} · {rule.scope === "System" ? "read-only" : "editable"}
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
      <aside className="panel side-explainer">
        {editingId ? (
          <form onSubmit={saveRule}>
            <div className="panel-heading">
              <div>
                <h3>
                  {editingId === "new"
                    ? "New private rule"
                    : "Edit private rule"}
                </h3>
              </div>
              <button
                type="button"
                className="icon-action"
                onClick={() => setEditingId(null)}
                aria-label="Close rule builder"
              >
                <X />
              </button>
            </div>
            <div className="rule-picker">
              <label>
                Strategy
                <select
                  value={blueprintKey}
                  onChange={(event) => applyBlueprint(event.target.value)}
                >
                  {ruleBlueprints.map((blueprint) => (
                    <option key={blueprint.key} value={blueprint.key}>{blueprint.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Price behaviour
                <select value={selectedBlueprint.price} disabled>
                  <option>{selectedBlueprint.price}</option>
                </select>
              </label>
              <label>
                Confirmation
                <select value={selectedBlueprint.confirmation} disabled>
                  <option>{selectedBlueprint.confirmation}</option>
                </select>
              </label>
            </div>
            <div className="rule-preview">
              <span>Rule preview</span>
              <strong>{draft.logic}</strong>
            </div>
            <p className="form-help">
              Pick a pattern first. You can review the exact conditions before saving this local preview rule.
            </p>
            <Button className="ui-button ui-button--primary" type="submit">
              <Save data-icon="inline-start" /> {editingId === "new" ? "Save rule" : "Save changes"}
            </Button>
          </form>
        ) : (
          <button
            className="rule-create-orb"
            type="button"
          onClick={() => openNew()}
          aria-label="Create a new rule"
        >
            <ListChecks />
            <span>Create a rule</span>
            <small>Pick a simple pattern to begin.</small>
          </button>
        )}
      </aside>
      </div>
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
  const [journal, setJournal] = useState<"All journals" | JournalRecord["journal"]>(
    "All journals",
  );
  const [instrument, setInstrument] = useState("All instruments");
  const [selectedId, setSelectedId] = useState(journalRecords[0].id);
  const [captureOpen, setCaptureOpen] = useState(Boolean(draftSymbol));
  const [form, setForm] = useState({
    symbol: draftSymbol ?? "BBCA",
    side: "BUY" as "BUY" | "SELL",
    quantity: "10",
    price: "9675",
    fee: "145",
    date: "2026-09-16",
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
    visibleRecords.find((record) => record.id === selectedId) ?? visibleRecords[0];
  const totalPnl = visibleRecords.reduce((total, record) => total + record.pnl, 0);
  const wins = visibleRecords.filter((record) => record.pnl > 0);
  const losses = visibleRecords.filter((record) => record.pnl < 0);
  const profitRatio = losses.length ? wins.length / losses.length : wins.length;
  const winRate = visibleRecords.length
    ? Math.round((wins.length / visibleRecords.length) * 100)
    : 0;

  function addTransaction(event: FormEvent) {
    event.preventDefault();
    setTransactions([
      {
        id: crypto.randomUUID(),
        symbol: form.symbol.toUpperCase(),
        side: form.side,
        quantity: Number(form.quantity),
        price: Number(form.price),
        fee: Number(form.fee),
        date: form.date,
      },
      ...transactions,
    ]);
    clearDraft();
    setCaptureOpen(false);
  }

  const chartPoints = [
    [3, 84],
    [18, 77],
    [31, 80],
    [45, 59],
    [58, 51],
    [72, 57],
    [84, 33],
    [97, 25],
  ]
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
          <button className="journal-date" type="button">
            <CalendarRange />
            01–16 Sep 2026
          </button>
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
              <p>Store the entry locally first; close data can be added later.</p>
            </div>
            {draftSymbol && <Badge variant="outline">From analysis</Badge>}
          </div>
          <form onSubmit={addTransaction} className="control-grid">
            <label>
              Symbol
              <Input
                value={form.symbol}
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
            <Button className="ui-button ui-button--primary control-wide" type="submit">
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
              <dt>Profit ratio</dt>
              <dd>{profitRatio.toFixed(1)}×</dd>
            </div>
            <div>
              <dt>Average win</dt>
              <dd>{formatRupiah(wins.reduce((sum, record) => sum + record.pnl, 0) / wins.length)}</dd>
            </div>
          </dl>
        </div>
        <figure className="journal-pnl-chart">
          <figcaption>
            <span>Realized P&amp;L sequence</span>
            <small>Ordered by closed trade, not a live price chart.</small>
          </figcaption>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Illustrative realized profit and loss sequence">
            <line x1="0" x2="100" y1="25" y2="25" />
            <line x1="0" x2="100" y1="50" y2="50" />
            <line x1="0" x2="100" y1="75" y2="75" />
            <polyline points={chartPoints} />
            {[[3, 84], [18, 77], [31, 80], [45, 59], [58, 51], [72, 57], [84, 33], [97, 25]].map(([cx, cy]) => (
              <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.8" />
            ))}
          </svg>
        </figure>
      </section>

      <section className="journal-ledger" aria-label="Closed trade history">
        <header>
          <div>
            <h3>Closed trades</h3>
            <p>Newest closed positions first. Select a row to inspect the trade note.</p>
          </div>
          <span>{visibleRecords.length} records</span>
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
                  className={record.id === selectedRecord?.id ? "is-selected" : undefined}
                  onClick={() => setSelectedId(record.id)}
                >
                  <TableCell>
                    <button
                      className="journal-trade-select"
                      type="button"
                      onClick={() => setSelectedId(record.id)}
                      aria-current={record.id === selectedRecord?.id ? "true" : undefined}
                    >
                      {record.exitAt}
                    </button>
                  </TableCell>
                  <TableCell><strong>{record.symbol}</strong></TableCell>
                  <TableCell>
                    <span className={`journal-direction is-${record.direction.toLowerCase()}`}>
                      {record.direction === "Long" ? <ArrowUpRight /> : <ArrowDownRight />}
                      {record.direction}
                    </span>
                    <small>{record.size}</small>
                  </TableCell>
                  <TableCell>{record.entry.toLocaleString("id-ID")} / {record.exit.toLocaleString("id-ID")}</TableCell>
                  <TableCell>
                    <b className={record.pnl > 0 ? "positive" : "negative"}>
                      {record.pnl > 0 ? "+" : "-"}{formatRupiah(record.pnl)}
                    </b>
                    <small>{record.pnlPercent > 0 ? "+" : ""}{record.pnlPercent.toFixed(2)}%</small>
                  </TableCell>
                  <TableCell>{record.mfe.toFixed(2)}% / {record.mae.toFixed(2)}%</TableCell>
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
              <h3>{selectedRecord.symbol} {selectedRecord.direction.toLowerCase()} review</h3>
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
              <strong>{selectedRecord.entryAt} → {selectedRecord.exitAt}</strong>
            </div>
          </div>
          <div className="journal-tags" aria-label="Trade tags">
            <Tag />
            {selectedRecord.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        </aside>
      )}

      {transactions.length > 0 && (
        <section className="journal-drafts" aria-label="Locally captured trade drafts">
          <div>
            <span>Local drafts</span>
            <p>{transactions.length} entries are waiting for an exit price and remain only in this browser preview.</p>
          </div>
          <div className="journal-drafts__items">
            {transactions.map((tx) => (
              <article key={tx.id}>
                <strong>{tx.symbol}</strong>
                <span>{tx.side} · {tx.quantity} lots at {tx.price.toLocaleString("id-ID")}</span>
                <button
                  className="icon-action"
                  onClick={() => setTransactions(transactions.filter((item) => item.id !== tx.id))}
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
      const [nextAccount, response] = await Promise.all([
        api.account(),
        api.listDevices(),
      ]);
      setAccount(nextAccount);
      setDevices(response.items);
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
  const [draftSymbol, setDraftSymbol] = useState<string | null>(null);
  const [rules, setRules] = useState<DemoRule[]>(demoRules);
  const [transactions, setTransactions] =
    useState<DemoTransaction[]>(initialTransactions);
  const [cacheState, setCacheState] = useState("14.8 MB · encrypted (sample)");
  const meta = viewMeta[view];
  function go(next: DemoView) {
    location.hash = `app/${next}`;
    setMenuOpen(false);
  }
  function draft(symbol: string) {
    setDraftSymbol(symbol);
    go("journal");
  }
  return (
    <main className="workbench demo-workbench">
      <aside className={`sidebar ${menuOpen ? "is-open" : ""}`}>
        <div className="sidebar__brand">
          <a href="#home">
            <Brand compact />
          </a>
          <button onClick={() => setMenuOpen(false)} aria-label="Close menu">
            <X />
          </button>
        </div>
        <div className="surface-label">
          <span>Demo workspace</span>
          <i className="status-dot is-online" />
        </div>
        <nav aria-label="Demo navigation">
          {" "}
          <div className="nav-group">
            <span>MVP SURFACES</span>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.view}
                  className={view === item.view ? "active" : ""}
                  onClick={() => go(item.view)}
                >
                  {view === item.view && <i />}
                  <Icon /> {item.label}
                </button>
              );
            })}
          </div>
          <div className="nav-group">
            <span>ACCOUNT</span>
            <a href="#account">
              <KeyRound /> Live account
            </a>
          </div>
        </nav>
        <div className="sidebar__footer">
          <a className="back-home" href="#home">
            <ArrowLeft /> Back to landing page
          </a>
          <small>Signalgen web · local UX fixture</small>
        </div>
      </aside>
      {menuOpen && (
        <button
          className="backdrop"
          onClick={() => setMenuOpen(false)}
          aria-label="Close menu"
        />
      )}
      <section className="workspace">
        <header className="topbar">
          <div className="topbar__title">
            <button
              className="menu-button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open demo menu"
            >
              <Menu />
            </button>
            <div>
              <span className="breadcrumb">Signalgen / Demo / {view}</span>
              <h1>{meta.title}</h1>
            </div>
          </div>
          <div className="topbar__actions">
            <span className="preview-chip">
              {authenticated ? "Go API connected" : "Static preview"}
            </span>
            {authenticated && user ? (
              <AccountMenu
                user={user}
                onLogout={onLogout}
                label="Account"
                variant="workspace"
              />
            ) : (
              <a className="ui-button" href="#login">Sign in</a>
            )}
          </div>
        </header>
        <div className="workspace__content demo-content">
          <DemoNotice authenticated={authenticated} view={view} />
          <div className="page-heading">
            <div>
              <h2>{meta.title}</h2>
              <p>{meta.description}</p>
            </div>
            <span>
              {view === "realtime"
                ? "TradingView widget · exchange delay may apply"
                : "Last reset · reload page"}
            </span>
          </div>
          <div className="route-stage" key={view}>
            {view === "overview" && <OverviewPanel go={go} />}
            {view === "analysis" && (
              <AnalysisPanel
                onDraft={draft}
                authenticated={authenticated}
                backendOnline={backendOnline}
              />
            )}
            {view === "realtime" && <RealtimePanel />}
            {view === "rules" && (
              <RulesPanel rules={rules} setRules={setRules} />
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
          </div>
        </div>
      </section>
    </main>
  );
}
