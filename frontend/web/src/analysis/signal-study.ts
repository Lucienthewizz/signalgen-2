import { api, session, ApiError } from "@/api/client";
import { SignalStudyEngine } from "./signal-study-engine";
import { storeStudySymbol } from "./signal-study-storage";
import {
  STUDY_POLICY,
  STUDY_SCHEMA,
  emptyStudyMetrics,
  mergeStudyMetrics,
  type StudyInput,
  type StudyContext,
  type StudyMetrics,
  type StudyResult,
  type StudyManifest,
  type StudyEntry,
} from "./signal-study-types";
import type { BacktestDataset } from "./backtest-types";

export type StudyProgress = {
  waitingUntil?: number;
  context: StudyContext;
  completed: number;
  remaining: number;
  failures: Array<{
    symbol: string;
    code: string;
    retryable: boolean;
    batch: number;
  }>;
  failedBatches: number[];
  pendingBatches: number[];
  batchStocks: Record<number, string[]>;
  processed: string[];
  horizons: StudyResult["horizons"];
  swing: StudyMetrics;
  bySymbol: StudyResult["by_symbol"];
  byDay: StudyResult["by_day"];
  traffic: { decoded_candle_bytes: number; candidate_json_bytes: number };
  timings: {
    access_ms: number;
    startup_ms: number;
    grant_ms: number;
    prepare_ms: number;
    transfer_ms: number;
    features_ms: number;
    scoring_ms: number;
    study_ms: number;
    storage_ms: number;
  };
};

// Retry only explicit admission refusals, never uncertain writes or permission
// errors. A long catalog must respect the server's rate limit, not flood it.
export async function studyRateLimited<T>(
  job: () => Promise<T>,
  signal: AbortSignal,
  onWait: (ms: number) => void,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await job();
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 429 || attempt >= 2) throw e;
      const ms = Math.min(120000, Math.max(1000, e.retryAfterMs || 60000));
      onWait(ms);
      await new Promise<void>((resolve, reject) => {
        const cancel = () => {
          clearTimeout(timer);
          reject(new DOMException("Study cancelled.", "AbortError"));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", cancel);
          resolve();
        }, ms);
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
      });
    }
  }
}
function check(signal: AbortSignal, revision: number) {
  signal.throwIfAborted();
  if (session.getIdentityRevision() !== revision || !session.getToken())
    throw new ApiError("Account changed. Start a new study.", 401);
}
async function verifiedContent(
  manifest: StudyManifest,
  context: StudyContext,
  signal: AbortSignal,
): Promise<BacktestDataset> {
  if (
    manifest.purpose !== "backtest" ||
    manifest.timeframe !== "1d" ||
    manifest.backtest?.study_id !== context.id ||
    manifest.backtest.definition_hash !== context.definition_hash ||
    manifest.symbols.length !== 1 ||
    manifest.market !== context.market ||
    manifest.currency !== context.currency ||
    manifest.backtest.from !== context.config.from ||
    manifest.backtest.to !== context.config.to ||
    manifest.backtest.n_steps !== context.config.n_steps ||
    manifest.decoded_bytes > 8 << 20
  )
    throw Error("Study snapshot context mismatch.");
  const raw = await api.getDatasetContentText(manifest.dataset_id, signal),
    bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash =
    "sha256:" +
    Array.from(new Uint8Array(digest), (x) =>
      x.toString(16).padStart(2, "0"),
    ).join("");
  if (bytes.length !== manifest.decoded_bytes || hash !== manifest.checksum)
    throw Error("Study snapshot integrity check failed.");
  const data = JSON.parse(raw) as BacktestDataset & {
    backtest: { study_id: string; definition_hash: string };
  };
  if (
    data.purpose !== "backtest" ||
    data.timeframe !== "1d" ||
    data.currency !== context.currency ||
    data.market !== context.market ||
    data.backtest?.study_id !== context.id ||
    data.backtest.definition_hash !== context.definition_hash ||
    data.series.length !== 1 ||
    data.series[0].symbol !== manifest.symbols[0]
  )
    throw Error("Study content does not match its manifest.");
  return data;
}

export async function runSignalStudy(
  input: StudyInput,
  owner: string,
  signal: AbortSignal,
  update: (p: StudyProgress) => void,
  previous?: StudyProgress,
  sample?: (stage: string, milliseconds: number) => void,
): Promise<StudyProgress> {
  const revision = session.getIdentityRevision();
  const accessStart = performance.now();
  check(signal, revision);
  await api.ensureAppSession();
  check(signal, revision);
  const account = await api.account(signal);
  check(signal, revision);
  if (account.user.id !== owner || !account.features.includes("backtest"))
    throw new ApiError("An active backtest entitlement is required.", 403);
  const context = previous?.context ?? (await api.createStudy(input, signal));
  check(signal, revision);
  if (
    context.schema_version !== STUDY_SCHEMA ||
    context.policy_version !== STUDY_POLICY ||
    context.batch_size !== 10
  )
    throw Error(
      "Study version mismatch. Rebuild backend and WASM, then refresh.",
    );
  const progress: StudyProgress = previous
    ? {
        ...previous,
        failures: [...previous.failures],
        processed: [...previous.processed],
        failedBatches: [...previous.failedBatches],
        pendingBatches: [...previous.pendingBatches],
        batchStocks: { ...previous.batchStocks },
        timings: { ...previous.timings },
        traffic: { ...previous.traffic },
      }
    : {
        context,
        completed: 0,
        remaining: context.total,
        failures: [],
        failedBatches: [],
        pendingBatches: Array.from({ length: context.batches }, (_, i) => i),
        batchStocks: {},
        processed: [],
        horizons: [],
        swing: emptyStudyMetrics(),
        bySymbol: [],
        byDay: [],
        traffic: { decoded_candle_bytes: 0, candidate_json_bytes: 0 },
        timings: {
          access_ms: 0,
          startup_ms: 0,
          grant_ms: 0,
          prepare_ms: 0,
          transfer_ms: 0,
          features_ms: 0,
          scoring_ms: 0,
          study_ms: 0,
          storage_ms: 0,
        },
      };
  progress.timings.access_ms += performance.now() - accessStart;
  sample?.("access_ms", performance.now() - accessStart);
  const seen = new Set(progress.processed),
    engine = new SignalStudyEngine();
  const batches = previous
    ? [
        ...new Set([
          ...previous.pendingBatches,
          ...previous.failedBatches,
          ...previous.failures.filter((f) => f.retryable).map((f) => f.batch),
        ]),
      ]
    : Array.from({ length: context.batches }, (_, i) => i);
  const publish = () => {
    progress.completed = seen.size;
    progress.processed = [...seen];
    progress.remaining =
      context.total -
      seen.size -
      new Set(
        progress.failures
          .filter((f) => !seen.has(f.symbol))
          .map((f) => f.symbol),
      ).size;
    update({
      ...progress,
      failures: [...progress.failures],
      processed: [...seen],
      failedBatches: [...progress.failedBatches],
      pendingBatches: [...progress.pendingBatches],
      batchStocks: { ...progress.batchStocks },
      timings: { ...progress.timings },
      traffic: { ...progress.traffic },
    });
  };
  const timed = async <T>(
    key: keyof StudyProgress["timings"],
    job: () => Promise<T>,
  ) => {
    const t = performance.now();
    try {
      return await job();
    } finally {
      const elapsed = performance.now() - t;
      progress.timings[key] += elapsed;
      sample?.(key, elapsed);
    }
  };
  const admitted = async <T>(job: () => Promise<T>) => {
    try {
      return await studyRateLimited(job, signal, (ms) => {
        progress.waitingUntil = Date.now() + ms;
        publish();
      });
    } finally {
      delete progress.waitingUntil;
      publish();
    }
  };
  publish();
  try {
    const initialized = await timed("startup_ms", () =>
      engine.initialize(signal),
    );
    check(signal, revision);
    if (
      initialized.schema_version !== STUDY_SCHEMA ||
      initialized.policy_version !== STUDY_POLICY
    )
      throw Error(
        "Study engine version mismatch. Update backend and WASM together.",
      );
    for (const batchIndex of batches) {
      check(signal, revision);
      const retrySymbols =
        previous &&
        progress.batchStocks[batchIndex]?.filter(
          (symbol) =>
            !seen.has(symbol) &&
            !progress.failures.some((f) => f.symbol === symbol && !f.retryable),
        );
      if (retrySymbols && retrySymbols.length === 0) {
        progress.pendingBatches = progress.pendingBatches.filter(
          (i) => i !== batchIndex,
        );
        progress.failedBatches = progress.failedBatches.filter(
          (i) => i !== batchIndex,
        );
        publish();
        continue;
      }
      let batch;
      try {
        batch = await timed("prepare_ms", () =>
          admitted(() =>
            api.prepareStudyBatch(
              context.id,
              batchIndex,
              signal,
              retrySymbols || undefined,
            ),
          ),
        );
        check(signal, revision);
        const unique = new Set(batch.stocks),
          reported = [
            ...batch.manifests.map((m) => m.symbols[0]),
            ...batch.failures.map((f) => f.symbol),
          ];
        if (
          batch.index !== batchIndex ||
          unique.size !== batch.stocks.length ||
          batch.stocks.length > 10 ||
          new Set(reported).size !== reported.length ||
          reported.length !== unique.size ||
          reported.some((s) => !unique.has(s)) ||
          (retrySymbols &&
            (retrySymbols.length !== unique.size ||
              retrySymbols.some((s) => !unique.has(s))))
        )
          throw Error(
            "Study batch coverage does not match the frozen request.",
          );
        progress.batchStocks[batchIndex] ??= [...batch.stocks];
      } catch (e) {
        if (
          signal.aborted ||
          (e instanceof ApiError && [401, 403, 404, 409].includes(e.status))
        )
          throw e;
        if (!progress.failedBatches.includes(batchIndex))
          progress.failedBatches.push(batchIndex);
        publish();
        // A lost prepare response may still have created handles. Release that
        // batch before advancing; otherwise the next batch would be blocked.
        if (
          !(await api.releaseStudyBatch(context.id, batchIndex).then(
            () => true,
            () => false,
          ))
        )
          throw e;
        continue;
      }
      progress.failedBatches = progress.failedBatches.filter(
        (i) => i !== batchIndex,
      );
      progress.failures = progress.failures.filter(
        (f) => !batch.stocks.includes(f.symbol),
      );
      progress.failures.push(
        ...batch.failures
          .filter((f) => !seen.has(f.symbol))
          .map((f) => ({ ...f, batch: batchIndex })),
      );
      try {
        for (const manifest of batch.manifests) {
          const symbol = manifest.symbols[0];
          if (seen.has(symbol)) continue;
          check(signal, revision);
          const data = await timed("transfer_ms", () =>
            verifiedContent(manifest, context, signal),
          );
          check(signal, revision);
          progress.traffic.decoded_candle_bytes += manifest.decoded_bytes;
          const features = await timed("features_ms", () =>
            engine.features(
              data.series,
              manifest.required_operands ?? [],
              signal,
            ),
          );
          check(signal, revision);
          if (
            features.length !== 1 ||
            features[0].engine_version !== context.engine_version ||
            features[0].feature_schema_version !== "screener-features-1" ||
            features[0].candidates.length !==
              data.series[0].candles.length - 19 ||
            features[0].candidates.some((c) => c.symbol !== symbol)
          )
            throw Error(
              "Study feature history/version is incompatible. Update backend and WASM together.",
            );
          const grant = await timed("grant_ms", () =>
            admitted(() => api.createStudyGrant(manifest, context, signal)),
          );
          check(signal, revision);
          progress.traffic.candidate_json_bytes += new TextEncoder().encode(
            JSON.stringify(features[0].candidates),
          ).length;
          const decisions = await timed("scoring_ms", () =>
            admitted(() =>
              api.backtestSignals(
                grant.id,
                features[0].candidates,
                signal,
                STUDY_POLICY,
              ),
            ),
          );
          check(signal, revision);
          if (decisions.policy_version !== STUDY_POLICY)
            throw Error("Private study scoring contract mismatch.");
          const allowed = new Set(
            features[0].candidates.map((c) => c.timestamp),
          );
          if (
            decisions.entries.some(
              (e) =>
                e.symbol !== symbol ||
                !allowed.has(e.timestamp) ||
                !["BUY", "SELL"].includes(e.signal_type),
            )
          )
            throw Error("Server returned a signal outside the snapshot.");
          const result = await timed("study_ms", () =>
            engine.study(
              {
                schema_version: STUDY_SCHEMA,
                config: context.config,
                series: data.series,
                entries: decisions.entries as StudyEntry[],
              },
              signal,
            ),
          );
          check(signal, revision);
          await timed("storage_ms", () =>
            storeStudySymbol(owner, context.id, symbol, result, signal),
          );
          check(signal, revision);
          if (!progress.horizons.length) progress.horizons = result.horizons;
          else
            progress.horizons = progress.horizons.map((h, i) => ({
              ...h,
              ...mergeStudyMetrics(h, result.horizons[i]),
            }));
          progress.swing = mergeStudyMetrics(progress.swing, result.swing);
          progress.bySymbol = [...progress.bySymbol, ...result.by_symbol];
          const days = new Map(progress.byDay.map((d) => [d.key, d]));
          for (const d of result.by_day)
            days.set(d.key, {
              key: d.key,
              ...mergeStudyMetrics(days.get(d.key) ?? emptyStudyMetrics(), d),
            });
          progress.byDay = [...days.values()].sort((a, b) =>
            a.key.localeCompare(b.key),
          );
          seen.add(symbol);
          publish();
        }
        progress.pendingBatches = progress.pendingBatches.filter(
          (i) => i !== batchIndex,
        );
        publish();
      } catch (e) {
        if (!progress.failedBatches.includes(batchIndex))
          progress.failedBatches.push(batchIndex);
        publish();
        throw e;
      } finally {
        if (session.getIdentityRevision() === revision)
          await api.releaseStudyBatch(context.id, batchIndex).catch(() => {});
      }
    }
    publish();
    return progress;
  } finally {
    engine.dispose();
  }
}
