import { useEffect, useRef, useState } from "react";
import { api, session } from "@/api/client";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  BACKTEST_HISTORY_EVENT,
  listBacktestArchives,
  loadBacktestArchive,
  deleteBacktestArchives,
  type BacktestArchive,
} from "@/analysis/backtest-history";
import {
  downloadArchive,
  uploadArchive,
  syncedIDs,
  markSynced,
  type SyncedSummary,
  type CloudSummary,
} from "@/analysis/backtest-sync";

export function BacktestHistoryPanel({
  owner,
  revision,
  onOpen,
}: {
  owner: string;
  revision: number;
  onOpen: (archive: BacktestArchive) => void;
}) {
  const [items, setItems] = useState<SyncedSummary[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  const [pending, setPending] = useState<{ id: string | null } | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null),
    operation = useRef<AbortController | null>(null),
    mounted = useRef(true);
  const active = () =>
    mounted.current &&
    session.getIdentityRevision() === revision &&
    !!session.getToken();
  useEffect(() => {
    mounted.current = true;
    const stop = session.onIdentityChange(() => {
      operation.current?.abort();
      setItems([]);
      setPending(null);
    });
    return () => {
      mounted.current = false;
      operation.current?.abort();
      stop();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.allSettled([
      listBacktestArchives(owner, controller.signal, active),
      api.listRecords<CloudSummary>("backtest", controller.signal),
    ])
      .then(async ([local, cloud]) => {
        if (!active() || controller.signal.aborted) return;
        const rows = new Map<string, SyncedSummary>();
        const remoteIDs = new Set(
          cloud.status === "fulfilled"
            ? cloud.value.items.map((r) => r.id)
            : [],
        );
        const known = syncedIDs(owner);
        if (local.status === "fulfilled")
          for (const row of local.value) {
            if (
              cloud.status === "fulfilled" &&
              known.includes(row.id) &&
              !remoteIDs.has(row.id)
            ) {
              await deleteBacktestArchives(
                owner,
                row.id,
                controller.signal,
                active,
              );
              continue;
            }
            rows.set(row.id, { ...row, local: true });
          }
        if (cloud.status === "fulfilled")
          for (const row of cloud.value.items) {
            markSynced(owner, row.id);
            rows.set(row.id, {
              ...rows.get(row.id),
              id: row.id,
              owner_id: owner,
              saved_at: row.data.saved_at,
              title: row.data.title,
              currency: row.data.currency,
              bytes: row.bytes,
              serverVersion: row.version,
            });
          }
        if (active() && !controller.signal.aborted) {
          setItems(
            [...rows.values()].sort((a, b) =>
              b.saved_at.localeCompare(a.saved_at),
            ),
          );
          setError(
            cloud.status === "rejected"
              ? "Server history is unavailable. Showing device copies only; these are not confirmed as synced."
              : local.status === "rejected"
                ? "Device history is unavailable. Server copies are shown."
                : "",
          );
        }
      })
      .catch(() => {
        if (active() && !controller.signal.aborted)
          setError(
            "Local history could not be read. Retry, or clear this account's history if it is damaged.",
          );
      })
      .finally(() => {
        if (active() && !controller.signal.aborted) setLoading(false);
      });
    const change = (event: Event) => {
      if ((event as CustomEvent).detail === owner) setReload((n) => n + 1);
    };
    window.addEventListener(BACKTEST_HISTORY_EVENT, change);
    return () => {
      controller.abort();
      window.removeEventListener(BACKTEST_HISTORY_EVENT, change);
    };
  }, [owner, revision, reload]);
  async function open(id: string) {
    if (busy) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      await api.ensureAppSession();
      const account = await api.account(controller.signal);
      if (
        account.user.id !== owner ||
        account.user.status !== "active" ||
        !account.features.includes("backtest")
      )
        throw Error("Backtesting access is required to open saved results.");
      const archive = items.find((i) => i.id === id)?.local
        ? await loadBacktestArchive(owner, id, controller.signal, active)
        : await downloadArchive(owner, id, controller.signal, active);
      if (active() && !controller.signal.aborted) onOpen(archive);
    } catch (cause) {
      if (active() && !controller.signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "Saved run could not be opened.",
        );
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (active()) setBusy(false);
      }
    }
  }
  async function remove() {
    if (!pending || busy) return;
    const id = pending.id;
    setPending(null);
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      const row = items.find((i) => i.id === id);
      if (id === null || row?.serverVersion || syncedIDs(owner).includes(id))
        await api.deleteRecord(
          "backtest",
          id,
          row?.serverVersion ?? (id ? 1 : 0),
          controller.signal,
        );
      if (!active() || controller.signal.aborted) return;
      await deleteBacktestArchives(owner, id, controller.signal, active);
      if (active()) setReload((n) => n + 1);
    } catch {
      if (active() && !controller.signal.aborted)
        setError(
          "History could not be deleted. Nothing was reported as deleted; retry or check browser storage permissions.",
        );
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (active()) setBusy(false);
      }
    }
  }
  async function sync(id: string) {
    if (busy) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      const archive = await loadBacktestArchive(
        owner,
        id,
        controller.signal,
        active,
      );
      await uploadArchive(archive, controller.signal, active);
      if (active()) setReload((n) => n + 1);
    } catch (e) {
      if (active() && !controller.signal.aborted)
        setError(
          e instanceof Error
            ? e.message
            : "Server sync failed; local copy remains.",
        );
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (active()) setBusy(false);
      }
    }
  }
  return (
    <section className="backtest-panel" aria-labelledby="bt-history-heading">
      <div className="backtest-section-heading">
        <div>
          <h3 id="bt-history-heading">Backtest history</h3>
          <p className="backtest-note">
            Server history syncs across devices for this account: newest 10
            runs, up to 50 MiB (8 MiB per upload). Device-only copies can be
            synced below. Archives are unverified simulations, not recorded
            trades.
          </p>
        </div>
        <div className="backtest-actions">
          <Button
            variant="outline"
            disabled={busy || loading}
            onClick={() => setReload((n) => n + 1)}
          >
            Refresh history
          </Button>
          <Button
            variant="destructive"
            disabled={busy || (items.length === 0 && !error)}
            onClick={(e) => {
              returnFocus.current = e.currentTarget;
              setPending({ id: null });
            }}
          >
            Delete all history
          </Button>
        </div>
      </div>
      {loading && <p role="status">Loading backtest history…</p>}
      {error && (
        <div className="backtest-error">
          <p role="alert">{error}</p>
          <Button variant="outline" onClick={() => setReload((n) => n + 1)}>
            Retry history
          </Button>
        </div>
      )}
      {!loading && !error && !items.length && (
        <p>No saved backtests for this account yet.</p>
      )}
      <ul className="backtest-history-list">
        {items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.title}</strong>
              <span>
                {item.serverVersion ? "Server synced" : "Device only"} ·{" "}
                {new Date(item.saved_at).toLocaleString("en-US", {
                  timeZone: "UTC",
                })}{" "}
                UTC · {item.currency} · {(item.bytes / 1024).toFixed(1)} KiB
              </span>
            </div>
            <div className="backtest-actions">
              {!item.serverVersion && item.local && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void sync(item.id)}
                >
                  Sync to server
                </Button>
              )}
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void open(item.id)}
                aria-label={`Open saved run ${item.title}`}
              >
                Open result
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={(e) => {
                  returnFocus.current = e.currentTarget;
                  setPending({ id: item.id });
                }}
                aria-label={`Delete saved run ${item.title}`}
              >
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={pending !== null}
        title={pending?.id ? "Delete saved backtest?" : "Delete all backtests?"}
        description={
          pending?.id
            ? "This removes the selected archive from server history (if synced) and this browser. Other devices remove their synced cache when history refreshes."
            : "This removes every archive for this account from server history and this browser. Other accounts and the historical candle cache are unaffected. This cannot be undone."
        }
        confirmLabel={
          pending?.id ? "Delete saved backtest" : "Delete all backtests"
        }
        destructive
        returnFocus={returnFocus}
        onCancel={() => setPending(null)}
        onConfirm={() => void remove()}
      />
    </section>
  );
}
