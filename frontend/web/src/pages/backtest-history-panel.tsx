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
  type BacktestArchiveSummary,
} from "@/analysis/backtest-history";

export function BacktestHistoryPanel({
  owner,
  revision,
  onOpen,
}: {
  owner: string;
  revision: number;
  onOpen: (archive: BacktestArchive) => void;
}) {
  const [items, setItems] = useState<BacktestArchiveSummary[]>([]),
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
    listBacktestArchives(owner, controller.signal, active)
      .then((rows) => {
        if (active() && !controller.signal.aborted) {
          setItems(rows);
          setError("");
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
      const archive = await loadBacktestArchive(
        owner,
        id,
        controller.signal,
        active,
      );
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
      await deleteBacktestArchives(owner, id, controller.signal, active);
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
  return (
    <section className="backtest-panel" aria-labelledby="bt-history-heading">
      <div className="backtest-section-heading">
        <div>
          <h3 id="bt-history-heading">Local backtest history</h3>
          <p className="backtest-note">
            This browser · this account · newest 10 runs, up to 50 MiB. Saved
            results remain after sign out.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy || (items.length === 0 && !error)}
          onClick={(e) => {
            returnFocus.current = e.currentTarget;
            setPending({ id: null });
          }}
        >
          Delete all history
        </Button>
      </div>
      {loading && <p role="status">Loading local history…</p>}
      {error && (
        <div className="backtest-error">
          <p role="alert">{error}</p>
          <Button variant="outline" onClick={() => setReload((n) => n + 1)}>
            Retry history
          </Button>
        </div>
      )}
      {!loading && !error && !items.length && (
        <p>No saved backtests on this browser yet.</p>
      )}
      <ul className="backtest-history-list">
        {items.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.title}</strong>
              <span>
                {new Date(item.saved_at).toLocaleString("en-US", {
                  timeZone: "UTC",
                })}{" "}
                UTC · {item.currency} · {(item.bytes / 1024).toFixed(1)} KiB
              </span>
            </div>
            <div className="backtest-actions">
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
        title={
          pending?.id ? "Delete saved backtest?" : "Delete all local backtests?"
        }
        description={
          pending?.id
            ? "This removes the selected archive from this browser. The result currently on screen remains available until you close it."
            : "This removes every backtest archive for this account on this browser. Other accounts and the historical data cache are unaffected."
        }
        confirmLabel={
          pending?.id ? "Delete saved backtest" : "Delete all local backtests"
        }
        destructive
        returnFocus={returnFocus}
        onCancel={() => setPending(null)}
        onConfirm={() => void remove()}
      />
    </section>
  );
}
