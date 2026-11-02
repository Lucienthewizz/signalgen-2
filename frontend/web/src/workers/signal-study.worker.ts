/// <reference lib="webworker" />
import { loadEngine } from "./wasm-runtime";
import {
  STUDY_SCHEMA,
  STUDY_POLICY,
  type StudyRequest,
} from "@/analysis/signal-study-types";
import type { DatasetContent } from "@/types";
const ready = loadEngine();
self.onmessage = async ({
  data,
}: MessageEvent<{
  jobId: number;
  type: string;
  request?: StudyRequest;
  series?: DatasetContent["series"];
  operands?: string[];
}>) => {
  try {
    const engine = await ready;
    if (
      !engine.signalgenRunSignalStudy ||
      !engine.signalgenComputeBacktestFeatures
    )
      throw Error(
        "Signal study WASM is unavailable. Rebuild the matching artifacts and refresh.",
      );
    const decode = (raw: string) => {
      const value = JSON.parse(raw);
      if (!value.ok)
        throw Error(value.error?.message ?? "Study computation failed.");
      return value.result;
    };
    let result;
    if (data.type === "initialize")
      result = { schema_version: STUDY_SCHEMA, policy_version: STUDY_POLICY };
    else if (data.type === "features" && data.series)
      result = data.series.map((s) =>
        decode(
          engine.signalgenComputeBacktestFeatures!(
            JSON.stringify({
              purpose: "backtest",
              symbol: s.symbol,
              candles: s.candles,
              operands: data.operands ?? [],
            }),
          ),
        ),
      );
    else if (data.type === "study" && data.request) {
      result = decode(
        engine.signalgenRunSignalStudy(JSON.stringify(data.request)),
      );
      if (
        result.schema_version !== STUDY_SCHEMA ||
        result.policy_version !== STUDY_POLICY
      )
        throw Error("Study engine contract mismatch.");
    } else throw Error("Invalid study worker message.");
    self.postMessage({ jobId: data.jobId, result });
  } catch (error) {
    self.postMessage({
      jobId: data.jobId,
      error: error instanceof Error ? error.message : "Study failed.",
    });
  }
};
export {};
