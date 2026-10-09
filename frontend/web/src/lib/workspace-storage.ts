import type { UserRuleDefinition } from "@/types";

const PREFIX = "signalgen:workspace:v1:";
export const WORKSPACE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 110_000;

export const workspaceKinds = [
  "rule-draft",
  "screener-preferences",
  "monitor-history",
  "watchlist",
] as const;
export type WorkspaceKind = (typeof workspaceKinds)[number];
// Distinguish an intentional account-side reset from absent/blocked storage.
export function hasWorkspaceData(userId: string, kind: string): boolean {
  try {
    return (
      window.localStorage.getItem(
        `${PREFIX}${encodeURIComponent(userId)}:${kind}`,
      ) !== null
    );
  } catch {
    return false;
  }
}
export function syncMeta(
  userId: string,
  kind: string,
): { version: number; dirty: boolean } {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(
        `${PREFIX}${encodeURIComponent(userId)}:sync:${kind}`,
      ) ?? "null",
    );
    return value && Number.isSafeInteger(value.version) && value.version >= 0
      ? { version: value.version, dirty: value.dirty === true }
      : { version: 0, dirty: false };
  } catch {
    return { version: 0, dirty: false };
  }
}
export function setSyncMeta(
  userId: string,
  kind: string,
  version: number,
  dirty: boolean,
) {
  try {
    window.localStorage.setItem(
      `${PREFIX}${encodeURIComponent(userId)}:sync:${kind}`,
      JSON.stringify({ version, dirty }),
    );
  } catch {
    /* Local UI remains usable. */
  }
}

export function readWorkspaceData(userId: string, kind: string): unknown {
  try {
    const raw = window.localStorage.getItem(
      `${PREFIX}${encodeURIComponent(userId)}:${kind}`,
    );
    if (!raw || raw.length > MAX_BYTES) return null;
    const value = JSON.parse(raw);
    if (
      value.version !== 1 ||
      !Number.isFinite(value.savedAt) ||
      value.savedAt > Date.now() + 60_000 ||
      Date.now() - value.savedAt > WORKSPACE_MAX_AGE
    )
      return null;
    return value.data;
  } catch {
    return null;
  }
}

export function writeWorkspaceData(
  userId: string,
  kind: string,
  data: unknown,
  notify = true,
): boolean {
  if (!userId) return false;
  try {
    const key = `${PREFIX}${encodeURIComponent(userId)}:${kind}`;
    const raw = JSON.stringify({ version: 1, savedAt: Date.now(), data });
    if (new TextEncoder().encode(raw).length > MAX_BYTES) return false;
    const previous = readWorkspaceData(userId, kind);
    window.localStorage.setItem(key, raw);
    if (notify && JSON.stringify(previous) !== JSON.stringify(data)) {
      setSyncMeta(userId, kind, syncMeta(userId, kind).version, true);
      if (typeof window.dispatchEvent === "function")
        window.dispatchEvent(
          new CustomEvent("signalgen:workspace-change", {
            detail: { userId, kind },
          }),
        );
    }
    return true;
  } catch {
    return false;
  }
}

export type RuleDraft = {
  definition: UserRuleDefinition;
  editingId: string | null;
  editingVersion: number | null;
};

export function validatedRuleDraft(value: unknown): RuleDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as RuleDraft;
  const d = draft.definition;
  if (
    !d ||
    typeof d.name !== "string" ||
    d.name.length > 100 ||
    d.logic !== "AND" ||
    d.signal_type !== "BUY" ||
    !Number.isFinite(d.cooldown_sec) ||
    d.cooldown_sec < 0 ||
    !Array.isArray(d.conditions) ||
    d.conditions.length > 20
  )
    return null;
  if (
    !d.conditions.every(
      (c) =>
        c &&
        ["PRICE", "EMA9", "EMA20", "RSI14"].includes(c.left) &&
        ["<", "<=", ">", ">="].includes(c.op) &&
        (typeof c.right === "number"
          ? Number.isFinite(c.right)
          : typeof c.right === "string" && c.right.length <= 100),
    )
  )
    return null;
  if (
    draft.editingId !== null &&
    (typeof draft.editingId !== "string" ||
      draft.editingId.length > 200 ||
      !Number.isInteger(draft.editingVersion) ||
      (draft.editingVersion ?? 0) < 1)
  )
    return null;
  return {
    definition: {
      name: d.name,
      logic: "AND",
      signal_type: "BUY",
      cooldown_sec: d.cooldown_sec,
      conditions: d.conditions.map((c) => ({
        left: c.left,
        op: c.op,
        right: c.right,
      })),
    },
    editingId: draft.editingId,
    editingVersion: draft.editingId === null ? null : draft.editingVersion,
  };
}

export function readRuleDraft(userId: string): RuleDraft | null {
  return validatedRuleDraft(readWorkspaceData(userId, "rule-draft"));
}

export function saveRuleDraft(
  userId: string,
  draft: RuleDraft | null,
): boolean {
  const valid = draft === null ? null : validatedRuleDraft(draft);
  if (draft !== null && !valid) return false;
  // A blank new form is a deliberate reset, never a stored preset.
  return writeWorkspaceData(
    userId,
    "rule-draft",
    valid &&
      (valid.editingId ||
        valid.definition.name ||
        valid.definition.conditions.length ||
        valid.definition.cooldown_sec !== 300)
      ? valid
      : null,
  );
}
