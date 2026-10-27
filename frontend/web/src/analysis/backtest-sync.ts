import { api, session } from "@/api/client";
import {
  validArchive,
  type BacktestArchive,
  type BacktestArchiveSummary,
} from "./backtest-history";
export type CloudArchive = Omit<BacktestArchive, "owner_id">;
export type CloudSummary = Omit<CloudArchive, "result">;
export type SyncedSummary = BacktestArchiveSummary & {
  serverVersion?: number;
  local?: boolean;
};
const marker = (owner: string) =>
  `signalgen:backtest-synced:v1:${encodeURIComponent(owner)}`;
export function syncedIDs(owner: string): string[] {
  try {
    const ids = JSON.parse(localStorage.getItem(marker(owner)) ?? "[]");
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === "string").slice(-100)
      : [];
  } catch {
    return [];
  }
}
export function markSynced(owner: string, id: string) {
  try {
    localStorage.setItem(
      marker(owner),
      JSON.stringify([...new Set([...syncedIDs(owner), id])].slice(-100)),
    );
  } catch {
    // A blocked device preference must not hide a confirmed server archive.
    // Without this marker the local copy is conservatively retained as device-only.
  }
}
export function requireOwner(
  revision: number,
  active: () => boolean,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (!active() || session.getIdentityRevision() !== revision)
    throw Error("Account changed. Reopen history for the current account.");
}
export async function uploadArchive(
  archive: BacktestArchive,
  signal: AbortSignal,
  active: () => boolean,
) {
  const revision = session.getIdentityRevision();
  requireOwner(revision, active, signal);
  // Whitelist the payload. Owner is exclusively derived by the authenticated API.
  const data: CloudArchive = {
    format_version: 1,
    id: archive.id,
    saved_at: archive.saved_at,
    title: archive.title,
    currency: archive.currency,
    source: archive.source,
    result: archive.result,
  };
  if (new TextEncoder().encode(JSON.stringify(data)).length > 8 * 1024 * 1024)
    throw Error(
      "This run exceeds the 8 MiB server limit. The local copy remains available.",
    );
  await api.saveRecord("backtest", archive.id, 0, data, signal);
  requireOwner(revision, active, signal);
  markSynced(archive.owner_id, archive.id);
  window.dispatchEvent(
    new CustomEvent("signalgen:backtest-history", { detail: archive.owner_id }),
  );
}
export async function downloadArchive(
  owner: string,
  id: string,
  signal: AbortSignal,
  active: () => boolean,
) {
  const revision = session.getIdentityRevision();
  requireOwner(revision, active, signal);
  const response = await api.getRecord<CloudArchive>("backtest", id, signal);
  requireOwner(revision, active, signal);
  const archive = { ...response.data, owner_id: owner };
  if (!validArchive(archive) || archive.id !== id)
    throw Error("Saved analysis is malformed or uses an unsupported policy.");
  return archive;
}
