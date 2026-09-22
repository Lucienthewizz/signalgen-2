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
  BarChart3,
  BookOpenCheck,
  Braces,
  Check,
  ChevronRight,
  CircleAlert,
  CircleDot,
  Database,
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
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { Brand } from "@/components/brand";
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
  demoSessions,
  demoSignals,
  initialTransactions,
  type DemoRule,
  type DemoTransaction,
} from "@/data/demo";

export type DemoView = "overview" | "analysis" | "rules" | "journal" | "access";

type JobState = "idle" | "preparing" | "running" | "completed" | "cancelled";

const viewMeta: Record<DemoView, { title: string; description: string }> = {
  overview: {
    title: "Workspace overview",
    description: "A map of MVP features and their current integration status.",
  },
  analysis: {
    title: "Run analysis",
    description: "Configure a screening or backtest and inspect the evidence.",
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
  { view: "analysis", label: "Analysis", icon: BarChart3 },
  { view: "rules", label: "Rules", icon: Braces },
  { view: "journal", label: "Journal", icon: BookOpenCheck },
  { view: "access", label: "Access", icon: ShieldCheck },
];

function DemoNotice() {
  return (
    <div className="demo-notice" role="note">
      <Database />
      <div>
        <strong>Demo data is active</strong>
        <span>
          Every feature is available; local changes persist for this session.
        </span>
      </div>
      <Badge variant="outline">Local data</Badge>
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
  rules,
}: {
  onDraft: (symbol: string) => void;
  rules: DemoRule[];
}) {
  const [job, setJob] = useState<JobState>("idle");
  const [progress, setProgress] = useState(0);
  const timer = useRef<number | null>(null);
  const prepareTimer = useRef<number | null>(null);
  const [config, setConfig] = useState({
    mode: "Screening",
    symbol: "BBCA, TLKM, ASII, BMRI",
    rule: "Momentum confirmation",
    timeframe: "1D",
    period: "1 year",
  });

  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current);
      if (prepareTimer.current) window.clearTimeout(prepareTimer.current);
    },
    [],
  );

  function run() {
    if (timer.current) window.clearInterval(timer.current);
    if (prepareTimer.current) window.clearTimeout(prepareTimer.current);
    setJob("preparing");
    setProgress(12);
    prepareTimer.current = window.setTimeout(() => {
      setJob("running");
      timer.current = window.setInterval(() => {
        setProgress((value) => {
          const next = Math.min(value + 18, 100);
          if (next === 100) {
            if (timer.current) window.clearInterval(timer.current);
            setJob("completed");
          }
          return next;
        });
      }, 240);
    }, 350);
  }

  function cancel() {
    if (timer.current) window.clearInterval(timer.current);
    if (prepareTimer.current) window.clearTimeout(prepareTimer.current);
    setJob("cancelled");
  }

  return (
    <div className="analysis-layout">
      <section className="panel configure-panel">
        <div className="panel-heading">
          <div>
            <h3>Configuration</h3>
          </div>
          <Badge variant="outline">Demo</Badge>
        </div>
        <div className="control-grid">
          <label>
            Mode
            <select
              value={config.mode}
              onChange={(e) => setConfig({ ...config, mode: e.target.value })}
            >
              <option>Screening</option>
              <option>Backtest</option>
            </select>
          </label>
          <label>
            Timeframe
            <select
              value={config.timeframe}
              onChange={(e) =>
                setConfig({ ...config, timeframe: e.target.value })
              }
            >
              <option>1D</option>
              <option>4H</option>
            </select>
          </label>
          <label className="control-wide">
            Stock list
            <Input
              value={config.symbol}
              onChange={(e) => setConfig({ ...config, symbol: e.target.value })}
            />
          </label>
          <label>
            Rule
            <select
              value={config.rule}
              onChange={(e) => setConfig({ ...config, rule: e.target.value })}
            >
              {rules
                .filter((rule) => rule.enabled)
                .map((rule) => (
                  <option key={rule.id}>{rule.name}</option>
                ))}
            </select>
          </label>
          <label>
            Period
            <select
              value={config.period}
              onChange={(e) => setConfig({ ...config, period: e.target.value })}
            >
              <option>6 months</option>
              <option>1 year</option>
              <option>3 years</option>
            </select>
          </label>
        </div>
        <div className="dataset-readout">
          <Database />
          <div>
            <strong>IDX daily fixture · 4 symbols</strong>
            <span>
              01 Sep 2025—01 Sep 2026 · checksum demo-8f21 · 30-candle warmup
            </span>
          </div>
        </div>
        <div className="run-controls">
          <Button
            className="ui-button ui-button--primary"
            onClick={run}
            disabled={job === "running" || job === "preparing"}
          >
            {job === "completed" ? <RefreshCw /> : <BarChart3 />}
            {job === "completed" ? "Run again" : "Run analysis"}
          </Button>
          {(job === "running" || job === "preparing") && (
            <Button className="ui-button" onClick={cancel}>
              <XCircle /> Cancel
            </Button>
          )}
        </div>
        {job !== "idle" && (
          <div className={`job-status is-${job}`} role="status">
            <div>
              <span>
                {job === "preparing"
                  ? "Preparing dataset"
                  : job === "running"
                    ? "Running fixture"
                    : job === "completed"
                      ? "Analysis complete"
                      : "Analysis cancelled"}
              </span>
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
      </section>
      <section className="panel results-panel">
        <div className="panel-heading">
          <div>
            <h3>Results & evidence</h3>
          </div>
          <span className="muted-meta">
            rule{" "}
            {rules.find((rule) => rule.name === config.rule)?.version ??
              "draft"}{" "}
            · synthetic
          </span>
        </div>
        {job === "preparing" || job === "running" ? (
          <AnalysisSkeleton />
        ) : job !== "completed" ? (
          <div className="results-empty">
            <BarChart3 />
            <strong>Results will appear here</strong>
            <p>
              Run this configuration to view the summary, match reasons,
              assumptions, and signal table.
            </p>
          </div>
        ) : (
          <div className="results-loaded">
            <div className="result-metrics">
              <div>
                <span>Matches</span>
                <strong>2 / 4</strong>
              </div>
              <div>
                <span>Median score</span>
                <strong>71.0</strong>
              </div>
              <div>
                <span>Data quality</span>
                <strong>Complete</strong>
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
                  {demoSignals.map((signal) => (
                    <TableRow key={signal.symbol}>
                      <TableCell>
                        <strong>{signal.symbol}</strong>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`signal-state is-${signal.state.toLowerCase().replace(" ", "-")}`}
                        >
                          {signal.state}
                        </span>
                      </TableCell>
                      <TableCell>{signal.close}</TableCell>
                      <TableCell>{signal.score}</TableCell>
                      <TableCell>{signal.reason}</TableCell>
                      <TableCell>
                        <button
                          className="table-action"
                          onClick={() => onDraft(signal.symbol)}
                        >
                          Draft journal
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="assumption-line">
              <CircleAlert />
              <span>
                <strong>Assumptions:</strong> closing prices with no slippage.
                These are UX fixtures, not investment-engine output.
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
  const [draft, setDraft] = useState({ name: "", logic: "Close > EMA20" });
  function openNew() {
    setDraft({ name: "", logic: "Close > EMA20" });
    setEditingId("new");
  }
  function openEdit(rule: DemoRule) {
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
    <div className="two-column-page">
      <section className="panel rule-list">
        <div className="panel-heading">
          <div>
            <span>RULE SET</span>
            <h3>{rules.length} rules available</h3>
          </div>
          <Button className="ui-button ui-button--primary" onClick={openNew}>
            <Plus /> New rule
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
      <aside className="panel side-explainer">
        {editingId ? (
          <form onSubmit={saveRule}>
            <div className="panel-heading">
              <div>
                <span>BUILDER</span>
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
            <label>
              Rule name
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Example: Trend pullback"
                required
              />
            </label>
            <label>
              Logic
              <Textarea
                value={draft.logic}
                onChange={(e) => setDraft({ ...draft, logic: e.target.value })}
              />
            </label>
            <p className="form-help">
              The MVP builder stores conditions as a local draft. Operator
              validation will follow the engine contract.
            </p>
            <Button className="ui-button ui-button--primary" type="submit">
              <Save /> {editingId === "new" ? "Save rule" : "Save changes"}
            </Button>
          </form>
        ) : (
          <>
            <Braces />
            <h3>Every rule remains inspectable.</h3>
            <p>
              System rules are versioned and read-only. Your rules can be
              enabled, created, edited, or deleted in this preview.
            </p>
            <button className="text-link" onClick={openNew}>
              Open builder <ChevronRight />
            </button>
          </>
        )}
      </aside>
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
  const [form, setForm] = useState({
    symbol: draftSymbol ?? "BBCA",
    side: "BUY" as "BUY" | "SELL",
    quantity: "10",
    price: "9675",
    fee: "145",
    date: "2026-09-16",
  });
  useEffect(() => {
    if (draftSymbol)
      setForm((current) => ({ ...current, symbol: draftSymbol }));
  }, [draftSymbol]);
  const invested = useMemo(
    () =>
      transactions.reduce(
        (sum, tx) =>
          sum +
          (tx.side === "BUY"
            ? tx.quantity * 100 * tx.price + tx.fee
            : -(tx.quantity * 100 * tx.price - tx.fee)),
        0,
      ),
    [transactions],
  );
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
  }
  return (
    <div className="journal-layout">
      <section className="panel journal-form">
        <div className="panel-heading">
          <div>
            <span>INPUT</span>
            <h3>Manual transaction</h3>
          </div>
          {draftSymbol && (
            <Badge variant="outline">Drafted from analysis</Badge>
          )}
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
            Price
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
            Date
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
            <Save /> Save local transaction
          </Button>
        </form>
      </section>
      <section className="panel journal-book">
        <div className="journal-summary">
          <div>
            <span>Recorded capital</span>
            <strong>Rp {invested.toLocaleString("id-ID")}</strong>
          </div>
          <div>
            <span>Sample valuation</span>
            <strong>Rp 16.825.000</strong>
          </div>
          <div>
            <span>Unrealized P&amp;L</span>
            <strong className="positive">+Rp 1.137.400</strong>
          </div>
        </div>
        <div className="panel-heading">
          <div>
            <span>LEDGER</span>
            <h3>Transaction history</h3>
          </div>
          <small className="muted-meta">Sample prices · 16 Sep 2026</small>
        </div>
        <div className="transaction-list">
          {transactions.map((tx) => (
            <article key={tx.id}>
              <span className={`side-marker is-${tx.side.toLowerCase()}`}>
                {tx.side}
              </span>
              <div>
                <strong>{tx.symbol}</strong>
                <small>
                  {tx.date} · {tx.quantity} lot × Rp{" "}
                  {tx.price.toLocaleString("id-ID")}
                </small>
              </div>
              <b>Rp {(tx.quantity * 100 * tx.price).toLocaleString("id-ID")}</b>
              <button
                className="icon-action"
                onClick={() =>
                  setTransactions(
                    transactions.filter((item) => item.id !== tx.id),
                  )
                }
                aria-label={`Delete ${tx.symbol} transaction`}
              >
                <Trash2 />
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function AccessPanel({
  backendOnline,
  sessions,
  setSessions,
  cacheState,
  setCacheState,
}: {
  backendOnline: boolean;
  sessions: typeof demoSessions;
  setSessions: Dispatch<SetStateAction<typeof demoSessions>>;
  cacheState: string;
  setCacheState: Dispatch<SetStateAction<string>>;
}) {
  return (
    <div className="access-grid">
      <section className="panel entitlement-panel">
        <div className="panel-heading">
          <div>
            <span>ENTITLEMENT</span>
            <h3>Research access</h3>
          </div>
          <Badge variant="outline">Demo tier</Badge>
        </div>
        <div className="entitlement-row">
          <span>Screening</span>
          <strong>
            <Check /> Allowed
          </strong>
        </div>
        <div className="entitlement-row">
          <span>3-year backtest</span>
          <strong>
            <Check /> Allowed
          </strong>
        </div>
        <div className="entitlement-row">
          <span>Realtime feed</span>
          <em>
            <X /> Outside MVP scope
          </em>
        </div>
        <div className="auth-contract">
          <KeyRound />
          <div>
            <strong>Backend API</strong>
            <span>
              {backendOnline
                ? "Base API available; sign-in uses the /api/auth contract"
                : "Base API unavailable; sign-in will show the actual error"}
            </span>
          </div>
        </div>
      </section>
      <section className="panel sessions-panel">
        <div className="panel-heading">
          <div>
            <span>SESSIONS</span>
            <h3>Active devices</h3>
          </div>
          <span className="muted-meta">{sessions.length} devices</span>
        </div>
        {sessions.map((session) => (
          <article key={session.id}>
            <div className="device-icon">
              <Activity />
            </div>
            <div>
              <strong>
                {session.device}
                {session.current && <Badge variant="outline">Current</Badge>}
              </strong>
              <span>
                {session.place} · {session.active}
              </span>
            </div>
            {!session.current && (
              <button
                className="table-action"
                onClick={() =>
                  setSessions(sessions.filter((item) => item.id !== session.id))
                }
              >
                Revoke
              </button>
            )}
          </article>
        ))}
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

export function DemoWorkspace({
  view,
  backendOnline,
}: {
  view: DemoView;
  backendOnline: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [draftSymbol, setDraftSymbol] = useState<string | null>(null);
  const [rules, setRules] = useState<DemoRule[]>(demoRules);
  const [transactions, setTransactions] =
    useState<DemoTransaction[]>(initialTransactions);
  const [sessions, setSessions] = useState(demoSessions);
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
            <span className="preview-chip">Static data</span>
            <a className="ui-button" href="#login">
              Sign in
            </a>
          </div>
        </header>
        <div className="workspace__content demo-content">
          <DemoNotice />
          <div className="page-heading">
            <div>
              <h2>{meta.title}</h2>
              <p>{meta.description}</p>
            </div>
            <span>Last reset · reload page</span>
          </div>
          <div className="route-stage" key={view}>
            {view === "overview" && <OverviewPanel go={go} />}
            {view === "analysis" && (
              <AnalysisPanel onDraft={draft} rules={rules} />
            )}
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
                sessions={sessions}
                setSessions={setSessions}
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
