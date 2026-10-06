import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  BadgeCheck,
  Boxes,
  KeyRound,
  ListChecks,
  SearchCheck,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  AccountState,
  RuleResource,
  StockUniverse,
  Subscription,
} from "@/types";

type Props = {
  authenticated: boolean;
  backendOnline: boolean;
  go: (
    view: "analysis" | "rules" | "universes" | "access" | "subscription",
  ) => void;
};

export function WorkspaceOverviewPanel({
  authenticated,
  backendOnline,
  go,
}: Props) {
  const [account, setAccount] = useState<AccountState | null>(null);
  const [rules, setRules] = useState<RuleResource[]>([]);
  const [universes, setUniverses] = useState<StockUniverse[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authenticated || !backendOnline) return;
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      api.account(),
      api.listRules(),
      api.listStockUniverses(),
      api.currentSubscription(),
    ])
      .then(
        ([
          accountResponse,
          ruleResponse,
          universeResponse,
          subscriptionResponse,
        ]) => {
          if (!active) return;
          setAccount(accountResponse);
          setRules(ruleResponse.items);
          setUniverses(universeResponse.items);
          setSubscription(subscriptionResponse.subscription);
        },
      )
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Workspace summary belum dapat dimuat.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authenticated, backendOnline]);

  const readyToScreen =
    Boolean(account?.features.includes("screener")) &&
    rules.length > 0 &&
    universes.length > 0;

  if (!authenticated || !backendOnline) {
    return (
      <section className="overview-connect">
        <span>
          <KeyRound />
        </span>
        <div>
          <p>Workspace connection</p>
          <h3>
            {backendOnline
              ? "Sign in to load your workspace"
              : "Go API is offline"}
          </h3>
          <p>
            {backendOnline
              ? "Your rules, stock universes, sessions, and plan are account-scoped."
              : "Start the backend before opening protected workspace resources."}
          </p>
        </div>
        {backendOnline && (
          <Button nativeButton={false} render={<a href="#login" />}>
            Sign in
          </Button>
        )}
      </section>
    );
  }

  if (loading) {
    return (
      <div
        className="connected-overview dashboard-skeleton"
        role="status"
        aria-label="Loading dashboard"
        aria-busy="true"
      >
        <section className="connected-overview__lead" aria-hidden="true">
          <div className="dashboard-skeleton__intro">
            <Skeleton className="dashboard-skeleton__title" />
            <Skeleton className="dashboard-skeleton__line" />
            <Skeleton className="dashboard-skeleton__line dashboard-skeleton__line--short" />
          </div>
          <div className="connected-overview__readiness">
            <Skeleton className="dashboard-skeleton__line" />
            <Skeleton className="dashboard-skeleton__value" />
            <Skeleton className="dashboard-skeleton__action" />
          </div>
        </section>
        <section
          className="connected-overview__metrics dashboard-skeleton__metrics"
          aria-hidden="true"
        >
          {[0, 1, 2, 3].map((item) => (
            <div key={item}>
              <Skeleton className="dashboard-skeleton__line" />
              <Skeleton className="dashboard-skeleton__value" />
              <Skeleton className="dashboard-skeleton__line dashboard-skeleton__line--short" />
            </div>
          ))}
        </section>
      </div>
    );
  }

  return (
    <div className="connected-overview">
      <section className="connected-overview__lead">
        <div>
          <Badge variant="outline">Connected workspace</Badge>
          <h2>Everything needed for the next screen.</h2>
          <p>
            Rules define the logic. Stock universes define the scope. Signalgen
            keeps the evidence attached to every result.
          </p>
        </div>
        <div className="connected-overview__readiness">
          <span>Screening readiness</span>
          <strong>{readyToScreen ? "Ready" : "Setup required"}</strong>
          <small>
            {readyToScreen
              ? `${rules.length} rules · ${universes.length} universes · server access active`
              : "Create a rule and universe, then verify screener access."}
          </small>
          <Button onClick={() => go(readyToScreen ? "analysis" : "rules")}>
            {readyToScreen ? "Open screener" : "Continue setup"}
            <ArrowUpRight data-icon="inline-end" />
          </Button>
        </div>
      </section>

      {loading ? (
        <div className="connected-overview__loading">
          <Skeleton />
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : (
        <section className="connected-overview__metrics">
          <button onClick={() => go("rules")}>
            <span>
              <ListChecks /> Screening rules
            </span>
            <strong>{rules.length}</strong>
            <small>
              {rules.filter((rule) => rule.owner_type === "user").length}{" "}
              private rules
            </small>
          </button>
          <button onClick={() => go("universes")}>
            <span>
              <Boxes /> Stock universes
            </span>
            <strong>{universes.length}</strong>
            <small>
              {universes.reduce(
                (count, universe) => count + universe.symbols.length,
                0,
              )}{" "}
              scoped instruments
            </small>
          </button>
          <button onClick={() => go("subscription")}>
            <span>
              <BadgeCheck /> Plan & access
            </span>
            <strong>{subscription?.plan_name ?? "No plan"}</strong>
            <small>{account?.features.length ?? 0} server capabilities</small>
          </button>
          <button onClick={() => go("access")}>
            <span>
              <ShieldCheck /> Account status
            </span>
            <strong>{account?.user.status ?? "—"}</strong>
            <small>{account?.user.role ?? "user"} role</small>
          </button>
        </section>
      )}

      <section className="connected-overview__flow">
        <header>
          <div>
            <span>Workspace flow</span>
            <h3>From scope to evidence</h3>
          </div>
          <SearchCheck />
        </header>
        <div>
          <button onClick={() => go("rules")}>
            <em>01</em>
            <strong>Define the rule</strong>
            <span>Use readable indicator conditions.</span>
          </button>
          <button onClick={() => go("universes")}>
            <em>02</em>
            <strong>Choose the universe</strong>
            <span>Group one to three IDX instruments.</span>
          </button>
          <button onClick={() => go("analysis")}>
            <em>03</em>
            <strong>Run and review</strong>
            <span>Inspect decisions, indicators, and dataset provenance.</span>
          </button>
        </div>
      </section>

      {error && <p className="connected-overview__error">{error}</p>}
    </div>
  );
}
