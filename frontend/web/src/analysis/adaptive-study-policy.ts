export type StudyWorkerPolicyInput = {
  catalogSize: number;
  batchSize: number;
  candleCount: number;
  requiredOperands: number;
  hardwareConcurrency?: number;
  deviceMemory?: number;
};

export type StudyWorkerPolicy = {
  maxWorkers: number;
  reasons: string[];
};

export function getAdaptiveStudyWorkerPolicy(
  input: StudyWorkerPolicyInput,
): StudyWorkerPolicy {
  const reasons: string[] = [];
  const cores = Number.isFinite(input.hardwareConcurrency)
    ? Math.max(1, Math.floor(input.hardwareConcurrency!))
    : 0;
  const memory = Number.isFinite(input.deviceMemory)
    ? input.deviceMemory!
    : undefined;
  if (!cores) {
    return { maxWorkers: 1, reasons: ["hardware concurrency is unavailable"] };
  }
  if (cores < 2 || (memory != null && memory <= 2)) {
    return {
      maxWorkers: 1,
      reasons: [
        cores < 2 ? "single-core hint" : "low memory hint",
        "small pools protect the UI and WASM heap",
      ],
    };
  }
  const heavy =
    input.catalogSize >= 20 &&
    input.batchSize >= 4 &&
    input.candleCount >= 1500 &&
    input.requiredOperands >= 1;
  if (!heavy) {
    return {
      maxWorkers: 1,
      reasons: ["catalog or current batch workload is small"],
    };
  }
  let maxWorkers = Math.min(4, Math.max(2, cores - 1));
  if (memory != null && memory < 8) maxWorkers = Math.min(maxWorkers, 2);
  if (input.candleCount >= 5000 && input.requiredOperands >= 2)
    reasons.push("large candle and indicator workload");
  else reasons.push("bounded candle and indicator workload");
  if (input.catalogSize >= 20) reasons.push("catalog has enough symbols");
  if (memory == null)
    reasons.push("memory hint unavailable; CPU-only cap applied");
  return { maxWorkers, reasons };
}
