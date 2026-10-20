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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  indicatorLabels,
  operatorLabels,
  rulePresets,
  ruleSummary,
  validateRule,
} from "@/lib/rule-workflow";
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
  return ruleSummary(definition);
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
  const [presetId, setPresetId] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [confirmation, setConfirmation] = useState<
    | { kind: "preset"; preset: (typeof rulePresets)[number] }
    | { kind: "delete"; rule: RuleResource }
    | null
  >(null);
  const confirmationTrigger = useRef<HTMLElement | null>(null);
  const validation = validateRule(definition);
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
    setConfirmation(null);
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
    setPresetId([]);
    setSubmitted(false);
    if (userId) saveRuleDraft(userId, null);
    setPendingDraft(null);
    setEditing(null);
    setDefinition(blankDefinition());
    setError(null);
    setNotice("Blank rule ready. Add your first condition.");
  }

  function edit(rule: RuleResource) {
    if (!rule.definition) return;
    setPresetId([]);
    setSubmitted(false);
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
    setError(null);
    setDefinition((current) => ({
      ...current,
      conditions: current.conditions.map((condition, conditionIndex) =>
        conditionIndex === index ? { ...condition, ...patch } : condition,
      ),
    }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!backendOnline) {
      setError("Your draft is retained. Reconnect before saving the rule.");
      return;
    }
    setSubmitted(true);
    if (!validation.valid) {
      setError("Check the highlighted rule fields before saving.");
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
      setPresetId([]);
      setSubmitted(false);
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

  function applyPreset(preset: (typeof rulePresets)[number]) {
    setEditing(null);
    setPresetId([preset.id]);
    setSubmitted(false);
    setError(null);
    setNotice(null);
    setDefinition({
      ...preset.definition,
      conditions: preset.definition.conditions.map((condition) => ({
        ...condition,
      })),
    });
  }

  // A failed health probe must not replace a live editor and drop its focus.
  // Keep local drafting available; only server mutations require a connection.
  if (!authenticated) {
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
      <ConfirmDialog
        open={confirmation !== null}
        title={
          confirmation?.kind === "delete"
            ? "Delete this rule?"
            : "Replace current criteria?"
        }
        description={
          confirmation?.kind === "delete"
            ? `“${confirmation.rule.name}” will be deleted from your account. This cannot be undone.`
            : `Use “${confirmation?.preset.name ?? "this preset"}” instead of your current criteria. Unsaved edits will be replaced; saved rules stay unchanged until you save.`
        }
        confirmLabel={
          confirmation?.kind === "delete" ? "Delete rule" : "Replace criteria"
        }
        destructive={confirmation?.kind === "delete"}
        returnFocus={confirmationTrigger}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          if (!confirmation) return;
          const choice = confirmation;
          setConfirmation(null);
          if (choice.kind === "preset") applyPreset(choice.preset);
          else void remove(choice.rule);
        }}
      />
      {!backendOnline && (
        <Alert>
          <CircleAlert />
          <AlertTitle>Connection interrupted</AlertTitle>
          <AlertDescription>
            Keep editing your draft. Saving to your account will be available
            when the connection returns.
          </AlertDescription>
        </Alert>
      )}
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
              <p>
                Start with a preset, then adjust the criteria to fit your
                analysis.
              </p>
            </div>
          </div>
          <div className="rule-composer__draft-actions">
            <Button variant="outline" onClick={startNew} disabled={saving}>
              <CopyPlus data-icon="inline-start" /> New blank rule
            </Button>
            <Button
              variant="link"
              onClick={restoreDraft}
              disabled={!pendingDraft || loading || saving}
            >
              Restore draft
            </Button>
          </div>
        </header>
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
            <section
              className="rule-presets"
              aria-labelledby="rule-presets-title"
            >
              <div>
                <h4 id="rule-presets-title">Start with a preset</h4>
                <p>Editable starting points, not investment recommendations.</p>
              </div>
              <ToggleGroup
                aria-label="Rule presets"
                className="rule-presets__choices"
                value={presetId}
                variant="outline"
                onValueChange={(values) => {
                  const preset = rulePresets.find(
                    (item) => item.id === values[0],
                  );
                  if (!preset) return;
                  if (editing || definition.conditions.length > 0) {
                    confirmationTrigger.current =
                      document.activeElement as HTMLElement;
                    setConfirmation({ kind: "preset", preset });
                  } else applyPreset(preset);
                }}
              >
                {rulePresets.map((preset) => (
                  <ToggleGroupItem
                    key={preset.id}
                    value={preset.id}
                    aria-label={preset.name}
                    aria-describedby={`preset-meta-${preset.id}`}
                  >
                    <strong>{preset.name}</strong>
                    <small id={`preset-meta-${preset.id}`}>
                      {preset.definition.signal_type} ·{" "}
                      {preset.definition.conditions.length}{" "}
                      {preset.definition.conditions.length === 1
                        ? "condition"
                        : "conditions"}
                    </small>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {presetId[0] && (
                <p className="rule-presets__description">
                  {
                    rulePresets.find((preset) => preset.id === presetId[0])
                      ?.description
                  }
                </p>
              )}
            </section>
            <FieldGroup className="rule-basics">
              <Field data-invalid={submitted && !!validation.name}>
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
                  aria-invalid={submitted && !!validation.name}
                  aria-describedby={
                    submitted && validation.name ? "rule-name-error" : undefined
                  }
                />
                <FieldDescription>
                  This name appears in the screener.
                </FieldDescription>
                {submitted && validation.name && (
                  <FieldError id="rule-name-error">
                    {validation.name}
                  </FieldError>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="rule-signal-type">
                  Signal action
                </FieldLabel>
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
                  Direction of the signal when this rule matches; not an
                  automatic order.
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
                      <SelectItem value="AND">
                        AND (All conditions met)
                      </SelectItem>
                      <SelectItem value="OR">OR (Any condition met)</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Combine conditions using AND or OR.
                </FieldDescription>
              </Field>
              <Field data-invalid={submitted && !!validation.cooldown}>
                <FieldLabel htmlFor="rule-cooldown">
                  Cooldown (seconds)
                </FieldLabel>
                <Input
                  id="rule-cooldown"
                  type="number"
                  min={0}
                  max={86400}
                  step={1}
                  aria-invalid={submitted && !!validation.cooldown}
                  aria-describedby={
                    submitted && validation.cooldown
                      ? "rule-cooldown-error"
                      : undefined
                  }
                  value={definition.cooldown_sec}
                  onChange={(event) =>
                    setDefinition((current) => ({
                      ...current,
                      cooldown_sec: Number(event.target.value),
                    }))
                  }
                />
                <FieldDescription>
                  Sets the minimum interval between repeated signals.
                </FieldDescription>
                {submitted && validation.cooldown && (
                  <FieldError id="rule-cooldown-error">
                    {validation.cooldown}
                  </FieldError>
                )}
              </Field>
            </FieldGroup>

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
                  <div className="rule-condition-columns" aria-hidden="true">
                    <span>No</span>
                    <span>Indicator</span>
                    <span>Comparison</span>
                    <span>Reference</span>
                    <span />
                  </div>
                  {definition.conditions.map((condition, index) => (
                    <div
                      className="rule-condition-entry"
                      key={index}
                      data-invalid={!!validation.conditions[index]}
                    >
                      <FieldGroup
                        className="rule-condition-row"
                        role="group"
                        aria-label={`Condition ${index + 1}`}
                      >
                        <span className="rule-condition-row__index">
                          {index + 1}
                        </span>
                        <Field>
                          <FieldLabel
                            className="rule-condition-field-label"
                            htmlFor={`condition-indicator-${index}`}
                          >
                            Indicator
                          </FieldLabel>
                          <Select
                            value={condition.left}
                            items={Object.entries(indicatorLabels).map(
                              ([value, label]) => ({ value, label }),
                            )}
                            onValueChange={(value) =>
                              setCondition(index, {
                                left: value as RuleCondition["left"],
                              })
                            }
                          >
                            <SelectTrigger
                              id={`condition-indicator-${index}`}
                              aria-label={`Condition indicator ${index + 1}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {(
                                  ["PRICE", "EMA9", "EMA20", "RSI14"] as const
                                ).map((value) => (
                                  <SelectItem key={value} value={value}>
                                    {indicatorLabels[value]}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field>
                          <FieldLabel
                            className="rule-condition-field-label"
                            htmlFor={`condition-operator-${index}`}
                          >
                            Comparison
                          </FieldLabel>
                          <Select
                            value={condition.op}
                            items={Object.entries(operatorLabels).map(
                              ([value, label]) => ({ value, label }),
                            )}
                            onValueChange={(value) =>
                              setCondition(index, {
                                op: value as RuleCondition["op"],
                              })
                            }
                          >
                            <SelectTrigger
                              id={`condition-operator-${index}`}
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
                                    {operatorLabels[value]}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field data-invalid={!!validation.conditions[index]}>
                          <FieldLabel
                            className="rule-condition-field-label"
                            htmlFor={`condition-reference-${index}`}
                          >
                            Reference
                          </FieldLabel>
                          <Input
                            id={`condition-reference-${index}`}
                            aria-label={`Condition value ${index + 1}`}
                            value={String(condition.right)}
                            onChange={(event) =>
                              setCondition(index, {
                                right: rightValue(event.target.value),
                              })
                            }
                            placeholder="EMA20 or 55"
                            aria-invalid={!!validation.conditions[index]}
                            aria-describedby={
                              validation.conditions[index]
                                ? `condition-error-${index}`
                                : undefined
                            }
                          />
                        </Field>
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
                      </FieldGroup>
                      {validation.conditions[index] && (
                        <FieldError id={`condition-error-${index}`}>
                          {validation.conditions[index]}
                        </FieldError>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {definition.conditions.length > 0 && (
                <Button
                  className="rule-add-condition"
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
              )}
              {submitted && validation.count && (
                <FieldError>{validation.count}</FieldError>
              )}
            </div>

            {definition.conditions.length > 0 && (
              <section className="rule-explanation" aria-label="Rule summary">
                <h4>In plain English</h4>
                <p>{ruleSummary(definition)}</p>
                <small>
                  Crossovers compare two consecutive daily candles. Cooldown can
                  suppress a repeated signal even when criteria match.
                </small>
              </section>
            )}

            {error && (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>Rule not saved</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <footer className="rule-composer__footer">
              <span>
                {definition.conditions.length} / 20 conditions · Daily · IDX or
                US
              </span>
              <Button
                type="submit"
                size="lg"
                disabled={saving || !backendOnline}
              >
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
            <Button
              onClick={() => void load()}
              disabled={loading || !backendOnline}
            >
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
                          onClick={(event) => {
                            confirmationTrigger.current = event.currentTarget;
                            setConfirmation({ kind: "delete", rule });
                          }}
                          disabled={saving || !backendOnline}
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
