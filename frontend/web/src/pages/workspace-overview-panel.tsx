import SpotlightCard from "@/components/react-bits/SpotlightCard";
import CountUp from "@/components/react-bits/CountUp";
import MagicBento from "@/components/react-bits/MagicBento";
import { useVisualPreferences } from "@/lib/visual-preferences";
import "@/styles/overview-bento.css";
import { PortfolioOverview } from "@/components/portfolio-overview";
import { tierName } from "@/lib/tier-access";
import { screeningSetup } from "@/lib/screening-setup";
import { SINGAPORE_TIME_ZONE } from "@/lib/calendar";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Boxes,
  Clock3,
  Crown,
  ListChecks,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  Activity,
  Newspaper,
  UserRound,
} from "lucide-react";
import { api, ui } from "@/api/client";
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
  workspaceReady: boolean;
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
  workspaceReady,
  go,
}: Props) {
  const { light, reduced } = useVisualPreferences();
  const [account, setAccount] = useState<AccountState | null>(null);
  const [rules, setRules] = useState<RuleResource[]>(
    () => ui.peekRules(userId)?.items ?? [],
  );
  const [universes, setUniverses] = useState<StockUniverse[]>(
    () => ui.peekUniverses(userId)?.items ?? [],
  );
  const [subscription, setSubscription] = useState<Subscription | null>(
    () => ui.peekSubscription(userId)?.subscription ?? null,
  );
  const [pending, setPending] = useState({
    account: true,
    rules: true,
    universes: true,
    subscription: true,
  });
  const loading = Object.values(pending).some(Boolean);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [history, setHistory] = useState<MonitorRun[]>([]);
  useEffect(() => {
    const update = () => setHistory(workspaceReady ? monitorRuns(userId) : []);
    update();
    window.addEventListener("signalgen:monitor-run", update);
    return () => window.removeEventListener("signalgen:monitor-run", update);
  }, [userId, workspaceReady]);
  useEffect(() => {
    setAccount(null);
    setRules(ui.peekRules(userId)?.items ?? []);
    setUniverses(ui.peekUniverses(userId)?.items ?? []);
    setSubscription(ui.peekSubscription(userId)?.subscription ?? null);
  }, [userId]);
  useEffect(() => {
    const refresh = () => setReload((value) => value + 1);
    window.addEventListener("signalgen:subscription", refresh);
    return () => window.removeEventListener("signalgen:subscription", refresh);
  }, []);
  useEffect(() => {
    if (!authenticated || !backendOnline) return;
    let active = true;
    setPending({
      account: true,
      rules: true,
      universes: true,
      subscription: true,
    });
    setError(false);
    // Publish each response immediately; an unrelated slow read must not hold the dashboard.
    async function load<T>(
      key: keyof typeof pending,
      request: Promise<T>,
      apply: (value: T) => void,
    ) {
      try {
        const value = await request;
        if (active) apply(value);
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setPending((current) => ({ ...current, [key]: false }));
      }
    }
    void load("account", api.account(), setAccount);
    void load("rules", ui.listRules(userId, reload > 0), (response) =>
      setRules(response.items),
    );
    void load(
      "universes",
      ui.listStockUniverses(userId, reload > 0),
      (response) => setUniverses(response.items),
    );
    void load(
      "subscription",
      ui.currentSubscription(userId, reload > 0),
      (response) => setSubscription(response.subscription),
    );
    return () => {
      active = false;
    };
  }, [authenticated, backendOnline, userId, reload]);
  const setup = screeningSetup(account, rules, universes);
  const ready = setup.ready;
  const latest = history[0];
  const preparing =
    !ready && (pending.account || pending.rules || pending.universes);
  function continueScreen(item?: MonitorRun) {
    if (userId && (item?.context || (setup.rule && setup.universe)))
      saveScreenerPreferences(userId, {
        ...readScreenerPreferences(userId),
        ruleId: item?.context?.ruleId ?? setup.rule!.id,
        universeId: item?.context?.universeId ?? setup.universe!.id,
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
  if (
    Object.values(pending).every(Boolean) &&
    !account &&
    !rules.length &&
    !universes.length &&
    !subscription
  )
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
              {preparing
                ? "Loading your workspace"
                : ready
                  ? !workspaceReady
                    ? "Your analysis workspace"
                    : latest
                      ? "Continue your analysis"
                      : "Ready for your first screening"
                  : !account
                    ? "Your access could not be checked"
                    : "Start your first screening"}
            </h3>
            <p>
              {preparing
                ? "Available account data appears as it loads."
                : ready
                  ? latest
                    ? "Use your last selection or adjust it before screening."
                    : "Choose a rule and stock universe, then review the results and evidence."
                  : !account
                    ? "Try reloading your workspace. A connection problem does not change your plan."
                    : account.access?.screening.system_rules_only
                      ? "Free access starts automatically. Choose up to three stocks, then screen with the system rule and daily candles."
                      : "You need screener access, a rule, and a stock universe to run an analysis."}
            </p>
            {latest && (
              <div
                className="overview-last-screen"
                aria-label="Latest screening summary"
              >
                <p>
                  Last screen · {latest.run.manifest.market} ·{" "}
                  {new Date(latest.recordedAt).toLocaleString("en-GB", {
                    timeZone: SINGAPORE_TIME_ZONE,
                  })}
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
            className="workspace-glass-action overview-open-screener"
            disabled={preparing}
            onClick={() =>
              !account
                ? setReload((value) => value + 1)
                : ready
                  ? continueScreen()
                  : go(setup.view)
            }
          >
            <SearchCheck data-icon="inline-start" />
            {preparing
              ? "Loading analysis options…"
              : !account
                ? "Reload workspace"
                : setup.label}
          </Button>
        </section>
        <nav className="overview-shortcuts" aria-label="Quick access">
          <h3>Follow the market</h3>
          <SpotlightCard onClick={() => go("realtime")}>
            <Activity aria-hidden="true" />
            <span>
              <strong>Market monitor</strong>
              <small>Charts and prices for your watchlist</small>
            </span>
            <ArrowUpRight aria-hidden="true" />
          </SpotlightCard>
          <SpotlightCard onClick={() => go("news")}>
            <Newspaper aria-hidden="true" />
            <span>
              <strong>News & videos</strong>
              <small>Company updates and market news</small>
            </span>
            <ArrowUpRight aria-hidden="true" />
          </SpotlightCard>
        </nav>
      </div>
      {userId && <PortfolioOverview key={userId} userId={userId} />}
      <section
        className="overview-resources overview-bento"
        aria-label="Workspace overview"
      >
        <MagicBento
          columns={4}
          rowHeight={180}
          gap={12}
          radius={12}
          theme={light ? "light" : "dark"}
          disableAnimations={reduced}
          intro={false}
          enableTilt={false}
          enableMagnetism={false}
          enableStars={false}
          clickEffect={false}
          textAutoHide={false}
          glowColor="#45e69f"
          items={(
            [
              {
                view: "rules",
                icon: ListChecks,
                label: "Rules",
                value:
                  pending.rules && !rules.length ? "Loading…" : rules.length,
                action: "Manage rules",
              },
              {
                view: "universes",
                icon: Boxes,
                label: "Stock universes",
                value:
                  pending.universes && !universes.length
                    ? "Loading…"
                    : universes.length,
                action: "Manage universes",
              },
              {
                view: "subscription",
                icon: Crown,
                label: "Plan",
                value: account?.access
                  ? tierName(account.access.plan_code)
                  : (subscription?.plan_name ??
                    (pending.account || pending.subscription
                      ? "Loading…"
                      : account
                        ? "Free"
                        : "—")),
                action: "View plan",
              },
              {
                view: "access",
                icon: UserRound,
                label: "Account",
                value:
                  account?.user.status === "active"
                    ? "Active"
                    : (account?.user.status ??
                      (pending.account ? "Loading…" : "—")),
                action: "View account",
              },
            ] as const
          ).map(({ icon: Icon, ...resource }) => ({
            id: resource.view,
            content: (
              <a
                className="feature-gallery__item"
                href={`#app/${resource.view}`}
                key={resource.view}
              >
                <div className="feature-gallery__figure overview-resources__icon">
                  <Icon aria-hidden="true" strokeWidth={1.25} />
                </div>
                <div className="feature-gallery__copy">
                  <strong>{resource.label}</strong>
                  <p className="overview-resources__value">
                    {typeof resource.value === "number" ? (
                      <CountUp to={resource.value} />
                    ) : (
                      resource.value
                    )}
                  </p>
                  <span>
                    {resource.action} <ArrowUpRight aria-hidden="true" />
                  </span>
                </div>
              </a>
            ),
          }))}
        />
      </section>
      {!latest && !preparing && account && (
        <section
          className="overview-activity"
          aria-labelledby="onboarding-title"
        >
          <header>
            <h3 id="onboarding-title">
              <ListChecks aria-hidden="true" />
              First screening
            </h3>
          </header>
          <ol className="onboarding-steps" aria-label="First screening steps">
            {[
              {
                title: "Check your access",
                done: setup.allowed,
                detail: account.access
                  ? `${tierName(account.access.plan_code)} plan`
                  : "View Plan & access",
                view: "subscription",
              },
              {
                title: "Choose a rule",
                done: Boolean(setup.rule),
                detail: account.access?.screening.system_rules_only
                  ? "System rule included; no need to create one"
                  : "Use a system rule or save your own",
                view: "rules",
              },
              {
                title: "Choose your stocks",
                done: Boolean(setup.universe),
                detail:
                  setup.universe?.name ??
                  `Save a universe with up to ${account.access?.screening.max_symbols ?? 10} stocks`,
                view: "universes",
              },
              {
                title: "Run your first screen",
                done: false,
                detail: "Review matches and the reasons behind them",
                view: "analysis",
              },
            ].map((step, index) => (
              <li
                key={step.view}
                data-complete={step.done || undefined}
                aria-current={setup.view === step.view ? "step" : undefined}
              >
                <span className="onboarding-steps__number" aria-hidden="true">
                  {step.done ? "✓" : index + 1}
                </span>
                <a href={`#app/${step.view}`}>
                  <strong>{step.title}</strong>
                  <small>{step.detail}</small>
                </a>
                <span className="sr-only">
                  {step.done ? "Ready" : "Not completed"}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
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
                      timeZone: SINGAPORE_TIME_ZONE,
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
        ) : !workspaceReady ? (
          <div className="overview-activity__empty" role="status">
            <p>Loading recent screening…</p>
          </div>
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
