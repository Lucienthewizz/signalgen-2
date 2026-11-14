import AnimatedContent from "@/components/react-bits/AnimatedContent";
import AnimatedList from "@/components/react-bits/AnimatedList";
import { tierAccess, tierName, monthlyPrice } from "@/lib/tier-access";
import type { AccountState } from "@/types";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ResourceQuota } from "@/components/resource-quota";
import { InfoDialog } from "@/components/ui/info-dialog";
import { StockCatalogPicker } from "@/components/stock-catalog-picker";
import { universeSelectionLimit } from "@/lib/stock-catalog";
import { marketLabels, stockMarket, symbolMarket } from "@/lib/stock-market";
import type { StockMarket } from "@/types";
import {
  BadgeCheck,
  Boxes,
  CalendarClock,
  ChartNoAxesCombined,
  ChevronDown,
  Check,
  CircleAlert,
  Compass,
  Database,
  KeyRound,
  Layers3,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  SearchCheck,
  History,
  ShieldCheck,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { api, ApiError, ui } from "@/api/client";
import { subscriptionState } from "@/lib/workspace-feedback";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast, useActionNotifications } from "@/components/ui/toast";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/date-input";
import { SINGAPORE_TIME_ZONE, singaporeToUTC } from "@/lib/calendar";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type {
  AccountRole,
  FeatureGrant,
  StockInstrument,
  StockUniverse,
  SubscriptionPlan,
} from "@/types";

type ConnectionProps = {
  authenticated: boolean;
  backendOnline: boolean;
};

function readableError(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.code === "VERSION_CONFLICT")
    return "This data changed in another session. Reload and try again.";
  return error instanceof Error ? error.message : fallback;
}

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: SINGAPORE_TIME_ZONE,
  }).format(date);
}

export function StockUniversesPanel({
  authenticated,
  backendOnline,
  userId,
}: ConnectionProps & { userId?: string }) {
  const [account, setAccount] = useState<AccountState | null>(null);
  const policy = tierAccess(account);
  const selectionLimit =
    policy?.screening.max_symbols ?? universeSelectionLimit;
  const [catalog, setCatalog] = useState<StockInstrument[]>(
    () => ui.peekStocks(userId)?.items ?? [],
  );
  const [market, setMarket] = useState<StockMarket>("IDX");
  const marketCatalog = useMemo(
    () => catalog.filter((stock) => stockMarket(stock) === market),
    [catalog, market],
  );
  const [universes, setUniverses] = useState<StockUniverse[]>(
    () => ui.peekUniverses(userId)?.items ?? [],
  );
  const [allUniversesOpen, setAllUniversesOpen] = useState(false);
  const libraryReturnFocus = useRef<HTMLElement | null>(null);
  const [editing, setEditing] = useState<StockUniverse | null>(null);
  const [name, setName] = useState("");
  const [symbols, setSymbols] = useState<StockInstrument["symbol"][]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useActionNotifications(notice, error);

  const activeOwner = useRef(userId);
  activeOwner.current = authenticated ? userId : undefined;
  async function load(refresh = true) {
    if (!authenticated || !backendOnline) return;
    setLoading(true);
    setError(null);
    try {
      const [stocks, groups, ownAccount] = await Promise.all([
        ui.listStocks(userId, refresh),
        ui.listStockUniverses(userId, refresh),
        api.account(),
      ]);
      if (activeOwner.current !== userId || ownAccount.user.id !== userId)
        return;
      setAccount(ownAccount);
      setCatalog(stocks.items);
      setUniverses(groups.items);
    } catch {
      if (activeOwner.current !== userId) return;
      setError(
        "Stock universes could not be loaded. Check your connection and try Refresh.",
      );
    } finally {
      if (activeOwner.current === userId) setLoading(false);
    }
  }

  useEffect(() => {
    setAccount(null);
    setUniverses(ui.peekUniverses(userId)?.items ?? []);
    setEditing(null);
    setName("");
    setSymbols([]);
    void load(false);
  }, [authenticated, backendOnline, userId]);

  function resetEditor() {
    setEditing(null);
    setName("");
    setSymbols([]);
    setError(null);
    setNotice(null);
  }

  function edit(universe: StockUniverse, focusEditor = true) {
    setMarket(symbolMarket(universe.symbols[0] ?? "BBCA.JK"));
    setEditing(universe);
    setName(universe.name);
    setSymbols([...universe.symbols]);
    setError(null);
    setNotice(null);
    if (focusEditor) document.getElementById("universe-name")?.focus();
  }

  // The keyed catalog remounts when editing another universe. Resolve the new
  // input before the directory returns focus, rather than retaining a detached node.
  useEffect(() => {
    if (libraryReturnFocus.current?.id === "universe-name")
      libraryReturnFocus.current = document.getElementById("universe-name");
  }, [editing?.id, market]);

  function toggleSymbol(symbol: StockInstrument["symbol"]) {
    if (!marketCatalog.some((stock) => stock.symbol === symbol)) return;
    setSymbols((current) =>
      current.includes(symbol)
        ? current.filter((item) => item !== symbol)
        : current.length < selectionLimit
          ? [...current, symbol]
          : current,
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || symbols.length === 0) {
      setError("Enter a name and select at least one stock.");
      return;
    }
    if (!policy) {
      setError("Checking your plan. Please retry shortly.");
      return;
    }
    if (
      symbols.length > selectionLimit ||
      (!editing && universes.length >= policy.limits.stock_universes)
    ) {
      setError(
        "Plan limit reached. Edit an existing universe, reduce the stock selection, or view plans.",
      );
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (editing) {
        await api.updateStockUniverse(
          editing.id,
          editing.version,
          name.trim(),
          symbols,
        );
        setNotice("Stock universe updated.");
      } else {
        await api.createStockUniverse(name.trim(), symbols);
        setNotice("Stock universe created and ready for screening.");
      }
      setEditing(null);
      setName("");
      setSymbols([]);
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === "VERSION_CONFLICT"
          ? "This universe changed in another session. Refresh and try again."
          : caught instanceof Error
            ? caught.message
            : "Stock universe could not be saved. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove(universe: StockUniverse) {
    if (!window.confirm(`Delete “${universe.name}”?`)) return;
    setError(null);
    setNotice(null);
    try {
      await api.deleteStockUniverse(universe.id, universe.version);
      if (editing?.id === universe.id) resetEditor();
      await load();
      setNotice("Stock universe deleted.");
    } catch {
      setError("Stock universe could not be deleted. Refresh and try again.");
    }
  }

  if (!authenticated || !backendOnline) {
    return (
      <Empty className="workspace-empty-state">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <KeyRound />
          </EmptyMedia>
          <EmptyTitle>Connect your account to manage universes</EmptyTitle>
          <EmptyDescription>
            {!backendOnline
              ? "The service is unavailable. Check your connection and reload."
              : "Sign in to create and manage your stock universes."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {backendOnline && (
            <Button nativeButton={false} render={<a href="#login" />}>
              Sign in
            </Button>
          )}
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="universe-workspace">
      <AnimatedContent
        as="form"
        animationKey={`${editing?.id ?? "new"}:${market}`}
        onSubmit={save}
        className="universe-editor universe-form"
        aria-labelledby="universe-editor-title"
      >
        <StockCatalogPicker
          key={`${editing?.id ?? "new"}:${market}`}
          catalog={marketCatalog}
          selected={symbols}
          selectionLimit={selectionLimit}
          loading={loading && catalog.length === 0}
          disabled={saving}
          onToggle={toggleSymbol}
          header={
            <>
              <div className="universe-window-bar">
                <span className="news-window-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span>Stock universe</span>
                <span>
                  {market} · {market === "IDX" ? "IDR" : "USD"}
                </span>
              </div>
              <header className="universe-section-heading">
                <div>
                  <h3 id="universe-editor-title">
                    {editing ? "Edit stock universe" : "Build a stock universe"}
                  </h3>
                  <p>
                    Select up to {selectionLimit} {market} stocks for your next
                    screening.
                  </p>
                </div>
                <ResourceQuota
                  kind="stock_universes"
                  revision={universes.length}
                />
              </header>
              <Field className="universe-market-field">
                <FieldLabel id="universe-market-label">Stock market</FieldLabel>
                <ToggleGroup
                  aria-labelledby="universe-market-label"
                  value={[market]}
                  disabled={saving}
                  variant="outline"
                  onValueChange={(values) => {
                    const next = values[0] as StockMarket | undefined;
                    if (!next || next === market) return;
                    if (
                      symbols.length &&
                      !window.confirm(
                        "Switch market and clear the selected stocks?",
                      )
                    )
                      return;
                    setMarket(next);
                    setSymbols([]);
                    setEditing(null);
                    setError(null);
                    setNotice(null);
                  }}
                >
                  <ToggleGroupItem value="IDX">Indonesia · IDR</ToggleGroupItem>
                  <ToggleGroupItem value="US">
                    United States · USD
                  </ToggleGroupItem>
                </ToggleGroup>
                <FieldDescription>
                  {marketLabels[market]}. Each universe uses one market and
                  currency.
                </FieldDescription>
              </Field>
            </>
          }
        >
          <div className="universe-form__save">
            <FieldGroup>
              <Field
                data-invalid={Boolean(error && !name.trim())}
                data-disabled={saving}
              >
                <FieldLabel htmlFor="universe-name">Universe name</FieldLabel>
                <Input
                  id="universe-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Banking watchlist"
                  maxLength={100}
                  disabled={saving}
                  aria-invalid={Boolean(error && !name.trim())}
                />
              </Field>
            </FieldGroup>
            <div className="universe-form__actions">
              {editing && (
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={resetEditor}
                >
                  Cancel
                </Button>
              )}
              <Button
                type="submit"
                disabled={
                  loading || saving || !name.trim() || symbols.length === 0
                }
              >
                {saving ? (
                  <LoaderCircle
                    data-icon="inline-start"
                    className="is-spinning"
                  />
                ) : editing ? (
                  <Pencil data-icon="inline-start" />
                ) : (
                  <Plus data-icon="inline-start" />
                )}
                {saving
                  ? "Saving…"
                  : editing
                    ? "Save changes"
                    : "Create universe"}
              </Button>
            </div>
          </div>
          {error && <FieldError>{error}</FieldError>}
        </StockCatalogPicker>
      </AnimatedContent>

      <section
        className="universe-library"
        aria-labelledby="universe-library-title"
      >
        <header className="universe-section-heading">
          <div className="universe-library__heading">
            <h3 id="universe-library-title">Your stock universes</h3>
            <Badge variant="outline">{universes.length} saved</Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void load()}
            disabled={loading || saving}
          >
            <RefreshCw
              data-icon="inline-start"
              className={loading ? "is-spinning" : ""}
            />
            Refresh
          </Button>
        </header>
        {loading && universes.length === 0 ? (
          <div
            className="resource-loading"
            aria-label="Loading stock universes"
          >
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ) : universes.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Layers3 />
              </EmptyMedia>
              <EmptyTitle>No stock universes yet</EmptyTitle>
              <EmptyDescription>
                Select stocks above and give your first universe a name.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <AnimatedList as="div" className="universe-library__rows">
            {universes.slice(0, 2).map((universe) => (
              <article
                key={universe.id}
                data-editing={editing?.id === universe.id || undefined}
              >
                <div className="universe-library__identity">
                  <div>
                    <strong>{universe.name}</strong>
                    <small>
                      {universe.symbols.length} stocks · Updated{" "}
                      {formatDate(universe.updated_at)}
                    </small>
                  </div>
                </div>
                <div className="universe-library__symbols">
                  {universe.symbols.slice(0, 4).map((symbol) => (
                    <Badge key={symbol} variant="outline">
                      {symbol.replace(".JK", "")}
                    </Badge>
                  ))}
                  {universe.symbols.length > 4 && (
                    <Badge variant="outline">
                      +{universe.symbols.length - 4} more
                    </Badge>
                  )}
                </div>
                <div className="universe-library__actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => edit(universe)}
                    disabled={saving || loading}
                    aria-label={`Edit ${universe.name}`}
                  >
                    <Pencil data-icon="inline-start" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void remove(universe)}
                    disabled={saving || loading}
                    aria-label={`Delete ${universe.name}`}
                    className="workspace-row-delete"
                    data-destructive="true"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </article>
            ))}
          </AnimatedList>
        )}
        {universes.length > 2 && (
          <Button
            className="universe-library__more"
            variant="outline"
            size="sm"
            onClick={(event) => {
              libraryReturnFocus.current = event.currentTarget;
              setAllUniversesOpen(true);
            }}
          >
            See all stock universes ({universes.length})
          </Button>
        )}
      </section>
      <InfoDialog
        open={allUniversesOpen}
        onOpenChange={setAllUniversesOpen}
        title="Your stock universes"
        description={`${universes.length} saved universes. Choose Edit to update a selection.`}
        returnFocus={libraryReturnFocus}
        wide
      >
        <ul className="universe-directory">
          {universes.map((universe) => (
            <li key={universe.id}>
              <div className="universe-directory__identity">
                <strong>{universe.name}</strong>
                <small>
                  {universe.symbols.length} stocks ·{" "}
                  {symbolMarket(universe.symbols[0] ?? "BBCA.JK")} · Updated{" "}
                  {formatDate(universe.updated_at)}
                </small>
              </div>
              <div
                className="universe-directory__symbols"
                aria-label={`Stocks in ${universe.name}`}
              >
                {universe.symbols.map((symbol) => (
                  <Badge key={symbol} variant="outline">
                    {symbol.replace(/\.JK$/, "")}
                  </Badge>
                ))}
              </div>
              <div className="universe-directory__actions">
                <Button
                  variant="ghost"
                  size="sm"
                  className="workspace-glass-action"
                  aria-label={`Edit ${universe.name}`}
                  disabled={loading || saving}
                  onClick={() => {
                    libraryReturnFocus.current =
                      document.getElementById("universe-name");
                    setAllUniversesOpen(false);
                    edit(universe, false);
                  }}
                >
                  <Pencil data-icon="inline-start" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="workspace-glass-action"
                  data-destructive="true"
                  aria-label={`Delete ${universe.name}`}
                  disabled={loading || saving}
                  onClick={() => void remove(universe)}
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </InfoDialog>
    </div>
  );
}

export function SubscriptionPanel({
  authenticated,
  backendOnline,
  userId,
}: ConnectionProps & { userId?: string }) {
  const owner = authenticated ? userId : undefined;
  const [snapshot, setSnapshot] = useState(() => ui.peekSubscription(owner));
  const subscription = authenticated ? snapshot?.subscription : undefined;
  const effective = authenticated ? snapshot?.access : undefined;
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(
    null,
  );
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const access = subscription ? subscriptionState(subscription) : null;
  const currentPlanCode =
    authenticated && (effective || subscription)
      ? (effective?.plan_code ??
        (access?.usable ? subscription?.plan_code : "free"))
      : undefined;
  const active = useRef(false);
  const loadVersion = useRef(0);

  async function load(refresh = false, includePlans = false) {
    const version = ++loadVersion.current;
    const current = () => active.current && version === loadVersion.current;
    setLoading(true);
    try {
      if (includePlans) {
        setError(null);
        void api
          .listSubscriptionPlans()
          .then((response) => {
            if (current()) setPlans(response.items);
          })
          .catch((caught) => {
            if (current())
              setError(
                readableError(caught, "Plan options could not be loaded."),
              );
          });
      }
      if (authenticated && backendOnline) {
        const response = await ui.currentSubscription(owner, refresh);
        if (current()) {
          setSnapshot(response);
          setAccountError(null);
        }
      } else if (authenticated) {
        setAccountError(
          "The server is unavailable. Your plan status could not be checked.",
        );
      }
    } catch (caught) {
      if (current())
        setAccountError(
          readableError(caught, "Plan status could not be loaded."),
        );
    } finally {
      if (current()) setLoading(false);
    }
  }

  useEffect(() => {
    active.current = true;
    void load(false, true);
    const refresh = () => void load(true, true);
    window.addEventListener("signalgen:subscription", refresh);
    return () => {
      active.current = false;
      ++loadVersion.current;
      window.removeEventListener("signalgen:subscription", refresh);
    };
  }, [authenticated, backendOnline, owner]);

  async function cancel(atPeriodEnd: boolean) {
    if (!subscription || accountError || loading) return;
    const question = atPeriodEnd
      ? "Schedule cancellation at the end of this period?"
      : "Cancel your subscription now? Access may end immediately.";
    if (!window.confirm(question)) return;
    setSaving(true);
    setError(null);
    try {
      const response = await api.cancelSubscription(
        atPeriodEnd,
        atPeriodEnd
          ? "user scheduled cancellation"
          : "user canceled immediately",
      );
      setSnapshot({ subscription: response.subscription });
      toast.add({
        type: "success",
        title: "Plan updated",
        description: atPeriodEnd
          ? "Cancellation scheduled for the end of this period."
          : "Subscription cancelled.",
        timeout: 5000,
      });
      dispatchEvent(new Event("signalgen:subscription"));
    } catch (caught) {
      const message = readableError(
        caught,
        "Subscription could not be cancelled.",
      );
      setError(message);
      toast.add({
        type: "error",
        title: "Cancellation failed",
        description: message,
        priority: "high",
        timeout: 8000,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="subscription-workspace subscription-workspace--simple">
      <section className="subscription-current">
        <header className="resource-editor__header">
          <h3>Your plan</h3>
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void load(true, true)}
          >
            <RefreshCw aria-hidden="true" /> Refresh status
          </Button>
        </header>
        {loading && !currentPlanCode ? (
          <div className="resource-loading">
            <Skeleton />
            <Skeleton />
          </div>
        ) : authenticated && !currentPlanCode ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Plan status unavailable</AlertTitle>
            <AlertDescription>
              {accountError ??
                "Your access could not be confirmed. Refresh to try again."}
            </AlertDescription>
            <Button variant="outline" onClick={() => void load(true, true)}>
              <RefreshCw data-icon="inline-start" />
              Try again
            </Button>
          </Alert>
        ) : authenticated ? (
          <div className="subscription-ledger">
            {accountError && (
              <Alert>
                <CircleAlert />
                <AlertTitle>Showing last verified plan</AlertTitle>
                <AlertDescription>
                  {accountError} Refresh status to check for changes.
                </AlertDescription>
              </Alert>
            )}
            <div className="subscription-ledger__lead">
              <div className="subscription-plan-name">
                <Layers3 aria-hidden="true" />
                <h4>
                  {currentPlanCode === "free" && (accountError || loading)
                    ? "Free"
                    : currentPlanCode && currentPlanCode !== "free"
                      ? tierName(currentPlanCode)
                      : "Free access is active"}
                </h4>
                {currentPlanCode && currentPlanCode !== "free" && (
                  <Badge variant="secondary">
                    {accountError
                      ? "Last verified"
                      : loading
                        ? "Checking"
                        : "Active"}
                  </Badge>
                )}
              </div>
              {subscription && (
                <p className="subscription-expiry">
                  {access?.usable
                    ? "Active until"
                    : access?.label === "Canceled"
                      ? "Cancelled"
                      : "Period ended"}
                  <strong>{formatDate(subscription.current_period_end)}</strong>
                  {subscription.cancel_at_period_end && access?.usable && (
                    <small>Ends after this period</small>
                  )}
                </p>
              )}
            </div>
            {effective?.source === "manual_grant" ? (
              <p>
                An operator grant is active. Your subscription stays separate.
              </p>
            ) : currentPlanCode === "free" ? (
              <p>
                Screen up to {effective?.screening.max_symbols ?? 3} stocks with
                the system rule and daily candles. No payment required.
              </p>
            ) : null}
            {subscription && !access?.usable && (
              <p>Your saved data is available under your current access.</p>
            )}
            <div
              className="subscription-feature-grid"
              aria-label="Your plan access"
            >
              {[
                {
                  code: "screener",
                  name: "Market screener",
                  description: "Find stocks that match your rule.",
                  icon: SearchCheck,
                },
                {
                  code: "backtest",
                  name: "Backtest access",
                  description:
                    "Test daily rules and manual entries with historical data.",
                  icon: History,
                },
              ].map(({ code, name, description, icon: Icon }) => {
                const included = (
                  effective?.features ??
                  (access?.usable ? subscription?.features : undefined) ??
                  []
                ).some((feature) => feature === code);
                return (
                  <Card
                    key={code}
                    data-access={included ? "included" : "excluded"}
                  >
                    <CardHeader>
                      <CardTitle>
                        <Icon aria-hidden="true" />
                        {name}
                      </CardTitle>
                      <CardAction>
                        <Badge variant={included ? "secondary" : "outline"}>
                          {included ? "Active" : "Not included"}
                        </Badge>
                      </CardAction>
                    </CardHeader>
                    <CardContent>
                      <p>{description}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <section
              className="subscription-usage"
              aria-labelledby="subscription-usage-title"
            >
              <h4 id="subscription-usage-title">Quota usage</h4>
              <ResourceQuota
                revision={
                  subscription?.updated_at
                    ? Date.parse(subscription.updated_at)
                    : 0
                }
              />
            </section>
            {subscription && access?.usable && !accountError && !loading && (
              <details className="subscription-manage subscription-manage--account">
                <summary>
                  <span>
                    <strong>Manage plan</strong>
                    <small>
                      View your active period and cancellation options
                    </small>
                  </span>
                  <ChevronDown aria-hidden="true" />
                </summary>
                <p>
                  Started {formatDate(subscription.current_period_start)} ·{" "}
                  {subscription.source === "manual"
                    ? "Activated by an operator. No automatic payments."
                    : "Payments are managed by the provider."}
                </p>
                <p>
                  The access above comes from your plan. Additional operator
                  grants remain subject to their own settings.
                </p>
                {!subscription.cancel_at_period_end &&
                  subscription.status === "active" && (
                    <div className="subscription-actions">
                      <Button
                        variant="outline"
                        disabled={saving}
                        onClick={() => void cancel(true)}
                      >
                        <CalendarClock data-icon="inline-start" /> Cancel at
                        period end
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={saving}
                        onClick={() => void cancel(false)}
                      >
                        <X data-icon="inline-start" /> Cancel now
                      </Button>
                    </div>
                  )}
              </details>
            )}
            {currentPlanCode === "free" && (
              <Button
                variant="outline"
                nativeButton={false}
                render={<a href="#app/overview" />}
              >
                Continue to dashboard
              </Button>
            )}
          </div>
        ) : (
          <Empty className="subscription-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <KeyRound />
              </EmptyMedia>
              <EmptyTitle role="heading" aria-level={4}>
                Sign in to view your plan
              </EmptyTitle>
              <EmptyDescription>
                Compare plans below or sign in to check your access.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button nativeButton={false} render={<a href="#login" />}>
                <KeyRound data-icon="inline-start" /> Sign in
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </section>

      <InfoDialog
        open={selectedPlan !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedPlan(null);
        }}
        title={`${selectedPlan?.name ?? ""} plan details`}
        description="Paid plans are activated by an operator. Online upgrades are coming soon."
      >
        <p>
          <strong>{selectedPlan?.name}</strong>
          {selectedPlan?.pricing
            ? ` · ${monthlyPrice(selectedPlan.pricing.amount)} per month`
            : ""}
          {selectedPlan?.screening && (
            <> · Up to {selectedPlan.screening.max_symbols} stocks per screen</>
          )}
        </p>
        <Button
          nativeButton={false}
          render={<a href={authenticated ? "#app/overview" : "#register"} />}
        >
          {authenticated ? "Continue to dashboard" : "Start with Free"}
        </Button>
      </InfoDialog>
      <section className="plan-ledger" aria-labelledby="plan-heading">
        <header>
          <div>
            <h3 id="plan-heading">Available plans</h3>
            <p>Choose the capacity that fits your analysis.</p>
          </div>
        </header>
        <div className="plan-columns">
          {[...plans]
            .sort(
              (a, b) =>
                ["free", "analyst", "pro"].indexOf(a.code) -
                ["free", "analyst", "pro"].indexOf(b.code),
            )
            .map((plan) => (
              <Card
                key={plan.code}
                className={currentPlanCode === plan.code ? "is-current" : ""}
              >
                <CardHeader>
                  <CardTitle>
                    <span className="plan-title-lockup">
                      <span className="plan-icon" aria-hidden="true">
                        {plan.code === "free" ? (
                          <Compass />
                        ) : plan.code === "analyst" ? (
                          <ChartNoAxesCombined />
                        ) : (
                          <Layers3 />
                        )}
                      </span>
                      {plan.name}
                    </span>
                  </CardTitle>
                  <CardDescription>
                    {plan.code === "free"
                      ? "Start with daily screening."
                      : plan.code === "analyst"
                        ? "For structured personal analysis."
                        : "More room for strategies and historical analysis."}
                  </CardDescription>
                  {currentPlanCode === plan.code && !accountError && (
                    <CardAction>
                      <Badge>Your plan</Badge>
                    </CardAction>
                  )}
                </CardHeader>
                <CardContent>
                  {plan.limits && (
                    <dl className="plan-capacity">
                      <div>
                        <dt>Private rules</dt>
                        <dd>
                          <strong>
                            {plan.limits.custom_rules}
                            <span className="sr-only"> private rules</span>
                          </strong>
                        </dd>
                      </div>
                      <div>
                        <dt>Stock universe</dt>
                        <dd>
                          {plan.limits.stock_universes}
                          <span className="sr-only"> stock universe</span>
                        </dd>
                      </div>
                    </dl>
                  )}
                  <ul>
                    <li
                      className={
                        plan.features.includes("screener") ? "is-included" : ""
                      }
                    >
                      {plan.features.includes("screener") ? (
                        <Check aria-hidden="true" />
                      ) : (
                        <X aria-hidden="true" />
                      )}{" "}
                      Market screener
                      {!plan.features.includes("screener") && (
                        <span className="plan-feature-status">
                          Not included
                        </span>
                      )}
                    </li>
                    <li
                      className={
                        plan.features.includes("backtest") ? "is-included" : ""
                      }
                    >
                      {plan.features.includes("backtest") ? (
                        <Check aria-hidden="true" />
                      ) : (
                        <X aria-hidden="true" />
                      )}{" "}
                      Backtest access
                      {!plan.features.includes("backtest") && (
                        <span className="plan-feature-status">
                          Preview only
                        </span>
                      )}
                    </li>
                  </ul>
                </CardContent>
                <CardFooter>
                  {plan.code === "free" ? (
                    <span>Free daily screening</span>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => setSelectedPlan(plan)}
                    >
                      View {plan.name} details
                    </Button>
                  )}
                </CardFooter>
              </Card>
            ))}
        </div>
        <Accordion className="subscription-faq">
          <AccordionItem value="plan-change">
            <AccordionTrigger>
              What happens when my plan changes?
            </AccordionTrigger>
            <AccordionContent>
              <p>
                Saved data is not deleted. If your usage exceeds your new plan's
                quota, reduce your rules or universes before creating new ones.
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Plans unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw data-icon="inline-start" /> Try again
            </Button>
          </Alert>
        )}
      </section>
    </div>
  );
}

export function OperatorPanel({
  authenticated,
  backendOnline,
}: ConnectionProps) {
  const [targetUserId, setTargetUserId] = useState("");
  const [reason, setReason] = useState("");
  const [feature, setFeature] = useState<FeatureGrant["feature"]>("screener");
  const [role, setRole] = useState<AccountRole["role"]>("user");
  const [planCode, setPlanCode] = useState<SubscriptionPlan["code"]>("analyst");
  const [validUntil, setValidUntil] = useState("");
  const [grants, setGrants] = useState<FeatureGrant[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isoDate = useMemo(() => {
    if (!validUntil) return "";
    return singaporeToUTC(validUntil);
  }, [validUntil]);

  async function execute(action: () => Promise<unknown>, success: string) {
    if (!targetUserId.trim() || !reason.trim()) {
      setError("Enter a User ID and an audit reason first.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      const response = await api.listFeatureGrants(targetUserId.trim());
      setGrants(response.items);
    } catch (caught) {
      setError(readableError(caught, "Operator changes could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  async function inspectGrants() {
    if (!targetUserId.trim()) {
      setError("Enter the User ID to inspect.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await api.listFeatureGrants(targetUserId.trim());
      setGrants(response.items);
      setMessage(`Showing ${response.items.length} grants.`);
    } catch (caught) {
      setError(readableError(caught, "Grants could not be loaded."));
    } finally {
      setBusy(false);
    }
  }

  if (!authenticated || !backendOnline) {
    return (
      <Empty className="workspace-empty-state">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldCheck />
          </EmptyMedia>
          <EmptyTitle>Operator session required</EmptyTitle>
          <EmptyDescription>
            Sign in with an operator account to manage access.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="operator-workspace">
      <section className="operator-target">
        <div className="resource-title-lockup">
          <span aria-hidden="true">
            <UsersRound />
          </span>
          <div>
            <h3>Target account</h3>
            <p>Email search is not available. Use the Supabase User ID.</p>
          </div>
        </div>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="operator-user-id">User ID</FieldLabel>
            <Input
              id="operator-user-id"
              value={targetUserId}
              onChange={(event) => setTargetUserId(event.target.value)}
              placeholder="Account UUID"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="operator-reason">Audit reason</FieldLabel>
            <Textarea
              id="operator-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why is this access changing?"
              rows={2}
            />
          </Field>
        </FieldGroup>
      </section>

      <Tabs defaultValue="grants" className="operator-tabs">
        <TabsList variant="line" aria-label="Operator tools">
          <TabsTrigger value="grants">Feature grants</TabsTrigger>
          <TabsTrigger value="subscription">Subscription</TabsTrigger>
          <TabsTrigger value="role">Account role</TabsTrigger>
        </TabsList>
        <TabsContent value="grants" className="operator-tab-panel">
          <div className="operator-control-row">
            <Field>
              <FieldLabel>Feature</FieldLabel>
              <Select
                value={feature}
                onValueChange={(value) =>
                  setFeature(value as FeatureGrant["feature"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="screener">Screener</SelectItem>
                    <SelectItem value="backtest">Backtest</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="grant-until">Valid until</FieldLabel>
              <DateInput
                id="grant-until"
                type="datetime-local"
                value={validUntil}
                onValueChange={setValidUntil}
              />
            </Field>
          </div>
          <div className="operator-actions">
            <Button
              disabled={busy || !isoDate}
              onClick={() =>
                void execute(
                  () =>
                    api.grantFeature(
                      targetUserId.trim(),
                      feature,
                      isoDate,
                      reason.trim(),
                    ),
                  `${feature} access granted.`,
                )
              }
            >
              <Plus data-icon="inline-start" /> Grant access
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void execute(
                  () =>
                    api.revokeFeature(
                      targetUserId.trim(),
                      feature,
                      reason.trim(),
                    ),
                  `${feature} access revoked.`,
                )
              }
            >
              <Trash2 data-icon="inline-start" /> Revoke
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void inspectGrants()}
            >
              <RefreshCw data-icon="inline-start" /> Inspect grants
            </Button>
          </div>
          <div className="grant-ledger">
            {grants.map((grant) => (
              <article key={`${grant.feature}-${grant.updated_at}`}>
                <div>
                  <strong>{grant.feature}</strong>
                  <small>{grant.reason}</small>
                </div>
                <div>
                  <Badge variant="outline">
                    {grant.active ? "Active" : "Inactive"}
                  </Badge>
                  <span>until {formatDate(grant.valid_until)}</span>
                </div>
              </article>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="subscription" className="operator-tab-panel">
          <div className="operator-control-row">
            <Field>
              <FieldLabel>Plan</FieldLabel>
              <Select
                value={planCode}
                onValueChange={(value) =>
                  setPlanCode(value as SubscriptionPlan["code"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="free">Free</SelectItem>
                    <SelectItem value="analyst">Analyst</SelectItem>
                    <SelectItem value="pro">Pro</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="subscription-until">Period end</FieldLabel>
              <DateInput
                id="subscription-until"
                type="datetime-local"
                value={validUntil}
                onValueChange={setValidUntil}
              />
            </Field>
          </div>
          <div className="operator-actions">
            <Button
              disabled={busy || !isoDate}
              onClick={() =>
                void execute(
                  () =>
                    api.activateSubscription(
                      targetUserId.trim(),
                      planCode,
                      isoDate,
                      reason.trim(),
                    ),
                  `${planCode} subscription activated.`,
                )
              }
            >
              <BadgeCheck data-icon="inline-start" /> Activate subscription
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="role" className="operator-tab-panel">
          <div className="operator-control-row">
            <Field>
              <FieldLabel>Application role</FieldLabel>
              <Select
                value={role}
                onValueChange={(value) => setRole(value as AccountRole["role"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="operator">Operator</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="operator-actions">
            <Button
              disabled={busy}
              onClick={() =>
                void execute(
                  () =>
                    api.changeAccountRole(
                      targetUserId.trim(),
                      role,
                      reason.trim(),
                    ),
                  `Role changed to ${role}.`,
                )
              }
            >
              <ShieldCheck data-icon="inline-start" /> Save role
            </Button>
          </div>
        </TabsContent>
      </Tabs>
      {(message || error) && (
        <Alert variant={error ? "destructive" : "default"}>
          {error ? <CircleAlert /> : <BadgeCheck />}
          <AlertTitle>
            {error ? "Changes not saved" : "Operator action complete"}
          </AlertTitle>
          <AlertDescription>{error ?? message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
