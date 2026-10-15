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
  const [message, setMessage] = useState("Memeriksa penyimpanan…");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (!authenticated) {
      setMessage("Masuk untuk melihat cache historis.");
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
            : "Cache tidak tersedia · data hanya di memori untuk run ini",
        );
      })
      .catch(() => {
        if (active) setMessage("Status cache belum dapat diperiksa.");
      });
    return () => {
      active = false;
    };
  }, [authenticated]);

  async function clear() {
    setBusy(true);
    try {
      await clearHistoricalCache();
      setMessage("Kosong · snapshot dan kunci lokal sudah dihapus");
    } catch {
      setMessage("Belum dapat menghapus cache. Tutup tab lain lalu coba lagi.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel cache-panel historical-cache-panel">
      <div>
        <Database />
        <span>
          <strong>Cache historis terenkripsi</strong>
          <small role="status">{message}</small>
        </span>
      </div>
      <Button
        className="ui-button"
        disabled={busy || !authenticated}
        onClick={() => void clear()}
      >
        <Trash2 />
        {busy ? "Menghapus…" : "Hapus cache"}
      </Button>
    </section>
  );
}
