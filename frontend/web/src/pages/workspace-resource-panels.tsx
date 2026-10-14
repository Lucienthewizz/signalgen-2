import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ResourceQuota } from "@/components/resource-quota";
import { StockCatalogPicker } from "@/components/stock-catalog-picker";
import { universeSelectionLimit } from "@/lib/stock-catalog";
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
import { api, ApiError } from "@/api/client";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type {
  AccountRole,
  FeatureGrant,
  StockInstrument,
  StockUniverse,
  Subscription,
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
  }).format(date);
}

export function StockUniversesPanel({
  authenticated,
  backendOnline,
}: ConnectionProps) {
  const [catalog, setCatalog] = useState<StockInstrument[]>([]);
  const [universes, setUniverses] = useState<StockUniverse[]>([]);
  const [editing, setEditing] = useState<StockUniverse | null>(null);
  const [name, setName] = useState("");
  const [symbols, setSymbols] = useState<StockInstrument["symbol"][]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useActionNotifications(notice, error);

  async function load() {
    if (!authenticated || !backendOnline) return;
    setLoading(true);
    setError(null);
    try {
      const [stocks, groups] = await Promise.all([
        api.listStocks(),
        api.listStockUniverses(),
      ]);
      setCatalog(stocks.items);
      setUniverses(groups.items);
    } catch (caught) {
      setError(readableError(caught, "Stock universe belum dapat dimuat."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [authenticated, backendOnline]);

  function resetEditor() {
    setEditing(null);
    setName("");
    setSymbols([]);
    setError(null);
    setNotice(null);
  }

  function edit(universe: StockUniverse) {
    setEditing(universe);
    setName(universe.name);
    setSymbols([...universe.symbols]);
    setError(null);
    setNotice(null);
  }

  function toggleSymbol(symbol: StockInstrument["symbol"]) {
    setSymbols((current) =>
      current.includes(symbol)
        ? current.filter((item) => item !== symbol)
        : current.length < universeSelectionLimit
          ? [...current, symbol]
          : current,
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || symbols.length === 0) {
      setError("Isi nama dan pilih setidaknya satu saham.");
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
        setNotice("Perubahan universe tersimpan.");
      } else {
        await api.createStockUniverse(name.trim(), symbols);
        setNotice("Stock universe dibuat dan siap dipakai di screener.");
      }
      setEditing(null);
      setName("");
      setSymbols([]);
      await load();
    } catch (caught) {
      setError(readableError(caught, "Stock universe belum tersimpan."));
    } finally {
      setSaving(false);
    }
  }

  async function remove(universe: StockUniverse) {
    if (!window.confirm(`Hapus “${universe.name}”?`)) return;
    setError(null);
    setNotice(null);
    try {
      await api.deleteStockUniverse(universe.id, universe.version);
      if (editing?.id === universe.id) resetEditor();
      await load();
      setNotice("Stock universe dihapus.");
    } catch (caught) {
      setError(readableError(caught, "Stock universe belum dapat dihapus."));
    }
  }

  if (!authenticated || !backendOnline) {
    return (
      <Empty className="workspace-empty-state">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <KeyRound />
          </EmptyMedia>
          <EmptyTitle>Hubungkan akun untuk mengatur universe</EmptyTitle>
          <EmptyDescription>
            {!backendOnline
              ? "Go API belum terhubung. Jalankan backend lalu muat ulang halaman."
              : "Masuk agar universe tersimpan sebagai resource milik akun Anda."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {backendOnline && (
            <Button nativeButton={false} render={<a href="#login" />}>
              Masuk
            </Button>
          )}
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="resource-layout">
      <section
        className="resource-editor"
        aria-labelledby="universe-editor-title"
      >
        <header className="resource-editor__header">
          <div className="resource-title-lockup">
            <span aria-hidden="true">
              <Boxes />
            </span>
            <div>
              <h3 id="universe-editor-title">
                {editing ? "Edit stock universe" : "Buat stock universe"}
              </h3>
              <p>
                Pilih 1–10 saham IDX untuk satu proses screening. Pilihan 3 saham tetap bisa digunakan.
              </p>
              <ResourceQuota
                kind="stock_universes"
                revision={universes.length}
              />
            </div>
          </div>
          {editing && (
            <Button variant="ghost" onClick={resetEditor}>
              <X data-icon="inline-start" /> Batal edit
            </Button>
          )}
        </header>
        <form onSubmit={save} className="resource-form">
          <FieldGroup>
            <Field data-invalid={Boolean(error && !name.trim())}>
              <FieldLabel htmlFor="universe-name">Nama universe</FieldLabel>
              <Input
                id="universe-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Contoh: Bank pilihan"
                maxLength={100}
                aria-invalid={Boolean(error && !name.trim())}
              />
              <FieldDescription>
                Gunakan nama yang mudah dikenali saat memilih universe di
                screener.
              </FieldDescription>
            </Field>
            <FieldSet>
              <FieldLegend>Anggota universe</FieldLegend>
              <FieldDescription>
                Cari saham dari katalog IDX. Maksimal {universeSelectionLimit} saham per universe;
                ketersediaan OHLCV diperiksa ketika screening dijalankan.
              </FieldDescription>
              <StockCatalogPicker
                catalog={catalog}
                selected={symbols}
                loading={loading}
                disabled={saving}
                onToggle={toggleSymbol}
              />
            </FieldSet>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
          <div className="resource-form__actions">
            <span>{symbols.length}/{universeSelectionLimit} saham dipilih</span>
            <Button type="submit" size="lg" disabled={saving}>
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
              {editing ? "Simpan perubahan" : "Create universe"}
            </Button>
          </div>
        </form>
      </section>

      <section
        className="resource-library"
        aria-labelledby="universe-library-title"
      >
        <header className="resource-library__header">
          <div>
            <h3 id="universe-library-title">Your stock universes</h3>
            <p>Universe ini tersedia sebagai input pada market screener.</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw
              data-icon="inline-start"
              className={loading ? "is-spinning" : ""}
            />
            Muat ulang
          </Button>
        </header>
        {loading && universes.length === 0 ? (
          <div className="resource-loading" aria-label="Memuat stock universe">
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
              <EmptyTitle>Belum ada stock universe</EmptyTitle>
              <EmptyDescription>
                Pilih saham di sebelah kiri untuk membuat universe pertama.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="resource-rows">
            {universes.map((universe) => (
              <article
                key={universe.id}
                className={editing?.id === universe.id ? "is-active" : ""}
              >
                <div className="resource-row__identity">
                  <span aria-hidden="true">
                    <Database />
                  </span>
                  <div>
                    <strong>{universe.name}</strong>
                    <small>
                      Diperbarui {formatDate(universe.updated_at)} · v
                      {universe.version}
                    </small>
                  </div>
                </div>
                <div className="resource-row__symbols">
                  {universe.symbols.map((symbol) => (
                    <Badge key={symbol} variant="outline">
                      {symbol.replace(".JK", "")}
                    </Badge>
                  ))}
                </div>
                <div className="resource-row__actions">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => edit(universe)}
                    aria-label={`Edit ${universe.name}`}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={() => void remove(universe)}
                    aria-label={`Hapus ${universe.name}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function SubscriptionPanel({
  authenticated,
  backendOnline,
}: ConnectionProps) {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const access = subscription ? subscriptionState(subscription) : null;
  const active = useRef(false);
  const loadVersion = useRef(0);

  async function load() {
    const version = ++loadVersion.current;
    const current = () => active.current && version === loadVersion.current;
    setLoading(true);
    setError(null);
    setAccountError(null);
    try {
      const plansRequest = api
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
      if (authenticated && backendOnline) {
        await api
          .currentSubscription()
          .then((response) => {
            if (current()) setSubscription(response.subscription);
          })
          .catch((caught) => {
            if (current())
              setAccountError(
                readableError(
                  caught,
                  "Plan status could not be loaded. Try again to check your access.",
                ),
              );
          });
      } else {
        setSubscription(null);
        if (authenticated)
          setAccountError(
            "The server is unavailable. Your plan status could not be checked.",
          );
      }
      await plansRequest;
    } catch (caught) {
      if (current())
        setError(readableError(caught, "Plans could not be loaded."));
    } finally {
      if (current()) setLoading(false);
    }
  }

  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      ++loadVersion.current;
    };
  }, [authenticated, backendOnline]);

  async function cancel(atPeriodEnd: boolean) {
    if (!subscription) return;
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
      setSubscription(response.subscription);
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
        </header>
        {loading ? (
          <div className="resource-loading">
            <Skeleton />
            <Skeleton />
          </div>
        ) : accountError ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>Plan status unavailable</AlertTitle>
            <AlertDescription>{accountError}</AlertDescription>
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw data-icon="inline-start" />
              Try again
            </Button>
          </Alert>
        ) : subscription ? (
          <div className="subscription-ledger">
            <div className="subscription-ledger__lead">
              <div className="subscription-plan-name">
                <Layers3 aria-hidden="true" />
                <h4>{subscription.plan_name}</h4>
                <Badge variant={access?.usable ? "secondary" : "outline"}>
                  {access?.usable
                    ? "Active"
                    : access?.label === "Expired"
                      ? "Expired"
                      : access?.label === "Canceled"
                        ? "Cancelled"
                        : access?.label}
                </Badge>
              </div>
              <p className="subscription-expiry">
                {access?.usable ? "Active until" : "Period ends"}
                <strong>{formatDate(subscription.current_period_end)}</strong>
                {subscription.cancel_at_period_end && (
                  <small>Ends after this period</small>
                )}
              </p>
            </div>
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
                    "Included in your plan. The backtest page is not available yet.",
                  icon: History,
                },
              ].map(({ code, name, description, icon: Icon }) => {
                const included = Boolean(
                  access?.usable &&
                  subscription.features.includes(
                    code as "screener" | "backtest",
                  ),
                );
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
                          {included
                            ? code === "backtest"
                              ? "Not available yet"
                              : "Active"
                            : "Not included"}
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
                  subscription.updated_at
                    ? Date.parse(subscription.updated_at)
                    : 0
                }
              />
            </section>
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
                access?.usable &&
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
          </div>
        ) : (
          <Empty className="subscription-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <KeyRound />
              </EmptyMedia>
              <EmptyTitle>
                {authenticated ? "No active plan" : "Sign in to view your plan"}
              </EmptyTitle>
              <EmptyDescription>
                {authenticated
                  ? "Compare capacity below. Plans are activated by an operator."
                  : "Compare plans below or sign in to check your access."}
              </EmptyDescription>
            </EmptyHeader>
            {!authenticated && (
              <EmptyContent>
                <Button
                  onClick={() => {
                    window.location.hash = "login";
                  }}
                >
                  <KeyRound data-icon="inline-start" /> Sign in
                </Button>
              </EmptyContent>
            )}
          </Empty>
        )}
      </section>

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
                className={
                  access?.usable && subscription?.plan_code === plan.code
                    ? "is-current"
                    : ""
                }
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
                      ? "Explore the Signalgen demo."
                      : plan.code === "pro"
                        ? "More room for strategies and stock groups."
                        : "For structured personal analysis."}
                  </CardDescription>
                  <CardAction>
                    {access?.usable &&
                      subscription?.plan_code === plan.code && (
                        <Badge>Your plan</Badge>
                      )}
                  </CardAction>
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
                          Not included
                        </span>
                      )}
                    </li>
                  </ul>
                </CardContent>
                <CardFooter>
                  <span>
                    {plan.code === "free"
                      ? "Demo access"
                      : "Activation by operator"}
                  </span>
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
    const date = new Date(validUntil);
    return Number.isNaN(date.valueOf()) ? "" : date.toISOString();
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
              <Input
                id="grant-until"
                type="datetime-local"
                value={validUntil}
                onChange={(event) => setValidUntil(event.target.value)}
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
              <Input
                id="subscription-until"
                type="datetime-local"
                value={validUntil}
                onChange={(event) => setValidUntil(event.target.value)}
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
