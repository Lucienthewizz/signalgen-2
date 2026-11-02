import type { StudyRequest, StudyResult } from "./signal-study-types";
import type { DatasetContent, ScreenerFeatureResult } from "@/types";

// One worker per run, reused across all catalog batches. Abort destroys only this run.
export class SignalStudyEngine {
  private worker = new Worker(
    new URL("../workers/signal-study.worker.ts", import.meta.url),
    { type: "module", name: "signalgen-signal-study" },
  );
  private sequence = 0;
  private busy = false;
  dispose() {
    this.worker.terminate();
  }
  private call<T>(payload: object, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    if (this.busy)
      return Promise.reject(Error("A study computation is already running."));
    this.busy = true;
    const jobId = ++this.sequence;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error, value?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        this.busy = false;
        this.worker.onmessage = null;
        this.worker.onerror = null;
        this.worker.onmessageerror = null;
        if (error) {
          this.dispose();
          reject(error);
        } else resolve(value!);
      };
      const cancel = () =>
        finish(new DOMException("Study cancelled.", "AbortError"));
      const timer = setTimeout(
        () => finish(Error("Study worker exceeded 60 seconds.")),
        60000,
      );
      signal.addEventListener("abort", cancel, { once: true });
      this.worker.onerror = this.worker.onmessageerror = () =>
        finish(Error("Study worker failed."));
      this.worker.onmessage = ({ data }) => {
        if (data.jobId === jobId)
          finish(data.error ? Error(data.error) : undefined, data.result);
      };
      try {
        this.worker.postMessage({ ...payload, jobId });
      } catch {
        finish(Error("Study input could not be sent to worker."));
      }
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
