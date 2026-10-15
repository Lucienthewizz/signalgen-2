import type { DatasetContent, DatasetManifest } from "../types";
import {
  decodeDataset,
  openSnapshot,
  sealSnapshot,
  sha256,
  type CacheBinding,
} from "./historical-crypto";
import {
  IndexedHistoricalStore,
  type CacheLease,
  type HistoricalStore,
} from "./historical-store";

const TTL = 15 * 60 * 1000;
const encoder = new TextEncoder();
export const CACHE_RESET_EVENT = "signalgen:historical-cache-reset";
export const CACHE_RESET_STORAGE = "signalgen.historical-cache-reset";

export function historicalScope(
  origin: string,
  userId: string,
  installationId: string,
): Promise<string> {
  return sha256(
    encoder.encode(JSON.stringify([origin, userId, installationId])),
  );
}

/** A disposable optimization, NEVER an offline authorization database. */
export class HistoricalCache {
  private revision = 0;
  private cleanup: Promise<void> = Promise.resolve();
  private available = true;
  constructor(private readonly store: HistoricalStore) {}

  async load(
    scope: string,
    manifest: DatasetManifest,
    fetchText: () => Promise<string>,
    signal: AbortSignal,
  ): Promise<DatasetContent> {
    const revision = this.revision;
    const guard = () => {
      signal.throwIfAborted();
      if (revision !== this.revision)
        throw new DOMException("Cache/session changed", "AbortError");
    };
    let storageReady = true;
    try {
      await this.cleanup;
    } catch {
      storageReady = false;
      this.available = false;
    }
    guard();
    const serverExpiry = manifest.expires_at
      ? Date.parse(manifest.expires_at)
      : Date.now() + TTL;
    if (!Number.isFinite(serverExpiry) || serverExpiry <= Date.now())
      throw Error("Snapshot kedaluwarsa. Jalankan ulang analisis.");
    const id = await sha256(
      encoder.encode(
        JSON.stringify([
          scope,
          manifest.dataset_id,
          manifest.version,
          manifest.schema_version,
          manifest.checksum,
        ]),
      ),
    );
    const binding = (expiresAt: number): CacheBinding => ({
      scope,
      datasetId: manifest.dataset_id,
      version: manifest.version,
      schema: manifest.schema_version,
      checksum: manifest.checksum,
      decodedBytes: manifest.decoded_bytes,
      expiresAt,
    });
    let lease: CacheLease | undefined;
    try {
      if (!storageReady) throw Error("Cache cleanup pending/failed");
      lease = await this.store.begin(
        scope,
        () => revision === this.revision && !signal.aborted,
      );
      const record = await this.store.read(id);
      guard();
      if (record) {
        let plaintext: Uint8Array<ArrayBuffer> | undefined;
        try {
          if (
            record.binding.expiresAt <= Date.now() ||
            record.binding.expiresAt > serverExpiry ||
            record.binding.expiresAt > record.createdAt + TTL
          )
            throw Error("Cache expired");
          plaintext = await openSnapshot(
            record,
            binding(record.binding.expiresAt),
            lease.key,
          );
          const data = await decodeDataset(plaintext, manifest);
          guard();
          if (!(await this.store.current(lease.epoch)))
            throw Error("Cache cleared");
          guard();
          return data;
        } catch {
          guard();
          await this.store.remove(id); // Corruption is a cache miss, not a false No match.
        } finally {
          plaintext?.fill(0);
        }
      }
      this.available = true;
    } catch (error) {
      guard();
      if (error instanceof DOMException && error.name === "AbortError")
        throw error;
      this.available = false;
      lease = undefined;
    }
    guard();
    const bytes = encoder.encode(await fetchText());
    try {
      guard();
      // Network checksum failures stop the run; never silently trust/store altered bytes.
      const data = await decodeDataset(bytes, manifest);
      guard();
      if (lease) {
        try {
          const record = await sealSnapshot(
            id,
            binding(Math.min(serverExpiry, Date.now() + TTL)),
            lease.key,
            bytes,
          );
          guard();
          await this.store.write(lease.epoch, record);
        } catch {
          guard();
          this.available = false;
        }
      }
      guard();
      return data;
    } finally {
      bytes.fill(0);
    }
  }

  /** Invalidate synchronously first, then commit deletion. Late async writes cannot resurrect keys/data. */
  clear(): Promise<void> {
    this.revision++;
    this.cleanup = this.cleanup
      .catch(() => {})
      .then(() => this.store.clear())
      .then(() => {
        this.available = true;
      });
    return this.cleanup;
  }
  async stats(scope: string) {
    try {
      await this.cleanup;
      const stats = await this.store.stats(scope);
      return { ...stats, available: this.available };
    } catch {
      return { entries: 0, bytes: 0, available: false };
    }
  }
}

export const historicalCache = new HistoricalCache(
  new IndexedHistoricalStore(),
);
