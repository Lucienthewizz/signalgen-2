import { newCacheKey, type EncryptedSnapshot } from "./historical-crypto";

export type CacheLease = { epoch: string; key: CryptoKey };
export interface HistoricalStore {
  begin(scope: string, active: () => boolean): Promise<CacheLease>;
  read(id: string): Promise<EncryptedSnapshot | undefined>;
  write(epoch: string, record: EncryptedSnapshot): Promise<void>;
  current(epoch: string): Promise<boolean>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  stats(scope: string): Promise<{ entries: number; bytes: number }>;
}

const DATABASE = "signalgen-historical-cache-v1";
const MAX_ENTRIES = 32;
const MAX_BYTES = 16 * 1024 * 1024;

/** Dedicated database: clearing it cannot delete auth, preferences, rules or journals. */
export class IndexedHistoricalStore implements HistoricalStore {
  private async database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      // Do not leave a blocked upgrade/open hanging forever in another tab.
      let expired = false;
      const timeout = setTimeout(() => {
        expired = true;
        reject(Error("Cache storage timeout"));
      }, 3000);
      request.onblocked = () => {
        expired = true;
        clearTimeout(timeout);
        reject(Error("Cache storage blocked"));
      };
      request.onupgradeneeded = () => {
        request.result.createObjectStore("keys");
        request.result.createObjectStore("snapshots", { keyPath: "id" });
        request.result.createObjectStore("meta");
      };
      request.onerror = () => {
        clearTimeout(timeout);
        reject(request.error);
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

  /** Resolve on COMMIT, not request success, so quota/abort errors are observable. */
  private async transaction<T>(
    stores: string[],
    mode: IDBTransactionMode,
    work: (tx: IDBTransaction, result: (value: T) => void) => void,
  ): Promise<T> {
    const db = await this.database();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        let value: T;
        tx.oncomplete = () => resolve(value);
        tx.onabort = () =>
          reject(tx.error ?? Error("Cache transaction aborted"));
        tx.onerror = () => {
          /* onabort reports failed commits. */
        };
        try {
          work(tx, (next) => {
            value = next;
          });
        } catch (error) {
          tx.abort();
          reject(error);
        }
      });
    } finally {
      db.close();
    }
  }

  async begin(scope: string, active: () => boolean): Promise<CacheLease> {
    const expectedEpoch = await this.transaction<string>(
      ["meta"],
      "readwrite",
      (tx, done) => {
        if (!active()) {
          tx.abort();
          return;
        }
        const store = tx.objectStore("meta");
        const request = store.get("epoch");
        request.onsuccess = () => {
          const epoch = request.result ?? crypto.randomUUID();
          if (!request.result) store.put(epoch, "epoch");
          done(epoch);
        };
      },
    );
    const candidate = await newCacheKey();
    return this.transaction(["meta", "keys"], "readwrite", (tx, done) => {
      const meta = tx.objectStore("meta");
      const epoch = meta.get("epoch");
      epoch.onsuccess = () => {
        if (!active() || epoch.result !== expectedEpoch) {
          tx.abort();
          return;
        }
        const keys = tx.objectStore("keys");
        const request = keys.get(scope);
        request.onsuccess = () => {
          if (!active()) {
            tx.abort();
            return;
          }
          const key: CryptoKey = request.result ?? candidate;
          if (!request.result) keys.put(key, scope);
          done({ epoch: expectedEpoch, key });
        };
      };
    });
  }

  read(id: string): Promise<EncryptedSnapshot | undefined> {
    return this.transaction(["snapshots"], "readonly", (tx, done) => {
      const request = tx.objectStore("snapshots").get(id);
      request.onsuccess = () => done(request.result);
    });
  }

  write(epoch: string, record: EncryptedSnapshot): Promise<void> {
    return this.transaction(["meta", "snapshots"], "readwrite", (tx) => {
      const guard = tx.objectStore("meta").get("epoch");
      guard.onsuccess = () => {
        // A clear/logout in ANY tab invalidates an encryption job already in flight.
        if (guard.result !== epoch) return;
        const store = tx.objectStore("snapshots");
        const request = store.getAll();
        request.onsuccess = () => {
          const records = (request.result as EncryptedSnapshot[])
            .filter((item) => {
              if (
                item.id === record.id ||
                item.binding.expiresAt <= Date.now()
              ) {
                store.delete(item.id);
                return false;
              }
              return true;
            })
            .sort((a, b) => a.createdAt - b.createdAt);
          let bytes = records.reduce(
            (sum, item) => sum + item.ciphertext.byteLength,
            record.ciphertext.byteLength,
          );
          while (records.length >= MAX_ENTRIES || bytes > MAX_BYTES) {
            const oldest = records.shift();
            if (!oldest) return;
            bytes -= oldest.ciphertext.byteLength;
            store.delete(oldest.id);
          }
          store.put(record);
        };
      };
    });
  }

  current(epoch: string): Promise<boolean> {
    return this.transaction(["meta"], "readonly", (tx, done) => {
      const request = tx.objectStore("meta").get("epoch");
      request.onsuccess = () => done(request.result === epoch);
    });
  }
  remove(id: string): Promise<void> {
    return this.transaction(["snapshots"], "readwrite", (tx) => {
      tx.objectStore("snapshots").delete(id);
    });
  }
  clear(): Promise<void> {
    return this.transaction(
      ["meta", "keys", "snapshots"],
      "readwrite",
      (tx) => {
        tx.objectStore("keys").clear();
        tx.objectStore("snapshots").clear();
        tx.objectStore("meta").put(crypto.randomUUID(), "epoch");
      },
    );
  }
  stats(scope: string): Promise<{ entries: number; bytes: number }> {
    return this.transaction(["snapshots"], "readwrite", (tx, done) => {
      const store = tx.objectStore("snapshots");
      const request = store.getAll();
      request.onsuccess = () => {
        const active = (request.result as EncryptedSnapshot[]).filter(
          (item) => {
            if (item.binding.expiresAt <= Date.now()) {
              store.delete(item.id);
              return false;
            }
            return item.scope === scope;
          },
        );
        done({
          entries: active.length,
          bytes: active.reduce(
            (sum, item) => sum + item.ciphertext.byteLength,
            0,
          ),
        });
      };
    });
  }
}
