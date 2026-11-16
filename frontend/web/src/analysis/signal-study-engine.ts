import type { StudyRequest, StudyResult } from "./signal-study-types";
import type { DatasetContent, ScreenerFeatureResult } from "@/types";

type WorkerLike = {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
};

type Job<T> = {
  id: number;
  payload: object;
  signal: AbortSignal;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
  cancel: () => void;
  payloadBytes: number;
};

type Slot = {
  worker: WorkerLike;
  job?: Job<unknown>;
  retireWhenIdle: boolean;
};

export type SignalStudyEngineOptions = {
  maxWorkers?: number;
  workerFactory?: () => WorkerLike;
  timeoutMs?: number;
  maxQueuedJobs?: number;
  maxQueuedPayloadBytes?: number;
};

// Workers are created only when queued work needs them. A run owns this pool.
export class SignalStudyEngine {
  private readonly workerFactory: () => WorkerLike;
  private readonly timeoutMs: number;
  private readonly slots: Slot[] = [];
  private readonly queue: Job<unknown>[] = [];
  private readonly maxQueuedJobs: number;
  private readonly maxQueuedPayloadBytesLimit: number;
  private sequence = 0;
  private maxWorkers: number;
  private disposed = false;
  private queuedPayloadBytesValue = 0;

  constructor(options: SignalStudyEngineOptions = {}) {
    this.maxWorkers = SignalStudyEngine.normalizeInt(
      options.maxWorkers ?? 1,
      1,
      4,
    );
    this.timeoutMs = SignalStudyEngine.normalizeInt(
      options.timeoutMs ?? 60000,
      1,
      600000,
    );
    this.maxQueuedJobs = SignalStudyEngine.normalizeInt(
      options.maxQueuedJobs ?? 16,
      1,
      64,
    );
    this.maxQueuedPayloadBytesLimit = SignalStudyEngine.normalizeInt(
      options.maxQueuedPayloadBytes ?? 32 * 1024 * 1024,
      1,
      512 * 1024 * 1024,
    );
    this.workerFactory =
      options.workerFactory ??
      (() =>
        new Worker(
          new URL("../workers/signal-study.worker.ts", import.meta.url),
          { type: "module", name: "signalgen-signal-study" },
        ));
  }

  get workerCount() {
    return this.slots.length;
  }

  get activeJobs() {
    return this.slots.filter((slot) => slot.job).length;
  }

  get queuedJobs() {
    return this.queue.length;
  }

  get queuedPayloadBytes() {
    return this.queuedPayloadBytesValue;
  }

  get maxQueuedPayloadBytes() {
    return this.maxQueuedPayloadBytesLimit;
  }

  setMaxWorkers(maxWorkers: number) {
    if (this.disposed) return;
    this.maxWorkers = SignalStudyEngine.normalizeInt(maxWorkers, 1, 4);
    const active = this.slots.filter((slot) => slot.job);
    const idle = this.slots.filter((slot) => !slot.job);
    const keep = new Set([...active, ...idle].slice(0, this.maxWorkers));
    for (const slot of this.slots) {
      slot.retireWhenIdle = !keep.has(slot);
    }
    for (const slot of [...this.slots])
      if (!slot.job && slot.retireWhenIdle) this.retire(slot);
    this.pump();
  }

  private static normalizeInt(value: number, min: number, max: number) {
    if (!Number.isFinite(value))
      throw new TypeError("Study worker options must be finite numbers.");
    return Math.max(min, Math.min(max, Math.floor(value)));
  }

  dispose(error = Error("Study engine disposed.")) {
    if (this.disposed) return;
    this.disposed = true;
    const jobs = [
      ...this.queue,
      ...this.slots.flatMap((slot) => (slot.job ? [slot.job] : [])),
    ];
    this.queue.length = 0;
    for (const slot of this.slots) {
      slot.job = undefined;
      slot.worker.onmessage = null;
      slot.worker.onerror = null;
      slot.worker.onmessageerror = null;
      slot.worker.terminate();
    }
    this.slots.length = 0;
    for (const job of jobs) this.settle(job, error);
    this.queuedPayloadBytesValue = 0;
  }

  private settle<T>(job: Job<T>, error?: Error, value?: T) {
    if (job.settled) return;
    job.settled = true;
    this.queuedPayloadBytesValue -= job.payloadBytes;
    if (job.timer) clearTimeout(job.timer);
    job.signal.removeEventListener("abort", job.cancel);
    if (error) job.reject(error);
    else job.resolve(value!);
  }

  private fail(error: Error) {
    this.dispose(error);
  }

  private retire(slot: Slot) {
    const index = this.slots.indexOf(slot);
    if (index < 0) return;
    this.slots.splice(index, 1);
    slot.worker.onmessage = null;
    slot.worker.onerror = null;
    slot.worker.onmessageerror = null;
    slot.worker.terminate();
  }

  private createSlot() {
    const slot: Slot = { worker: this.workerFactory(), retireWhenIdle: false };
    slot.worker.onmessage = ({ data }: MessageEvent) => {
      const job = slot.job;
      if (!job || data?.jobId !== job.id) return;
      slot.job = undefined;
      if (
        !data ||
        typeof data !== "object" ||
        !Object.prototype.hasOwnProperty.call(data, "jobId") ||
        (!Object.prototype.hasOwnProperty.call(data, "result") &&
          !Object.prototype.hasOwnProperty.call(data, "error"))
      ) {
        this.settle(job, Error("Study worker returned a malformed response."));
        this.fail(Error("Study worker returned a malformed response."));
        return;
      }
      if (Object.prototype.hasOwnProperty.call(data, "error")) {
        this.settle(job, Error(String(data.error || "Study failed.")));
        this.fail(Error("Study worker failed."));
        return;
      }
      this.settle(job, undefined, data.result);
      if (slot.retireWhenIdle) this.retire(slot);
      this.pump();
    };
    const failed = () => this.fail(Error("Study worker failed."));
    slot.worker.onerror = failed;
    slot.worker.onmessageerror = failed;
    this.slots.push(slot);
  }

  private pump() {
    if (this.disposed) return;
    while (this.queue.length) {
      if (this.activeJobs >= this.maxWorkers) return;
      let slot = this.slots.find(
        (candidate) => !candidate.job && !candidate.retireWhenIdle,
      );
      if (!slot && this.slots.length < this.maxWorkers) {
        try {
          this.createSlot();
          slot = this.slots[this.slots.length - 1];
        } catch {
          this.fail(Error("Study worker could not start."));
          return;
        }
      }
      if (!slot) return;
      const job = this.queue.shift()!;
      slot.job = job;
      job.timer = setTimeout(
        () =>
          this.fail(
            Error(`Study worker exceeded ${this.timeoutMs} milliseconds.`),
          ),
        this.timeoutMs,
      );
      try {
        slot.worker.postMessage({ ...job.payload, jobId: job.id });
      } catch {
        this.fail(Error("Study input could not be sent to worker."));
        return;
      }
    }
  }

  private call<T>(
    payload: object,
    signal: AbortSignal,
    payloadBytes = 0,
  ): Promise<T> {
    if (this.disposed)
      return Promise.reject(Error("Study engine is no longer available."));
    signal.throwIfAborted();
    const bytes = SignalStudyEngine.normalizeInt(
      payloadBytes,
      0,
      this.maxQueuedPayloadBytesLimit,
    );
    if (
      this.queue.length + this.activeJobs >= this.maxQueuedJobs ||
      (this.queuedPayloadBytesValue > 0 &&
        this.queuedPayloadBytesValue + bytes > this.maxQueuedPayloadBytesLimit)
    )
      return Promise.reject(Error("Study worker queue budget exceeded."));
    const jobId = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const job: Job<T> = {
        id: jobId,
        payload,
        signal,
        resolve,
        reject,
        settled: false,
        payloadBytes: bytes,
        cancel: () =>
          this.fail(new DOMException("Study cancelled.", "AbortError")),
      };
      signal.addEventListener("abort", job.cancel, { once: true });
      this.queuedPayloadBytesValue += bytes;
      this.queue.push(job as Job<unknown>);
      this.pump();
    });
  }

  features(
    series: DatasetContent["series"],
    operands: string[],
    signal: AbortSignal,
    payloadBytes = 0,
  ) {
    return this.call<ScreenerFeatureResult[]>(
      { type: "features", series, operands },
      signal,
      payloadBytes,
    );
  }

  initialize(signal: AbortSignal) {
    return this.call<{ schema_version: string; policy_version: string }>(
      { type: "initialize" },
      signal,
    );
  }

  study(request: StudyRequest, signal: AbortSignal) {
    const payloadBytes = request.series.reduce(
      (sum, series) => sum + series.candles.length * 48,
      0,
    );
    return this.call<StudyResult>(
      { type: "study", request },
      signal,
      payloadBytes,
    );
  }
}
