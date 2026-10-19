import type { ScreenerFeatureResult } from "@/types";

/** Keep a stock's full chronology together: splitting it would reset cooldown. */
export function packCandidateBatches(
  groups: ScreenerFeatureResult[],
  maximum: number,
  maxBytes = 240000,
): ScreenerFeatureResult[] {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1000)
    throw Error("Invalid scoring candidate limit.");
  const batches: ScreenerFeatureResult[] = [];
  let batch: ScreenerFeatureResult | null = null;
  const size = (candidates: ScreenerFeatureResult["candidates"]) =>
    new TextEncoder().encode(JSON.stringify(candidates)).length;
  for (const group of groups) {
    if (
      !group ||
      group.engine_version !== "core-0.3.0" ||
      group.feature_schema_version !== "screener-features-1" ||
      !Array.isArray(group.candidates) ||
      !group.candidates.length
    )
      throw Error("WASM did not produce valid candidates.");
    if (group.candidates.length > maximum || size(group.candidates) > maxBytes)
      throw Error(
        "One stock series exceeds the scoring limit. Its history cannot be split without affecting cooldown decisions.",
      );
    if (
      batch &&
      (batch.candidates.length + group.candidates.length > maximum ||
        size([...batch.candidates, ...group.candidates]) > maxBytes)
    ) {
      batches.push(batch);
      batch = null;
    }
    batch ??= {
      engine_version: group.engine_version,
      feature_schema_version: group.feature_schema_version,
      execution: "client_go_features",
      candidates: [],
      candle_count: 0,
      warnings: [],
    };
    batch.candidates.push(...group.candidates);
    batch.candle_count += group.candle_count;
    batch.warnings.push(...group.warnings);
  }
  if (batch) batches.push(batch);
  return batches;
}
