import type {
  StudyEvent,
  StudyOutcome,
  StudyResult,
} from "./signal-study-types";

const DB = "signalgen-study-temporary-1";
export const STUDY_STORAGE_LIMIT = 128 * 1024 * 1024;
const bases = ["open", "high", "close", "low", "barrier"];
const statuses = [
  "evaluated",
  "incomplete",
  "time_exit",
  "stop_loss",
  "take_profit",
  "screened",
];
type CompactOutcome = [
  number,
  number,
  number,
  number | null,
  number | null,
  string?,
];
type CompactEvent = [
  string,
  "BUY" | "SELL",
  number,
  CompactOutcome[],
  CompactOutcome,
];
const compactOutcome = (o: StudyOutcome): CompactOutcome => [
  bases.indexOf(o.basis),
  o.step,
  statuses.indexOf(o.status),
  o.price,
  o.return_pct,
  o.timestamp,
];
const expandOutcome = (o: CompactOutcome): StudyOutcome => ({
  basis: bases[o[0]],
  step: o[1],
  status: statuses[o[2]],
  price: o[3],
  return_pct: o[4],
  ...(o[5] ? { timestamp: o[5] } : {}),
});
type Stored = {
  key: string;
  owner: string;
  run: string;
  symbol: string;
  bytes: number;
  events: CompactEvent[];
};
const prefix = (owner: string, run: string) => `${owner}\0${run}\0`;
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      if (r.result.objectStoreNames.contains("batches"))
        r.result.deleteObjectStore("batches");
      if (r.result.objectStoreNames.contains("sizes"))
        r.result.deleteObjectStore("sizes");
      r.result.createObjectStore("batches", { keyPath: "key" });
      r.result.createObjectStore("sizes");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = r.onblocked = () =>
      reject(
        Error(
          "Temporary result storage is unavailable. Enable browser storage and retry.",
        ),
      );
  });
}
export async function storeStudySymbol(
  owner: string,
  run: string,
  symbol: string,
  result: StudyResult,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const db = await open();
  try {
    signal.throwIfAborted();
    // Compact tuples retain exact numbers, all horizons and statuses without
    // repeating verbose object keys/summary tables for every market member.
    const events: CompactEvent[] = result.events.map((e) => [
      e.timestamp,
      e.signal_type,
      e.reference_price,
      e.outcomes.map(compactOutcome),
      compactOutcome(e.swing),
    ]);
    const bytes = new TextEncoder().encode(JSON.stringify(events)).length;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["batches", "sizes"], "readwrite");
      const cancel = () => tx.abort();
      signal.addEventListener("abort", cancel, { once: true });
      const key = prefix(owner, run) + symbol;
      let failure =
        "Temporary storage failed. Existing results remain available for CSV export.";
      const sizes = tx.objectStore("sizes"),
        batches = tx.objectStore("batches");
      const a = sizes.get(owner),
        b = batches.get(key);
      a.onsuccess = b.onsuccess = () => {
        if (a.readyState !== "done" || b.readyState !== "done") return;
        const total =
          Number(a.result ?? 0) - Number(b.result?.bytes ?? 0) + bytes;
        if (total > STUDY_STORAGE_LIMIT) {
          failure =
            "Temporary study results reached 128 MiB. Export the partial results before starting a shorter run.";
          tx.abort();
          return;
        }
        batches.put({
          key,
          owner,
          run,
          symbol,
          bytes,
          events,
        } satisfies Stored);
        sizes.put(total, owner);
      };
      tx.oncomplete = () => {
        signal.removeEventListener("abort", cancel);
        resolve();
      };
      tx.onerror = tx.onabort = () => {
        signal.removeEventListener("abort", cancel);
        reject(
          signal.aborted
            ? new DOMException("Cancelled", "AbortError")
            : Error(failure),
        );
      };
    });
  } finally {
    db.close();
  }
}
// Cursor reads keep the full market out of React state and never use getAll().
export async function studyEventPage(
  owner: string,
  run: string,
  page = 0,
  size = 50,
): Promise<{ rows: StudyEvent[]; total: number }> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const p = prefix(owner, run),
        rows: StudyEvent[] = [];
      let total = 0;
      const tx = db.transaction("batches", "readonly");
      const req = tx
        .objectStore("batches")
        .openCursor(IDBKeyRange.bound(p, p + "\uffff"));
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const item = cursor.value as Stored;
        for (const event of item.events) {
          if (total >= page * size && rows.length < size)
            rows.push({
              symbol: item.symbol,
              timestamp: event[0],
              signal_type: event[1],
              reference_price: event[2],
              outcomes: event[3].map(expandOutcome),
              swing: expandOutcome(event[4]),
            });
          total++;
        }
        cursor.continue();
      };
      tx.oncomplete = () => resolve({ rows, total });
      tx.onerror = () => reject(Error("Could not read study results."));
    });
  } finally {
    db.close();
  }
}
export async function clearStudyOwner(owner: string) {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["batches", "sizes"], "readwrite"),
        p = owner + "\0";
      const req = tx
        .objectStore("batches")
        .openCursor(IDBKeyRange.bound(p, p + "\uffff"));
      req.onsuccess = () => {
        const c = req.result;
        if (c) {
          c.delete();
          c.continue();
        }
      };
      tx.objectStore("sizes").delete(owner);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(Error("Could not clear temporary study results."));
    });
  } finally {
    db.close();
  }
}

// Identity changes clear temporary derived results in every tab, just like the
// historical cache. No result from a previous browser session is retained.
export async function clearAllStudyResults() {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["batches", "sizes"], "readwrite");
      tx.objectStore("batches").clear();
      tx.objectStore("sizes").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () =>
        reject(Error("Could not clear temporary study results."));
    });
  } finally {
    db.close();
  }
}
