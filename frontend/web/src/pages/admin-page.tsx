import { useEffect, useRef, useState } from "react";
import {
  Activity,
  BadgeCheck,
  CircleAlert,
  KeyRound,
  ListChecks,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { api } from "@/api/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { validateAdminChange, type AdminAction } from "@/lib/admin";
import type { AccountState, FeatureGrant, SubscriptionPlan } from "@/types";

type PendingChange = {
  action: AdminAction;
  userId: string;
  reason: string;
  value: string;
  until: string;
  title: string;
};
type ActivityEntry = {
  id: number;
  title: string;
  userId: string;
  time: string;
};
const featureNames = { screener: "Screener", backtest: "Backtest" };
function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Unable to complete this request. Try again.";
}
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Not available"
    : new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

export function AdminPage({
  authenticated,
  backendOnline,
}: {
  authenticated: boolean;
  backendOnline: boolean;
}) {
  const [account, setAccount] = useState<AccountState | null>(null);
  const [checking, setChecking] = useState(authenticated);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [planError, setPlanError] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [feature, setFeature] = useState<FeatureGrant["feature"]>("screener");
  const [plan, setPlan] = useState("");
  const [role, setRole] = useState<"user" | "operator">("user");
  const [grantUntil, setGrantUntil] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [grants, setGrants] = useState<FeatureGrant[] | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [system, setSystem] = useState<{
    api: boolean;
    ready: boolean;
    version: string;
    checkedAt: string;
  } | null>(null);
  const [systemBusy, setSystemBusy] = useState(false);
  const [permissionAttempt, setPermissionAttempt] = useState(0);
  const alive = useRef(true);
  const locked = useRef(false);
  const systemLocked = useRef(false);
  const reviewSection = useRef<HTMLElement>(null);
  function showReview() {
    reviewSection.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "center",
    });
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setAccount(null);
    setGrants(null);
    setPending(null);
    setPermissionError(null);
    setChecking(authenticated && backendOnline);
    if (authenticated && backendOnline) {
      api
        .account()
        .then((response) => {
          if (!active) return;
          setAccount(response);
          if (
            response.user.role !== "operator" ||
            response.user.status !== "active"
          )
            setPermissionError(
              "This account does not have active operator access.",
            );
        })
        .catch((caught) => {
          if (active) setPermissionError(errorMessage(caught));
        })
        .finally(() => {
          if (active) setChecking(false);
        });
    }
    return () => {
      active = false;
    };
  }, [authenticated, backendOnline, permissionAttempt]);

  useEffect(() => {
    let active = true;
    if (backendOnline) {
      setPlanError(null);
      api
        .listSubscriptionPlans()
        .then((response) => {
          if (!active) return;
          setPlans(response.items);
          setPlan(
            response.items.find((item) => item.code === "analyst")?.code ??
              response.items[0]?.code ??
              "",
          );
        })
        .catch((caught) => {
          if (active) setPlanError(errorMessage(caught));
        });
    }
    return () => {
      active = false;
    };
  }, [backendOnline, permissionAttempt]);

  const authorized =
    authenticated &&
    backendOnline &&
    account?.user.role === "operator" &&
    account.user.status === "active" &&
    !checking;
  const editable = Boolean(authorized && !busy);
  const uuidValid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      target.trim(),
    );

  function changeTarget(value: string) {
    setTarget(value);
    setGrants(null);
    setPending(null);
    setError(null);
    setMessage(null);
    setReason("");
  }
  async function inspect() {
    if (!authorized || locked.current) return;
    if (!uuidValid) {
      setError("Enter a valid account User ID (UUID).");
      return;
    }
    locked.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    setGrants(null);
    try {
      const response = await api.listFeatureGrants(target.trim());
      if (alive.current) setGrants(response.items);
    } catch (caught) {
      if (alive.current) setError(errorMessage(caught));
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function review(action: AdminAction) {
    if (!editable) return;
    const until = action === "subscription" ? periodEnd : grantUntil;
    const invalid = validateAdminChange(target, reason, action, until);
    if (invalid) {
      setError(invalid);
      if (!uuidValid) document.getElementById("admin-target")?.focus();
      else {
        showReview();
        document.getElementById("admin-reason")?.focus({ preventScroll: true });
      }
      return;
    }
    if (
      action === "subscription" &&
      !plans.some((item) => item.code === plan)
    ) {
      setError("Choose an available subscription plan.");
      return;
    }
    const value =
      action === "role" ? role : action === "subscription" ? plan : feature;
    const titles = {
      grant: `Grant ${featureNames[feature]} access`,
      revoke: `Revoke ${featureNames[feature]} grant`,
      subscription: `Activate ${plans.find((item) => item.code === plan)?.name ?? plan}`,
      role: `Change role to ${role}`,
    };
    setError(null);
    setMessage(null);
    setPending({
      action,
      userId: target.trim(),
      reason: reason.trim(),
      value,
      until:
        action === "grant" || action === "subscription"
          ? new Date(until).toISOString()
          : "",
      title: titles[action],
    });
    showReview();
  }
  async function confirm() {
    if (!pending || !authorized || locked.current) return;
    const change = pending;
    const invalid = validateAdminChange(
      change.userId,
      change.reason,
      change.action,
      change.until,
    );
    if (invalid) {
      setError(invalid);
      setPending(null);
      return;
    }
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      if (change.action === "grant")
        await api.grantFeature(
          change.userId,
          change.value as FeatureGrant["feature"],
          change.until,
          change.reason,
        );
      else if (change.action === "revoke")
        await api.revokeFeature(
          change.userId,
          change.value as FeatureGrant["feature"],
          change.reason,
        );
      else if (change.action === "subscription")
        await api.activateSubscription(
          change.userId,
          change.value as SubscriptionPlan["code"],
          change.until,
          change.reason,
        );
      else
        await api.changeAccountRole(
          change.userId,
          change.value as "user" | "operator",
          change.reason,
        );
      if (!alive.current) return;
      setMessage(`${change.title}: saved.`);
      setPending(null);
      setReason("");
      setActivity((items) =>
        [
          {
            id: Date.now(),
            title: change.title,
            userId: change.userId,
            time: new Date().toISOString(),
          },
          ...items,
        ].slice(0, 8),
      );
      if (
        change.action === "role" &&
        change.userId === account?.user.id &&
        change.value === "user"
      ) {
        setPermissionAttempt((value) => value + 1);
      } else if (change.action === "grant" || change.action === "revoke") {
        try {
          const response = await api.listFeatureGrants(change.userId);
          if (alive.current) setGrants(response.items);
        } catch {
          if (alive.current) {
            setGrants(null);
            setMessage(
              `${change.title}: saved. Refresh grants to load the latest access.`,
            );
          }
        }
      }
    } catch (caught) {
      if (alive.current) setError(errorMessage(caught));
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function checkSystem() {
    if (systemLocked.current) return;
    systemLocked.current = true;
    setSystemBusy(true);
    const [status, readiness] = await Promise.allSettled([
      api.status(),
      api.readiness(),
    ]);
    if (alive.current) {
      setSystem({
        api: status.status === "fulfilled",
        ready: readiness.status === "fulfilled",
        version:
          status.status === "fulfilled" ? status.value.version : "Unavailable",
        checkedAt: new Date().toISOString(),
      });
      setSystemBusy(false);
    }
    systemLocked.current = false;
  }

  return (
    <div className="admin-workspace">
      <div className="admin-session-bar">
        <span>
          <ShieldCheck aria-hidden="true" />{" "}
          {checking
            ? "Checking operator access…"
            : authorized
              ? "Operator access verified"
              : "Read-only workspace"}
        </span>
        <Badge variant="outline">
          {account?.user.email ?? "Account administration"}
        </Badge>
      </div>
      {!authorized && !checking && (
        <Alert>
          <KeyRound />
          <AlertTitle>
            {!authenticated
              ? "Sign in with an operator account"
              : !backendOnline
                ? "Backend is unavailable"
                : "Operator access required"}
          </AlertTitle>
          <AlertDescription>
            {permissionError ??
              "You can review the interface, but account changes require an active operator session."}
            {!authenticated ? (
              <Button
                nativeButton={false}
                variant="outline"
                render={<a href="#login" />}
              >
                Sign in
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => setPermissionAttempt((value) => value + 1)}
              >
                Check access again
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {checking && (
        <Skeleton
          className="admin-permission-skeleton"
          aria-label="Checking access"
        />
      )}
      <section className="admin-account" aria-labelledby="admin-account-title">
        <div className="admin-section-title">
          <UsersRound aria-hidden="true" />
          <div>
            <h3 id="admin-account-title">Choose an account</h3>
            <p>
              Manage one account at a time. Use its User ID to inspect direct
              feature grants.
            </p>
          </div>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void inspect();
          }}
          className="admin-account-form"
        >
          <FieldGroup>
            <Field data-invalid={Boolean(target && !uuidValid)}>
              <FieldLabel htmlFor="admin-target">Account User ID</FieldLabel>
              <Input
                id="admin-target"
                value={target}
                disabled={!editable}
                onChange={(event) => changeTarget(event.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                aria-invalid={Boolean(target && !uuidValid)}
                aria-describedby="admin-target-hint"
                autoComplete="off"
                spellCheck={false}
              />
              <FieldDescription id="admin-target-hint">
                Email search is not available yet. Use the account's Supabase
                Auth User ID.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <div className="admin-account-actions">
            <Button type="submit" disabled={!editable || !uuidValid}>
              {busy ? (
                <LoaderCircle data-icon="inline-start" />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
              Inspect access
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!editable || !account}
              onClick={() => changeTarget(account?.user.id ?? "")}
            >
              Use my account
            </Button>
          </div>
        </form>
      </section>
      <Tabs
        defaultValue="grants"
        className="admin-console"
        onValueChange={() => setPending(null)}
      >
        <TabsList variant="line" aria-label="Administration sections">
          <TabsTrigger value="grants">
            <ListChecks />
            Feature access
          </TabsTrigger>
          <TabsTrigger value="subscription">
            <BadgeCheck />
            Subscription
          </TabsTrigger>
          <TabsTrigger value="role">
            <ShieldCheck />
            Account role
          </TabsTrigger>
          <TabsTrigger value="system">
            <Activity />
            System status
          </TabsTrigger>
        </TabsList>
        <TabsContent value="grants">
          <div className="admin-section-title">
            <div>
              <h3>Feature access</h3>
              <p>
                Give temporary access or revoke a direct grant. Subscription
                access is managed separately.
              </p>
            </div>
          </div>
          <FieldGroup className="admin-fields">
            <Field>
              <FieldLabel htmlFor="admin-feature">Feature</FieldLabel>
              <Select
                value={feature}
                disabled={!editable}
                onValueChange={(value) => {
                  setFeature(value as FeatureGrant["feature"]);
                  setPending(null);
                }}
              >
                <SelectTrigger id="admin-feature">
                  <SelectValue>{featureNames[feature]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="screener">Screener</SelectItem>
                    <SelectItem value="backtest">Backtest</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                Granting access does not change the account role.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="admin-grant-expiry">
                Access expires
              </FieldLabel>
              <Input
                id="admin-grant-expiry"
                type="datetime-local"
                value={grantUntil}
                disabled={!editable}
                onChange={(event) => {
                  setGrantUntil(event.target.value);
                  setPending(null);
                }}
              />
              <FieldDescription>
                Choose a future date in your local timezone.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <div className="admin-actions">
            <Button disabled={!editable} onClick={() => review("grant")}>
              Review access grant
            </Button>
            <Button
              variant="outline"
              disabled={!editable}
              onClick={() => review("revoke")}
            >
              Review revocation
            </Button>
          </div>
          <div className="admin-ledger">
            <h4>Direct feature grants</h4>
            {busy && grants === null ? (
              <Skeleton className="admin-ledger-skeleton" />
            ) : grants === null ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ListChecks />
                  </EmptyMedia>
                  <EmptyTitle>No account inspected</EmptyTitle>
                  <EmptyDescription>
                    Enter a User ID above and select Inspect access. No account
                    data is loaded until you do.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : grants.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No direct feature grants</EmptyTitle>
                  <EmptyDescription>
                    This account may still have access through a subscription.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Feature</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grants.map((grant) => (
                    <TableRow key={grant.feature}>
                      <TableCell>{featureNames[grant.feature]}</TableCell>
                      <TableCell>
                        <Badge variant={grant.active ? "secondary" : "outline"}>
                          {grant.active
                            ? "Active"
                            : grant.revoked_at
                              ? "Revoked"
                              : "Expired"}
                        </Badge>
                      </TableCell>
                      <TableCell>{dateLabel(grant.valid_until)}</TableCell>
                      <TableCell>
                        {grant.reason || "No reason recorded"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>
        <TabsContent value="subscription">
          <div className="admin-section-title">
            <div>
              <h3>Activate a subscription</h3>
              <p>
                Assign a backend plan and its period end. This is manual
                activation, not a payment or checkout.
              </p>
            </div>
          </div>
          {planError && (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>Plans could not be loaded</AlertTitle>
              <AlertDescription>
                {planError}
                <Button
                  variant="outline"
                  onClick={() => setPermissionAttempt((value) => value + 1)}
                >
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <FieldGroup className="admin-fields">
            <Field>
              <FieldLabel htmlFor="admin-plan">Subscription plan</FieldLabel>
              <Select
                value={plan}
                disabled={!editable || !plans.length}
                onValueChange={(value) => {
                  setPlan(value ?? "");
                  setPending(null);
                }}
              >
                <SelectTrigger id="admin-plan">
                  <SelectValue placeholder="Select a plan">
                    {plans.find((item) => item.code === plan)?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {plans.map((item) => (
                      <SelectItem key={item.code} value={item.code}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                {plans.find((item) => item.code === plan)?.description ??
                  "Plans are loaded from the backend."}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="admin-period-end">
                Subscription period ends
              </FieldLabel>
              <Input
                id="admin-period-end"
                type="datetime-local"
                value={periodEnd}
                disabled={!editable}
                onChange={(event) => {
                  setPeriodEnd(event.target.value);
                  setPending(null);
                }}
              />
            </Field>
          </FieldGroup>
          <div className="admin-plan-features">
            {plans
              .find((item) => item.code === plan)
              ?.features.map((item) => (
                <Badge variant="outline" key={item}>
                  {featureNames[item]}
                </Badge>
              ))}
          </div>
          <div className="admin-actions">
            <Button
              disabled={!editable || !plans.length}
              onClick={() => review("subscription")}
            >
              Review activation
            </Button>
          </div>
          <p className="admin-help">
            The current subscription for another account cannot be read through
            the available operator API. Only the activation result is confirmed
            here.
          </p>
        </TabsContent>
        <TabsContent value="role">
          <div className="admin-section-title">
            <div>
              <h3>Account role</h3>
              <p>
                Operator access allows account administration. It is separate
                from access to paid analysis features.
              </p>
            </div>
          </div>
          <FieldGroup className="admin-fields">
            <Field>
              <FieldLabel htmlFor="admin-role">New role</FieldLabel>
              <Select
                value={role}
                disabled={!editable}
                onValueChange={(value) => {
                  setRole(value as "user" | "operator");
                  setPending(null);
                }}
              >
                <SelectTrigger id="admin-role">
                  <SelectValue>
                    {role === "operator" ? "Operator" : "User"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="operator">Operator</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                This is the role to assign, not the account's current role.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <Alert>
            <ShieldCheck />
            <AlertTitle>The last active operator is protected</AlertTitle>
            <AlertDescription>
              The backend prevents demoting the last active operator. Changing
              your own role may remove access to this page.
            </AlertDescription>
          </Alert>
          <div className="admin-actions">
            <Button disabled={!editable} onClick={() => review("role")}>
              Review role change
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="system">
          <div className="admin-section-title">
            <div>
              <h3>System status</h3>
              <p>
                Run a live check of the API and its dependency readiness. No
                user totals or usage estimates are inferred.
              </p>
            </div>
            <Button
              variant="outline"
              disabled={systemBusy}
              onClick={() => void checkSystem()}
            >
              <RefreshCw data-icon="inline-start" />
              {systemBusy ? "Checking…" : "Check now"}
            </Button>
          </div>
          {systemBusy ? (
            <Skeleton className="admin-ledger-skeleton" />
          ) : (
            <dl className="admin-system-list">
              <div>
                <dt>API connection</dt>
                <dd>
                  {system
                    ? system.api
                      ? "Available"
                      : "Unavailable"
                    : "Not checked"}
                </dd>
              </div>
              <div>
                <dt>Service readiness</dt>
                <dd>
                  {system
                    ? system.ready
                      ? "Ready"
                      : "Not ready"
                    : "Not checked"}
                </dd>
              </div>
              <div>
                <dt>API version</dt>
                <dd>{system?.version ?? "Not checked"}</dd>
              </div>
              <div>
                <dt>Last checked</dt>
                <dd>{system ? dateLabel(system.checkedAt) : "Not checked"}</dd>
              </div>
            </dl>
          )}
        </TabsContent>
      </Tabs>
      <section
        className="admin-review"
        aria-labelledby="admin-review-title"
        ref={reviewSection}
      >
        <div className="admin-section-title">
          <div>
            <h3 id="admin-review-title">Reason & review</h3>
            <p>
              Every access change requires a reason, recorded by the backend
              with the operator identity.
            </p>
          </div>
        </div>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="admin-reason">
              Reason for this change
            </FieldLabel>
            <Textarea
              id="admin-reason"
              value={reason}
              disabled={!editable}
              maxLength={500}
              rows={2}
              onChange={(event) => {
                setReason(event.target.value);
                setPending(null);
              }}
              placeholder="For example: activate access for the approved trial period."
            />
            <FieldDescription>
              No change is sent until you confirm below.
            </FieldDescription>
          </Field>
        </FieldGroup>
        {pending && (
          <Alert>
            <ShieldCheck />
            <AlertTitle>{pending.title}</AlertTitle>
            <AlertDescription>
              <dl className="admin-confirm-details">
                <div>
                  <dt>Account</dt>
                  <dd>{pending.userId}</dd>
                </div>
                {pending.until && (
                  <div>
                    <dt>Valid until</dt>
                    <dd>{dateLabel(pending.until)}</dd>
                  </div>
                )}
                <div>
                  <dt>Reason</dt>
                  <dd>{pending.reason}</dd>
                </div>
              </dl>
              <div className="admin-actions">
                <Button
                  variant={
                    pending.action === "revoke" ? "destructive" : "default"
                  }
                  disabled={!editable}
                  onClick={() => void confirm()}
                >
                  {busy && <LoaderCircle data-icon="inline-start" />}Confirm
                  change
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setPending(null)}
                >
                  Cancel
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
        <div aria-live="polite">
          {(error || message) && (
            <Alert variant={error ? "destructive" : "default"}>
              {error ? <CircleAlert /> : <BadgeCheck />}
              <AlertTitle>
                {error ? "Change not completed" : "Change saved"}
              </AlertTitle>
              <AlertDescription>{error ?? message}</AlertDescription>
            </Alert>
          )}
        </div>
      </section>
      <section
        className="admin-activity"
        aria-labelledby="admin-activity-title"
      >
        <div className="admin-section-title">
          <div>
            <h3 id="admin-activity-title">Activity in this visit</h3>
            <p>
              Successful changes made here. This list clears when you leave; it
              is not the full audit log.
            </p>
          </div>
        </div>
        {activity.length ? (
          <ul>
            {activity.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.userId}</span>
                </div>
                <time dateTime={item.time}>{dateLabel(item.time)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-help">No account changes made in this visit.</p>
        )}
      </section>
    </div>
  );
}
