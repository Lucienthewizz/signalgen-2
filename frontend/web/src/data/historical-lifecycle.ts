import { session } from "../api/client";
import { disposeScreenerEngine } from "../analysis/screener-engine";
import {
  historicalCache,
  CACHE_RESET_EVENT,
  CACHE_RESET_STORAGE,
} from "./historical-cache";

/** No tokens, prices or key material are broadcast. Other tabs discard in-flight work too. */
export function clearHistoricalCache(broadcast = true): Promise<void> {
  disposeScreenerEngine();
  const cleared = historicalCache.clear();
  window.dispatchEvent(new Event(CACHE_RESET_EVENT));
  if (broadcast) {
    try {
      localStorage.setItem(CACHE_RESET_STORAGE, crypto.randomUUID());
    } catch {
      /* IndexedDB epoch still guards stale commits. */
    }
  }
  return cleared;
}

export function startHistoricalCacheLifecycle(): () => void {
  const stop = session.onIdentityChange(() => {
    // Invalid auth, revoke, account switch and deliberate logout use this same path.
    void clearHistoricalCache().catch(() => {
      /* UI stats reports storage unavailable. Never persist plaintext instead. */
    });
  });
  const otherTab = (event: StorageEvent) => {
    if (event.key === CACHE_RESET_STORAGE)
      void clearHistoricalCache(false).catch(() => {});
  };
  window.addEventListener("storage", otherTab);
  return () => {
    stop();
    window.removeEventListener("storage", otherTab);
  };
}
