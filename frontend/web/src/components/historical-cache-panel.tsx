import { useEffect, useState } from "react";
import { Database, Trash2 } from "lucide-react";
import { api, session } from "../api/client";
import { historicalCache, historicalScope } from "../data/historical-cache";
import { clearHistoricalCache } from "../data/historical-lifecycle";
import { Button } from "./ui/button";

/** Real ciphertext counts, not the previous mock "14.8 MB encrypted" status. */
export function HistoricalCachePanel({
  authenticated,
}: {
  authenticated: boolean;
}) {
  const [message, setMessage] = useState("Checking storage…");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (!authenticated) {
      setMessage("Sign in to inspect historical data storage.");
      return;
    }
    void api
      .me()
      .then(async (user) => {
        const revision = session.getIdentityRevision();
        const scope = await historicalScope(
          session.getApiOrigin(),
          user.id,
          session.getInstallationId(),
        );
        const stats = await historicalCache.stats(scope);
        if (!active || revision !== session.getIdentityRevision()) return;
        setMessage(
          stats.available
            ? `${stats.entries} snapshot · ${(stats.bytes / 1024).toFixed(1)} KB ciphertext · AES-256-GCM`
            : "Persistent cache unavailable · data stays in memory for this run",
        );
      })
      .catch(() => {
        if (active)
          setMessage("Cache status could not be checked. Reload to retry.");
      });
    return () => {
      active = false;
    };
  }, [authenticated]);

  async function clear() {
    setBusy(true);
    try {
      await clearHistoricalCache();
      setMessage("Empty · local snapshots and encryption keys removed");
    } catch {
      setMessage("Could not clear the cache. Close other tabs and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel cache-panel historical-cache-panel">
      <div>
        <Database />
        <span>
          <strong>Encrypted historical cache</strong>
          <small role="status">{message}</small>
        </span>
      </div>
      <Button
        className="ui-button"
        disabled={busy || !authenticated}
        onClick={() => void clear()}
      >
        <Trash2 />
        {busy ? "Clearing…" : "Clear cache"}
      </Button>
    </section>
  );
}
