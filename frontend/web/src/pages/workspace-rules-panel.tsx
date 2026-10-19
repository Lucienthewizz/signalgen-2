import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenCheck,
  CircleAlert,
  CopyPlus,
  ListChecks,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { api, ApiError } from "@/api/client";
import { ResourceQuota } from "@/components/resource-quota";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useActionNotifications } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
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
import type { RuleCondition, RuleResource, UserRuleDefinition } from "@/types";
import {
  readRuleDraft,
  saveRuleDraft,
  type RuleDraft,
} from "@/lib/workspace-storage";

type Props = {
  authenticated: boolean;
  backendOnline: boolean;
  userId?: string;
  onRun: () => void;
};

const blankDefinition = (): UserRuleDefinition => ({
  name: "",
  logic: "AND",
  signal_type: "BUY",
  cooldown_sec: 300,
  conditions: [],
});

const blankCondition = (): RuleCondition => ({
  left: "PRICE",
  op: ">",
  right: "EMA20",
});

function readableError(error: unknown) {
  if (error instanceof ApiError && error.code === "VERSION_CONFLICT")
    return "This rule changed in another session. Reload and try again.";
  return error instanceof Error
    ? error.message
    : "Rule changes could not be saved.";
}

function rightValue(value: string): string | number {
  const numeric = Number(value);
  return value.trim() !== "" && Number.isFinite(numeric)
    ? numeric
    : value.trim();
}

function summary(definition?: UserRuleDefinition) {
  if (!definition?.conditions.length) return "No conditions yet";
  const conds = definition.conditions
    .map((item) => `${item.left} ${item.op} ${item.right}`)
    .join(definition.logic === "OR" ? " OR " : " · ");
  return `${definition.signal_type || "BUY"} (${definition.logic || "AND"}): ${conds}`;
}

export function ServerRulesPanel({
  authenticated,
  backendOnline,
  userId,
  onRun,
}: Props) {
  const [rules, setRules] = useState<RuleResource[]>([]);
  const [editing, setEditing] = useState<RuleResource | null>(null);
  const [definition, setDefinition] =
    useState<UserRuleDefinition>(blankDefinition);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useActionNotifications(notice, error);
  const [draftOwner, setDraftOwner] = useState<string | undefined>();
  const [pendingDraft, setPendingDraft] = useState<RuleDraft | null>(null);
  const [draftStorageFailed, setDraftStorageFailed] = useState(false);
  const activeUser = useRef(userId);
  activeUser.current = authenticated ? userId : undefined;

  useEffect(() => {
    const owner = authenticated ? userId : undefined;
    setDraftOwner(owner);
    setPendingDraft(owner ? readRuleDraft(owner) : null);
    setDefinition(blankDefinition());
    setEditing(null);
    setRules([]);
    setSaving(false);
    setLoading(false);
    setError(null);
    setNotice(null);
    setDraftStorageFailed(false);
  }, [authenticated, userId]);

  useEffect(() => {
    if (!authenticated || !userId || draftOwner !== userId || pendingDraft)
      return;
    setDraftStorageFailed(
      !saveRuleDraft(userId, {
        definition,
        editingId: editing?.id ?? null,
        editingVersion: editing?.version ?? null,
      }),
    );
  }, [authenticated, userId, draftOwner, pendingDraft, definition, editing]);

  function restoreDraft() {
    if (!pendingDraft) return;
    if (pendingDraft.editingId) {
      const rule = rules.find(
        (item) =>
          item.id === pendingDraft.editingId && item.owner_type === "user",
      );
      if (!rule || rule.version !== pendingDraft.editingVersion) {
        setError(
          "The original rule changed or is unavailable. Reload the list or start a blank rule to discard this draft.",
        );
        return;
      }
      setEditing(rule);
    } else setEditing(null);
    setDefinition(pendingDraft.definition);
    setPendingDraft(null);
    setNotice("Draft restored. Check the conditions before saving.");
  }

  async function load() {
    if (!authenticated || !backendOnline) return;
    const owner = userId;
    setLoading(true);
    setError(null);
    try {
      const response = await api.listRules();
      if (activeUser.current !== owner) return;
      setRules(response.items);
    } catch (caught) {
      if (activeUser.current !== owner) return;
      setError(readableError(caught));
    } finally {
      if (activeUser.current === owner) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [authenticated, backendOnline, userId]);

  const privateRules = useMemo(
    () => rules.filter((rule) => rule.owner_type === "user"),
    [rules],
  );
  const systemRules = useMemo(
    () => rules.filter((rule) => rule.owner_type === "system"),
    [rules],
  );

  function startNew() {
    if (userId) saveRuleDraft(userId, null);
    setPendingDraft(null);
    setEditing(null);
    setDefinition(blankDefinition());
    setError(null);
    setNotice("Blank rule ready. Add your first condition.");
  }

  function edit(rule: RuleResource) {
    if (!rule.definition) return;
    setEditing(rule);
    setPendingDraft(null);
    setDefinition({
      ...rule.definition,
      conditions: rule.definition.conditions.map((condition) => ({
        ...condition,
      })),
    });
    setError(null);
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setCondition(index: number, patch: Partial<RuleCondition>) {
    setDefinition((current) => ({
      ...current,
      conditions: current.conditions.map((condition, conditionIndex) =>
        conditionIndex === index ? { ...condition, ...patch } : condition,
      ),
    }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!definition.name.trim()) {
      setError("Enter a name to identify your rule.");
      return;
    }
    if (!definition.conditions.length) {
      setError("Add at least one screening condition.");
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    const payload = { ...definition, name: definition.name.trim() };
    const owner = userId;
    try {
      if (editing) {
        await api.updateRule(editing.id, editing.version, payload);
        if (activeUser.current !== owner) return;
        setNotice("Rule updated.");
      } else {
        await api.createRule(payload);
        if (activeUser.current !== owner) return;
        setNotice("Rule saved and ready to use in the screener.");
      }
      setEditing(null);
      setDefinition(blankDefinition());
      if (userId) saveRuleDraft(userId, null);
      setPendingDraft(null);
      await load();
    } catch (caught) {
      if (activeUser.current !== owner) return;
      setError(readableError(caught));
    } finally {
      if (activeUser.current === owner) setSaving(false);
    }
  }

  async function remove(rule: RuleResource) {
    if (!window.confirm(`Delete rule “${rule.name}”?`)) return;
    setError(null);
    setNotice(null);
    const owner = userId;
    try {
      await api.deleteRule(rule.id, rule.version);
      if (activeUser.current !== owner) return;
      if (editing?.id === rule.id) startNew();
      await load();
      setNotice("Rule deleted.");
    } catch (caught) {
      if (activeUser.current !== owner) return;
      setError(readableError(caught));
    }
  }

  if (!authenticated || !backendOnline) {
    return (
      <Empty className="workspace-empty-state">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldCheck />
          </EmptyMedia>
          <EmptyTitle>Rules workspace unavailable</EmptyTitle>
          <EmptyDescription>
            {!backendOnline
              ? "Start the Go API to load and save rules."
              : "Sign in to save private rules to your account."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="rules-workspace">
      <section className="rule-composer" aria-labelledby="rule-composer-title">
        <header className="rule-composer__header">
          <div className="resource-title-lockup">
            <span aria-hidden="true">
              <ListChecks />
            </span>
            <div>
              <h3 id="rule-composer-title">
                {editing ? `Edit ${editing.name}` : "Create a screening rule"}
              </h3>
              <p>Build a checklist. Every condition must be met.</p>
            </div>
          </div>
          <Button variant="outline" onClick={startNew} disabled={saving}>
            <CopyPlus data-icon="inline-start" /> New blank rule
          </Button>
        </header>

        {pendingDraft && (
          <Alert>
            <Save />
            <AlertTitle>Rule draft available</AlertTitle>
            <AlertDescription>
              <p>Restore your draft to continue, or start a blank rule.</p>
              <Button
                variant="outline"
                onClick={restoreDraft}
                disabled={loading}
              >
                Restore draft
              </Button>
              <Button variant="ghost" onClick={startNew}>
                Discard draft
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {draftStorageFailed && (
          <Alert>
            <CircleAlert />
            <AlertTitle>
              Draft is available only while this page is open
            </AlertTitle>
            <AlertDescription>
              Your browser cannot store this draft. Save your rule before
              reloading or leaving this page.
            </AlertDescription>
          </Alert>
        )}

        <form className="rule-composer__form" onSubmit={save}>
          <fieldset
            disabled={saving || !!pendingDraft}
            style={{
              border: 0,
              padding: 0,
              margin: 0,
              minWidth: 0,
              display: "grid",
              gap: "inherit",
            }}
          >
            <div className="rule-basics">
              <Field>
                <FieldLabel htmlFor="rule-name">Rule name</FieldLabel>
                <Input
                  id="rule-name"
                  value={definition.name}
                  onChange={(event) =>
                    setDefinition((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Example: Daily bank momentum"
                  maxLength={100}
                />
                <FieldDescription>
                  This name appears in the screener.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="rule-signal-type">Signal action</FieldLabel>
                <Select
                  value={definition.signal_type}
                  onValueChange={(value) =>
                    setDefinition((current) => ({
                      ...current,
                      signal_type: (value as "BUY" | "SELL") || "BUY",
                    }))
                  }
                >
                  <SelectTrigger id="rule-signal-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="BUY">BUY (Entry)</SelectItem>
                      <SelectItem value="SELL">SELL (Exit)</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Direction of signal generated when conditions match.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="rule-logic">Rule logic</FieldLabel>
                <Select
                  value={definition.logic}
                  onValueChange={(value) =>
                    setDefinition((current) => ({
                      ...current,
                      logic: (value as "AND" | "OR") || "AND",
                    }))
                  }
                >
                  <SelectTrigger id="rule-logic">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="AND">AND (All conditions met)</SelectItem>
                      <SelectItem value="OR">OR (Any condition met)</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Combine conditions using AND or OR.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="rule-cooldown">
                  Cooldown (seconds)
                </FieldLabel>
                <Input
                  id="rule-cooldown"
                  type="number"
                  min={0}
                  value={definition.cooldown_sec}
                  onChange={(event) =>
                    setDefinition((current) => ({
                      ...current,
                      cooldown_sec: Math.max(
                        0,
                        Number(event.target.value) || 0,
                      ),
                    }))
                  }
                />
                <FieldDescription>
                  Sets the minimum interval between repeated signals.
                </FieldDescription>
              </Field>
            </div>

            <div className="rule-condition-section">
              <div className="rule-condition-section__heading">
                <div>
                  <h4>Screening conditions</h4>
                  <p>
                    Choose an indicator, comparison, and reference value or
                    indicator.
                  </p>
                </div>
                <Badge variant="outline">
                  {definition.logic} logic · {definition.signal_type} signal
                </Badge>
              </div>
              {definition.conditions.length === 0 ? (
                <button
                  type="button"
                  className="rule-empty-condition"
                  onClick={() =>
                    setDefinition((current) => ({
                      ...current,
                      conditions: [blankCondition()],
                    }))
                  }
                >
                  <Plus />
                  <span>
                    <strong>Add the first condition</strong>
                    <small>Start from a blank rule.</small>
                  </span>
                </button>
              ) : (
                <div className="rule-condition-list">
                  {definition.conditions.map((condition, index) => (
                    <div
                      className="rule-condition-row"
                      key={`${index}-${condition.left}`}
                    >
                      <span className="rule-condition-row__index">
                        {index + 1}
                      </span>
                      <Select
                        value={condition.left}
                        onValueChange={(value) =>
                          setCondition(index, {
                            left: value as RuleCondition["left"],
                          })
                        }
                      >
                        <SelectTrigger
                          aria-label={`Condition indicator ${index + 1}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {(["PRICE", "EMA9", "EMA20", "RSI14"] as const).map(
                              (value) => (
                                <SelectItem key={value} value={value}>
                                  {value}
                                </SelectItem>
                              ),
                            )}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <Select
                        value={condition.op}
                        onValueChange={(value) =>
                          setCondition(index, {
                            op: value as RuleCondition["op"],
                          })
                        }
                      >
                        <SelectTrigger
                          aria-label={`Condition operator ${index + 1}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {(
                              [
                                ">",
                                ">=",
                                "<",
                                "<=",
                                "CROSS_UP",
                                "CROSS_DOWN",
                              ] as const
                            ).map((value) => (
                              <SelectItem key={value} value={value}>
                                {value === "CROSS_UP"
                                  ? "CROSS_UP (Golden Cross)"
                                  : value === "CROSS_DOWN"
                                    ? "CROSS_DOWN (Death Cross)"
                                    : value}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <Input
                        aria-label={`Condition value ${index + 1}`}
                        value={String(condition.right)}
                        onChange={(event) =>
                          setCondition(index, {
                            right: rightValue(event.target.value),
                          })
                        }
                        placeholder="EMA20 or 55"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove condition ${index + 1}`}
                        onClick={() =>
                          setDefinition((current) => ({
                            ...current,
                            conditions: current.conditions.filter(
                              (_, conditionIndex) => conditionIndex !== index,
                            ),
                          }))
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={definition.conditions.length >= 20}
                onClick={() =>
                  setDefinition((current) => ({
                    ...current,
                    conditions: [...current.conditions, blankCondition()],
                  }))
                }
              >
                <Plus data-icon="inline-start" /> Add condition
              </Button>
            </div>

            {error && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>Rule not saved</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <footer className="rule-composer__footer">
              <span>{definition.conditions.length} conditions · Daily IDX</span>
              <Button type="submit" size="lg" disabled={saving}>
                {saving ? (
                  <LoaderCircle
                    data-icon="inline-start"
                    className="is-spinning"
                  />
                ) : editing ? (
                  <Pencil data-icon="inline-start" />
                ) : (
                  <Save data-icon="inline-start" />
                )}
                {editing ? "Update rule" : "Save rule"}
              </Button>
            </footer>
          </fieldset>
        </form>
      </section>

      <section className="rule-library" aria-labelledby="rule-library-title">
        <header className="resource-library__header">
          <div>
            <h3 id="rule-library-title">Saved rules</h3>
            <ResourceQuota kind="custom_rules" revision={rules.length} />
            <p>Edit a private rule or run it from the screener.</p>
          </div>
          <div>
            <Button onClick={() => void load()} disabled={loading}>
              <RefreshCw
                data-icon="inline-start"
                className={loading ? "is-spinning" : ""}
              />
              Refresh
            </Button>
            <Button onClick={onRun}>
              <BookOpenCheck data-icon="inline-start" /> Open screener
            </Button>
          </div>
        </header>
        {loading && !rules.length ? (
          <div className="resource-loading">
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ) : privateRules.length === 0 && systemRules.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListChecks />
              </EmptyMedia>
              <EmptyTitle>No saved rules yet</EmptyTitle>
              <EmptyDescription>
                Create a blank rule above and add your conditions.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="rule-library__groups">
            {privateRules.length > 0 && (
              <div>
                <span className="rule-library__eyebrow">Your rules</span>
                <div className="rule-library__rows">
                  {privateRules.map((rule) => (
                    <article key={rule.id}>
                      <div>
                        <strong>{rule.name}</strong>
                        <p>{summary(rule.definition)}</p>
                      </div>
                      <div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => edit(rule)}
                          disabled={saving}
                          aria-label={`Edit ${rule.name}`}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          onClick={() => void remove(rule)}
                          disabled={saving}
                          aria-label={`Delete ${rule.name}`}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}
            {systemRules.length > 0 && (
              <div>
                <span className="rule-library__eyebrow">
                  System rules · read only
                </span>
                <div className="rule-library__rows">
                  {systemRules.map((rule) => (
                    <article key={rule.id}>
                      <div>
                        <strong>{rule.name}</strong>
                        <p>{summary(rule.definition)}</p>
                      </div>
                      <Badge variant="secondary">System</Badge>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
