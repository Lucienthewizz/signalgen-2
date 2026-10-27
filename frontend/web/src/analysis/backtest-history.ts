import {
  BACKTEST_POLICY,
  BACKTEST_SCHEMA,
  type BacktestResult,
} from "./backtest-types";

export const BACKTEST_HISTORY_EVENT = "signalgen:backtest-history";
export const BACKTEST_HISTORY_DATABASE = "signalgen-backtest-history-v1";
export const BACKTEST_HISTORY_LIMIT = 10;
export const BACKTEST_HISTORY_BYTES = 50 * 1024 * 1024;

export type BacktestArchive = {
  format_version: 1;
  id: string;
  owner_id: string;
  saved_at: string;
  title: string;
  currency: string;
  source: {
    dataset_id: string;
    version: string;
    checksum: string;
    universe: { id: string; name: string; version: number; symbols: string[] };
    rule?: {
      id: string;
      name: string;
      version: number;
      definition_hash: string;
    };
  };
  result: BacktestResult;
};
export type BacktestArchiveSummary = Pick<
  BacktestArchive,
  "id" | "owner_id" | "saved_at" | "title" | "currency"
> & { bytes: number };
type StoredRun = { id: string; payload: string };

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const count = (v: unknown) => finite(v) && Number.isSafeInteger(v) && v >= 0;
const string = (v: unknown): v is string => typeof v === "string";
const stamp = (v: unknown): v is string =>
  string(v) && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
function tradeMetrics(v: unknown): boolean {
  return (
    record(v) &&
    ["net_pl_cash", "unrealized_pl", "total_commission"].every((k) =>
      finite(v[k]),
    ) &&
    ["closed_trades", "open_trades", "wins", "losses", "flats"].every((k) =>
      count(v[k]),
    ) &&
    [
      "win_rate",
      "profit_factor",
      "expectancy_cash",
      "avg_win_cash",
      "avg_loss_cash",
      "risk_reward",
      "avg_return_pct",
    ].every((k) => v[k] === null || finite(v[k]))
  );
}
export function validBacktestResult(v: unknown): v is BacktestResult {
  if (
    !record(v) ||
    v.schema_version !== BACKTEST_SCHEMA ||
    v.policy_version !== BACKTEST_POLICY ||
    v.execution !== "portable_go_backtest" ||
    !record(v.config)
  )
    return false;
  const c = v.config;
  if (
    !["rule", "manual"].includes(String(c.mode)) ||
    c.timeframe !== "1d" ||
    c.exit_strategy !== "holding_period" ||
    !string(c.from) ||
    !string(c.to) ||
    !/^\d{4}-\d\d-\d\d$/.test(c.from) ||
    !/^\d{4}-\d\d-\d\d$/.test(c.to) ||
    !count(c.n_steps) ||
    Number(c.n_steps) < 1 ||
    Number(c.n_steps) > 100 ||
    !["percent_equity", "fixed_amount"].includes(String(c.position_sizing)) ||
    ![
      "initial_capital",
      "position_size",
      "commission_pct",
      "slippage_pct",
    ].every((k) => finite(c[k]))
  )
    return false;
  if (
    !Array.isArray(v.warnings) ||
    !v.warnings.every(string) ||
    !Array.isArray(v.horizons) ||
    v.horizons.length !== c.n_steps
  )
    return false;
  return v.horizons.every(
    (h, index) =>
      record(h) &&
      h.step === index + 1 &&
      h.label === `T+${index + 1}` &&
      tradeMetrics(h.metrics) &&
      record(h.metrics) &&
      [
        "initial_capital",
        "final_equity",
        "total_return_pct",
        "max_drawdown_pct",
      ].every((k) =>
        finite(h.metrics && (h.metrics as Record<string, unknown>)[k]),
      ) &&
      Array.isArray(h.trades) &&
      Array.isArray(h.skipped) &&
      h.trades.length + h.skipped.length <= 2000 &&
      h.trades.every(
        (t) =>
          record(t) &&
          string(t.symbol) &&
          stamp(t.signal_time) &&
          stamp(t.entry_time) &&
          (t.exit_time === undefined || stamp(t.exit_time)) &&
          ["open", "closed"].includes(String(t.status)) &&
          [
            "quantity",
            "entry_price",
            "entry_commission",
            "exit_commission",
            "net_pl",
            "unrealized_pl",
            "return_pct",
          ].every((k) => finite(t[k])) &&
          (t.exit_price === null || finite(t.exit_price)),
      ) &&
      h.skipped.every(
        (e) =>
          record(e) &&
          string(e.symbol) &&
          stamp(e.timestamp) &&
          e.signal_type === "BUY" &&
          string(e.reason),
      ) &&
      Array.isArray(h.equity_curve) &&
      h.equity_curve.length > 0 &&
      h.equity_curve.length <= 25001 &&
      h.equity_curve.every(
        (p) =>
          record(p) &&
          (p.timestamp === "" || stamp(p.timestamp)) &&
          finite(p.equity),
      ) &&
      Array.isArray(h.by_symbol) &&
      h.by_symbol.length <= 10 &&
      h.by_symbol.every(
        (s) =>
          record(s) &&
          string(s.symbol) &&
          count(s.skipped_entries) &&
          tradeMetrics(s),
      ),
  );
}
function validSummary(v: unknown): v is BacktestArchiveSummary {
  return (
    record(v) &&
    string(v.id) &&
    string(v.owner_id) &&
    stamp(v.saved_at) &&
    string(v.title) &&
    ["USD", "IDR"].includes(String(v.currency)) &&
    count(v.bytes)
  );
}
export function validArchive(v: unknown): v is BacktestArchive {
  if (
    !record(v) ||
    v.format_version !== 1 ||
    !validSummary({ ...v, bytes: 0 }) ||
    !record(v.source) ||
    !validBacktestResult(v.result)
  )
    return false;
  const s = v.source,
    u = s.universe,
    r = s.rule;
  return (
    [s.dataset_id, s.version, s.checksum].every(string) &&
    record(u) &&
    [u.id, u.name].every(string) &&
    count(u.version) &&
    Array.isArray(u.symbols) &&
    u.symbols.length <= 10 &&
    u.symbols.every(string) &&
    (r === undefined ||
      (record(r) &&
        [r.id, r.name, r.definition_hash].every(string) &&
        count(r.version)))
  );
}

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BACKTEST_HISTORY_DATABASE, 1);
    let expired = false;
    const fail = (error: unknown) => {
      expired = true;
      clearTimeout(timeout);
      reject(error);
    };
    const timeout = setTimeout(
      () =>
        fail(
          Error("Local history storage timed out. Close other tabs and retry."),
        ),
      3000,
    );
    request.onblocked = () =>
      fail(Error("Local history storage is blocked by another tab."));
    request.onerror = () => fail(request.error);
    request.onupgradeneeded = () => {
      const summaries = request.result.createObjectStore("summaries", {
        keyPath: "id",
      });
      summaries.createIndex("owner", "owner_id");
      request.result.createObjectStore("runs", { keyPath: "id" });
    };
    request.onsuccess = () => {
      clearTimeout(timeout);
      if (expired) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
// Commit is the success boundary; a quota error must roll back pruning as well.
async function transaction<T>(
  mode: IDBTransactionMode,
  signal: AbortSignal,
  active: () => boolean,
  work: (tx: IDBTransaction, done: (value: T) => void) => void,
): Promise<T> {
  signal.throwIfAborted();
  const db = await database();
  try {
    signal.throwIfAborted();
    if (!active()) throw new DOMException("Account changed", "AbortError");
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(["summaries", "runs"], mode);
      let value: T;
      const abort = () => {
        try {
          tx.abort();
        } catch {
          /* Already committed. */
        }
      };
      signal.addEventListener("abort", abort, { once: true });
      tx.oncomplete = () => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      };
      tx.onabort = () => {
        signal.removeEventListener("abort", abort);
        reject(
          signal.aborted
            ? signal.reason
            : (tx.error ?? Error("Local history transaction aborted.")),
        );
      };
      tx.onerror = () => {};
      try {
        work(tx, (next) => {
          value = next;
        });
      } catch (error) {
        abort();
        reject(error);
      }
    });
  } finally {
    db.close();
  }
}
function notify(owner: string) {
  window.dispatchEvent(
    new CustomEvent(BACKTEST_HISTORY_EVENT, { detail: owner }),
  );
}

export async function saveBacktestArchive(
  archive: BacktestArchive,
  signal: AbortSignal,
  active: () => boolean,
): Promise<void> {
  if (!validArchive(archive))
    throw Error(
      "The result cannot be archived: incompatible or invalid result. Refresh the app and WASM assets.",
    );
  const payload = JSON.stringify(archive),
    bytes = new TextEncoder().encode(payload).byteLength;
  if (bytes > BACKTEST_HISTORY_BYTES)
    throw Error(
      "This run exceeds the 50 MiB history limit. Export CSV while it remains on screen.",
    );
  const summary: BacktestArchiveSummary = {
    id: archive.id,
    owner_id: archive.owner_id,
    saved_at: archive.saved_at,
    title: archive.title,
    currency: archive.currency,
    bytes,
  };
  await transaction<void>("readwrite", signal, active, (tx) => {
    const store = tx.objectStore("summaries");
    const existing = store.get(archive.id);
    existing.onsuccess = () => {
      if (existing.result && existing.result.owner_id !== archive.owner_id)
        tx.abort();
    };
    const request = store.index("owner").getAll(archive.owner_id);
    request.onsuccess = () => {
      try {
        if (!active() || signal.aborted) {
          tx.abort();
          return;
        }
        const previous = request.result.filter(
          (r: BacktestArchiveSummary) => r.id !== archive.id,
        );
        if (!previous.every(validSummary)) {
          tx.abort();
          return;
        }
        // Reserve space for the new run even if the user's clock moved backwards.
        const all = [...previous].sort(
          (a, b) =>
            a.saved_at.localeCompare(b.saved_at) || a.id.localeCompare(b.id),
        );
        let total =
            bytes +
            previous.reduce(
              (n: number, r: BacktestArchiveSummary) => n + r.bytes,
              0,
            ),
          kept = previous.length + 1;
        for (const item of all) {
          if (kept <= BACKTEST_HISTORY_LIMIT && total <= BACKTEST_HISTORY_BYTES)
            break;
          store.delete(item.id);
          tx.objectStore("runs").delete(item.id);
          total -= item.bytes;
          kept--;
        }
        store.put(summary);
        tx.objectStore("runs").put({
          id: archive.id,
          payload,
        } satisfies StoredRun);
      } catch {
        tx.abort();
      }
    };
  });
  if (active() && !signal.aborted) notify(archive.owner_id);
}
export async function listBacktestArchives(
  owner: string,
  signal: AbortSignal,
  active: () => boolean,
): Promise<BacktestArchiveSummary[]> {
  return transaction("readonly", signal, active, (tx, done) => {
    const request = tx.objectStore("summaries").index("owner").getAll(owner);
    request.onsuccess = () => {
      if (!request.result.every(validSummary)) {
        tx.abort();
        return;
      }
      done(
        request.result.sort(
          (a: BacktestArchiveSummary, b: BacktestArchiveSummary) =>
            b.saved_at.localeCompare(a.saved_at) || b.id.localeCompare(a.id),
        ),
      );
    };
  });
}
export async function loadBacktestArchive(
  owner: string,
  id: string,
  signal: AbortSignal,
  active: () => boolean,
): Promise<BacktestArchive> {
  const value = await transaction<unknown>(
    "readonly",
    signal,
    active,
    (tx, done) => {
      const summary = tx.objectStore("summaries").get(id);
      summary.onsuccess = () => {
        if (
          !validSummary(summary.result) ||
          summary.result.owner_id !== owner
        ) {
          tx.abort();
          return;
        }
        const run = tx.objectStore("runs").get(id);
        run.onsuccess = () => done(run.result);
      };
    },
  );
  if (
    !record(value) ||
    !string(value.payload) ||
    value.payload.length > BACKTEST_HISTORY_BYTES
  )
    throw Error(
      "Saved run is missing or damaged. You can delete it and run a new backtest.",
    );
  let archive: unknown;
  try {
    archive = JSON.parse(value.payload);
  } catch {
    throw Error("Saved run is damaged. Delete it and run a new backtest.");
  }
  if (!validArchive(archive) || archive.owner_id !== owner || archive.id !== id)
    throw Error(
      "Saved run is incompatible or damaged. Refresh the app or delete this archive.",
    );
  return archive;
}
export async function deleteBacktestArchives(
  owner: string,
  id: string | null,
  signal: AbortSignal,
  active: () => boolean,
): Promise<void> {
  await transaction<void>("readwrite", signal, active, (tx) => {
    const store = tx.objectStore("summaries"),
      request = store.index("owner").getAllKeys(owner);
    request.onsuccess = () => {
      if (!active() || signal.aborted) {
        tx.abort();
        return;
      }
      for (const key of request.result) {
        if (id === null || key === id) {
          store.delete(key);
          tx.objectStore("runs").delete(key);
        }
      }
    };
  });
  if (active() && !signal.aborted) notify(owner);
}
