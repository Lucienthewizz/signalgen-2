import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Boxes,
  Clock3,
  ListChecks,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  Activity,
  Newspaper,
} from "lucide-react";
import { api } from "@/api/client";
import { FeatureFigure } from "@/components/feature-figure";
import { monitorRuns, type MonitorRun } from "@/lib/market-monitor";
import { screeningStatus, screeningStatusLabels } from "@/lib/screening-status";
import {
  readScreenerPreferences,
  saveScreenerPreferences,
} from "@/lib/screener-preferences";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import type {
  AccountState,
  RuleResource,
  StockUniverse,
  Subscription,
} from "@/types";

type Props = {
  authenticated: boolean;
  backendOnline: boolean;
  userId?: string;
  go: (
    view:
      | "analysis"
      | "rules"
      | "universes"
      | "access"
      | "subscription"
      | "realtime"
      | "news",
  ) => void;
};

export function WorkspaceOverviewPanel({
  authenticated,
  backendOnline,
  userId,
  go,
}: Props) {
  const [account, setAccount] = useState<AccountState | null>(null);
  const [rules, setRules] = useState<RuleResource[]>([]);
  const [universes, setUniverses] = useState<StockUniverse[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [history, setHistory] = useState<MonitorRun[]>([]);
  useEffect(() => {
    const update = () => setHistory(monitorRuns(userId));
    update();
    window.addEventListener("signalgen:monitor-run", update);
    return () => window.removeEventListener("signalgen:monitor-run", update);
  }, [userId]);
  useEffect(() => {
    setAccount(null);
    setRules([]);
    setUniverses([]);
    setSubscription(null);
  }, [userId]);
  useEffect(() => {
    if (!authenticated || !backendOnline) return;
    let active = true;
    setLoading(true);
    setError(false);
    // One failed request must not hide the resources that are available.
    Promise.allSettled([
      api.account(),
      api.listRules(),
      api.listStockUniverses(),
      api.currentSubscription(),
    ]).then(([a, r, u, s]) => {
      if (!active) return;
      if (a.status === "fulfilled") setAccount(a.value);
      if (r.status === "fulfilled") setRules(r.value.items);
      if (u.status === "fulfilled") setUniverses(u.value.items);
      if (s.status === "fulfilled") setSubscription(s.value.subscription);
      setError([a, r, u, s].some((result) => result.status === "rejected"));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [authenticated, backendOnline, userId, reload]);
  const preferences = userId ? readScreenerPreferences(userId) : null;
  const activeRule =
    rules.find((rule) => rule.id === preferences?.ruleId) ?? rules[0];
  const activeUniverse =
    universes.find((universe) => universe.id === preferences?.universeId) ??
    universes[0];
  const ready =
    Boolean(account?.features.includes("screener")) &&
    rules.length > 0 &&
    universes.length > 0;
  const latest = history[0];
  const nextStep = !account?.features.includes("screener")
    ? "subscription"
    : !rules.length
      ? "rules"
      : "universes";
  function continueScreen(item?: MonitorRun) {
    if (userId && item?.context)
      saveScreenerPreferences(userId, {
        ...readScreenerPreferences(userId),
        ruleId: item.context.ruleId,
        universeId: item.context.universeId,
      });
    go("analysis");
  }
  if (!authenticated || !backendOnline)
    return (
      <Alert className="overview-notice">
        <ShieldCheck />
        <AlertTitle>
          {backendOnline
            ? "Sign in to open your workspace"
            : "Backend unavailable"}
        </AlertTitle>
        <AlertDescription>
          {backendOnline
            ? "Rules, universes, and history are private to each account."
            : "Connect the backend to load your account and run screening."}
        </AlertDescription>
        {backendOnline && (
          <Button nativeButton={false} render={<a href="#login" />}>
            Sign in
          </Button>
        )}
      </Alert>
    );
  if (loading && !account)
    return (
      <div
        className="overview-board"
        role="status"
        aria-label="Loading dashboard"
        aria-busy="true"
      >
        <section
          className="overview-next overview-placeholder"
          aria-hidden="true"
        >
          <Skeleton className="dashboard-skeleton__value" />
          <Skeleton className="dashboard-skeleton__line" />
          <Skeleton className="dashboard-skeleton__action" />
        </section>
        <div
          className="overview-counts overview-placeholder"
          aria-hidden="true"
        >
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="dashboard-skeleton__value" />
          ))}
        </div>
        <section className="overview-placeholder" aria-hidden="true">
          <Skeleton className="dashboard-skeleton__line" />
          <Skeleton className="overview-placeholder__rows" />
        </section>
      </div>
    );
  return (
    <div className="overview-board" aria-busy={loading}>
      {error && (
        <Alert className="overview-notice">
          <RefreshCw />
          <AlertTitle>Some data could not be loaded</AlertTitle>
          <AlertDescription>
            Available data is still shown. Reload to update your dashboard.
          </AlertDescription>
          <Button
            variant="outline"
            onClick={() => setReload((v) => v + 1)}
            disabled={loading}
          >
            Reload
          </Button>
        </Alert>
      )}
      <div className="overview-launch">
        <section
          className="overview-next"
          aria-labelledby="overview-next-title"
        >
          <div>
            <h3 id="overview-next-title">
              {ready
                ? latest
                  ? "Continue your analysis"
                  : "Ready for your first screening"
                : "Set up your workspace"}
            </h3>
            <p>
              {ready
                ? latest
                  ? "Use your last selection or adjust it before screening."
                  : "Choose a rule and stock universe, then review the results and evidence."
                : "You need screener access, a rule, and a stock universe to run an analysis."}
            </p>
            <dl className="overview-selection">
              <div>
                <dt>
                  <ListChecks aria-hidden="true" />
                  Rule
                </dt>
                <dd>{activeRule?.name ?? "Not selected"}</dd>
              </div>
              <div>
                <dt>
                  <Boxes aria-hidden="true" />
                  Stock universe
                </dt>
                <dd>{activeUniverse?.name ?? "Not created"}</dd>
                {activeUniverse && (
                  <span>{activeUniverse.symbols.length} stocks</span>
                )}
              </div>
            </dl>
            {latest && (
              <div
                className="overview-last-screen"
                aria-label="Latest screening summary"
              >
                <p>
                  Last screen · {latest.run.manifest.market} ·{" "}
                  {new Date(latest.recordedAt).toLocaleString("en-GB")}
                </p>
                <ul>
                  {(["buy", "sell", "cooldown"] as const).map((status) => (
                    <li key={status}>
                      <strong>
                        {
                          latest.run.rows.filter(
                            (row) => screeningStatus(row.decision) === status,
                          ).length
                        }
                      </strong>{" "}
                      {screeningStatusLabels[status]}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <Button
            size="lg"
            onClick={() => (ready ? continueScreen() : go(nextStep))}
          >
            <SearchCheck data-icon="inline-start" />
            {ready
              ? "Open screener"
              : nextStep === "subscription"
                ? "Check access"
                : nextStep === "rules"
                  ? "Create rule"
                  : "Create universe"}
          </Button>
        </section>
        <nav className="overview-shortcuts" aria-label="Quick access">
          <h3>Follow the market</h3>
          <button onClick={() => go("realtime")}>
            <Activity aria-hidden="true" />
            <span>
              <strong>Market monitor</strong>
              <small>Charts and prices for your watchlist</small>
            </span>
            <ArrowUpRight aria-hidden="true" />
          </button>
          <button onClick={() => go("news")}>
            <Newspaper aria-hidden="true" />
            <span>
              <strong>News & videos</strong>
              <small>Company updates and market news</small>
            </span>
            <ArrowUpRight aria-hidden="true" />
          </button>
        </nav>
      </div>
      <section
        className="overview-resources feature-gallery"
        aria-label="Workspace overview"
      >
        {(
          [
            {
              view: "rules",
              figure: "rules",
              label: "Rules",
              value: rules.length,
              action: "Manage rules",
            },
            {
              view: "universes",
              figure: "analysis",
              label: "Stock universes",
              value: universes.length,
              action: "Manage universes",
            },
            {
              view: "subscription",
              figure: "journal",
              label: "Plan",
              value: subscription?.plan_name ?? "—",
              action: "View plan",
            },
            {
              view: "access",
              figure: "access",
              label: "Account",
              value:
                account?.user.status === "active"
                  ? "Active"
                  : (account?.user.status ?? "—"),
              action: "View account",
            },
          ] as const
        ).map((resource) => (
          <a
            className="feature-gallery__item"
            href={`#app/${resource.view}`}
            key={resource.view}
          >
            <div className="feature-gallery__figure">
              <div className="feature-gallery__depth">
                <FeatureFigure kind={resource.figure} />
              </div>
            </div>
            <div className="feature-gallery__copy">
              <strong>{resource.label}</strong>
              <p className="overview-resources__value">{resource.value}</p>
              <span>
                {resource.action} <ArrowUpRight aria-hidden="true" />
              </span>
            </div>
          </a>
        ))}
      </section>
      <section
        className="overview-activity"
        aria-labelledby="overview-activity-title"
      >
        <header>
          <h3 id="overview-activity-title">
            <Clock3 aria-hidden="true" />
            Recent screening
          </h3>
          <span className="overview-activity__caption">
            {history.length
              ? `${Math.min(history.length, 5)} recent runs`
              : "Workspace history"}
          </span>
        </header>
        {history.length ? (
          <ul>
            {history.slice(0, 5).map((item) => (
              <li key={item.recordedAt}>
                <div>
                  <strong>{item.rule}</strong>
                  <p>
                    {item.context?.universeName ??
                      item.run.rows
                        .map((row) => row.decision.symbol.replace(".JK", ""))
                        .join(", ")}
                  </p>
                </div>
                <div className="overview-run-meta">
                  <Badge variant="secondary" className="overview-run-chip">
                    {item.run.manifest.timeframe} candles
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="overview-run-chip"
                    render={<time dateTime={item.recordedAt} />}
                  >
                    {new Date(item.recordedAt).toLocaleString("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Badge>
                  <Badge
                    variant={
                      item.run.rows.some((row) => row.decision.matched)
                        ? "success"
                        : "destructive"
                    }
                    className="overview-run-chip overview-match-count"
                  >
                    {item.run.rows.filter((row) => row.decision.matched).length}{" "}
                    / {item.run.rows.length} matched
                  </Badge>
                  <Button
                    variant="outline"
                    size="xs"
                    className="overview-run-chip"
                    onClick={() => continueScreen(item)}
                  >
                    Use selection
                    <ArrowUpRight data-icon="inline-end" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty className="overview-activity__empty">
            <EmptyHeader>
              <EmptyTitle>No completed screening yet</EmptyTitle>
              <EmptyDescription>
                Your first result will appear here after a successful run.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </div>
  );
}
