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
};

type Slot = {
  worker: WorkerLike;
  job?: Job<unknown>;
};

export type SignalStudyEngineOptions = {
  maxWorkers?: number;
  workerFactory?: () => WorkerLike;
  timeoutMs?: number;
};

// Workers are created only when queued work needs them. A run owns this pool.
export class SignalStudyEngine {
  private readonly workerFactory: () => WorkerLike;
  private readonly timeoutMs: number;
  private readonly slots: Slot[] = [];
  private readonly queue: Job<unknown>[] = [];
  private sequence = 0;
  private maxWorkers: number;
  private disposed = false;

  constructor(options: SignalStudyEngineOptions = {}) {
    this.maxWorkers = Math.max(1, Math.min(4, options.maxWorkers ?? 1));
    this.timeoutMs = options.timeoutMs ?? 60000;
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

  setMaxWorkers(maxWorkers: number) {
    if (this.disposed) return;
    this.maxWorkers = Math.max(1, Math.min(4, Math.floor(maxWorkers)));
    this.pump();
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
  }

  private settle<T>(job: Job<T>, error?: Error, value?: T) {
    if (job.settled) return;
    job.settled = true;
    if (job.timer) clearTimeout(job.timer);
    job.signal.removeEventListener("abort", job.cancel);
    if (error) job.reject(error);
    else job.resolve(value!);
  }

  private fail(error: Error) {
    this.dispose(error);
  }

  private createSlot() {
    const slot: Slot = { worker: this.workerFactory() };
    slot.worker.onmessage = ({ data }: MessageEvent) => {
      const job = slot.job;
      if (!job || data?.jobId !== job.id) return;
      slot.job = undefined;
      this.settle(
        job,
        data.error ? Error(String(data.error)) : undefined,
        data.result,
      );
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
      let slot = this.slots.find((candidate) => !candidate.job);
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
        () => this.fail(Error("Study worker exceeded 60 seconds.")),
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

  private call<T>(payload: object, signal: AbortSignal): Promise<T> {
    if (this.disposed)
      return Promise.reject(Error("Study engine is no longer available."));
    signal.throwIfAborted();
    const jobId = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const job: Job<T> = {
        id: jobId,
        payload,
        signal,
        resolve,
        reject,
        settled: false,
        cancel: () =>
          this.fail(new DOMException("Study cancelled.", "AbortError")),
      };
      signal.addEventListener("abort", job.cancel, { once: true });
      this.queue.push(job as Job<unknown>);
      this.pump();
    });
  }

  features(
    series: DatasetContent["series"],
    operands: string[],
    signal: AbortSignal,
  ) {
    return this.call<ScreenerFeatureResult[]>(
      { type: "features", series, operands },
      signal,
    );
  }

  initialize(signal: AbortSignal) {
    return this.call<{ schema_version: string; policy_version: string }>(
      { type: "initialize" },
      signal,
    );
  }

  study(request: StudyRequest, signal: AbortSignal) {
    return this.call<StudyResult>({ type: "study", request }, signal);
  }
}
