import type { DatasetContent, DatasetManifest } from "../types";

/** Only historical OHLCV is persisted here. Tokens and private rules never enter this codec. */
export const MAX_DATASET_BYTES = 4 * 1024 * 1024;
export const CACHE_FORMAT = "ohlcv-gzip-aes256gcm-1";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export type CacheBinding = {
  scope: string;
  datasetId: string;
  version: string;
  schema: string;
  checksum: string;
  decodedBytes: number;
  expiresAt: number;
};
export type EncryptedSnapshot = {
  id: string;
  scope: string;
  format: typeof CACHE_FORMAT;
  binding: CacheBinding;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
  createdAt: number;
};

export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw Error(
      "Enkripsi browser memerlukan HTTPS atau localhost yang mendukung Web Crypto.",
    );
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Authenticate all isolation/version fields, including expiry, not just the ciphertext. */
function additionalData(binding: CacheBinding): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    JSON.stringify([
      CACHE_FORMAT,
      binding.scope,
      binding.datasetId,
      binding.version,
      binding.schema,
      binding.checksum,
      binding.decodedBytes,
      binding.expiresAt,
    ]),
  );
}

export function newCacheKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function sealSnapshot(
  id: string,
  binding: CacheBinding,
  key: CryptoKey,
  plaintext: Uint8Array<ArrayBuffer>,
): Promise<EncryptedSnapshot> {
  // Compression precedes encryption. Never reuse a nonce with the same key.
  const compressed = await collect(
    new Blob([plaintext]).stream().pipeThrough(new CompressionStream("gzip")),
    MAX_DATASET_BYTES,
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  try {
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: additionalData(binding),
        tagLength: 128,
      },
      key,
      compressed,
    );
    return {
      id,
      scope: binding.scope,
      format: CACHE_FORMAT,
      binding,
      iv,
      ciphertext,
      createdAt: Date.now(),
    };
  } finally {
    compressed.fill(0);
  }
}

export async function openSnapshot(
  record: EncryptedSnapshot,
  expected: CacheBinding,
  key: CryptoKey,
): Promise<Uint8Array<ArrayBuffer>> {
  if (
    record.format !== CACHE_FORMAT ||
    record.iv.byteLength !== 12 ||
    JSON.stringify(record.binding) !== JSON.stringify(expected)
  )
    throw Error("Cache metadata mismatch");
  const compressed = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: record.iv,
        additionalData: additionalData(expected),
        tagLength: 128,
      },
      key,
      record.ciphertext,
    ),
  );
  try {
    return await collect(
      new Blob([compressed])
        .stream()
        .pipeThrough(new DecompressionStream("gzip")),
      MAX_DATASET_BYTES,
    );
  } finally {
    compressed.fill(0);
  }
}

/** Limit decompressed bytes too: a corrupt/local record must not allocate an unbounded buffer. */
async function collect(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw Error("Dataset too large");
      }
      chunks.push(value);
    }
    const output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    reader.releaseLock();
  }
}

/** Validate raw bytes against the ONLINE authoritative manifest before compute or persistence. */
export async function decodeDataset(
  bytes: Uint8Array<ArrayBuffer>,
  manifest: DatasetManifest,
): Promise<DatasetContent> {
  if (
    !bytes.byteLength ||
    bytes.byteLength > MAX_DATASET_BYTES ||
    bytes.byteLength !== manifest.decoded_bytes ||
    `sha256:${await sha256(bytes)}` !== manifest.checksum
  )
    throw Error(
      "Checksum/ukuran snapshot tidak cocok. Jalankan ulang analisis.",
    );
  const data: DatasetContent = JSON.parse(decoder.decode(bytes));
  if (
    data.schema_version !== manifest.schema_version ||
    data.purpose !== manifest.purpose ||
    data.market !== manifest.market ||
    data.currency !== manifest.currency ||
    data.timeframe !== manifest.timeframe ||
    data.timezone !== manifest.timezone ||
    data.adjustment !== manifest.adjustment ||
    !Array.isArray(data.series) ||
    data.series.length < 1 ||
    data.series.length > 10 ||
    data.series.length !== manifest.symbols.length
  )
    throw Error("Schema snapshot tidak cocok.");
  let candleCount = 0;
  for (const [index, series] of data.series.entries()) {
    if (
      series.symbol !== manifest.symbols[index] ||
      series.timezone !== "UTC" ||
      !Array.isArray(series.candles) ||
      !series.candles.length ||
      series.candles.length > 1000
    )
      throw Error("Series snapshot tidak valid.");
    let previous = -Infinity;
    for (const candle of series.candles) {
      const time = Date.parse(candle.timestamp);
      if (
        !Number.isFinite(time) ||
        time <= previous ||
        ![
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.volume,
        ].every(Number.isFinite) ||
        candle.low < 0 ||
        candle.volume < 0 ||
        candle.low > Math.min(candle.open, candle.close) ||
        candle.high < Math.max(candle.open, candle.close)
      )
        throw Error("Candle snapshot tidak valid.");
      previous = time;
    }
    candleCount += series.candles.length;
  }
  if (candleCount !== manifest.candle_count)
    throw Error("Jumlah candle snapshot tidak cocok.");
  return data;
}
