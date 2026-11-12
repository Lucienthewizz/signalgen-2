import type {
  StudyConfig,
  StudyMetrics,
  StudyOutcome,
  StudyResult,
} from "./signal-study-types";

// Display existing core outputs without treating independent signals as trades.
export function evaluationComparison(
  horizons: StudyResult["horizons"],
  swing: StudyMetrics,
  config: StudyConfig,
  step: number,
): Array<{ label: string; metrics: StudyMetrics }> {
  const rows: Array<{ label: string; metrics: StudyMetrics }> = [
    "open",
    "close",
  ].flatMap((basis) => {
    const metrics = horizons.find((h) => h.step === step && h.basis === basis);
    return metrics
      ? [
          {
            label: `Exact T+${step} ${basis === "open" ? "Open" : "Close"}`,
            metrics,
          },
        ]
      : [];
  });
  if (config.take_profit_pct != null || config.stop_loss_pct != null)
    rows.push({
      label: `${config.stop_loss_pct != null ? "TP / SL" : "Target"} within T+${config.n_steps} (final Close if unhit)`,
      metrics: swing,
    });
  return rows;
}

export function outcomeDescription(
  outcome: StudyOutcome,
  barriersEnabled = true,
): string {
  if (outcome.return_pct == null) return "Incomplete · excluded";
  const status =
    outcome.status === "take_profit"
      ? "Target hit"
      : outcome.status === "stop_loss"
        ? "Stop loss hit"
        : outcome.status === "time_exit"
          ? barriersEnabled
            ? "Unhit · final Close"
            : "Final Close"
          : "Exact price";
  return `${status} · T+${outcome.step} · ${outcome.timestamp ?? "time unavailable"} · price ${outcome.price ?? "—"} · ${outcome.return_pct.toFixed(2)}%`;
}

export function targetHitSummary(metrics: StudyMetrics, config: StudyConfig) {
  const label =
    config.stop_loss_pct != null ? "TP exit rate" : "Target reached rate";
  if (config.take_profit_pct == null)
    return {
      label,
      rate: null,
      text: "Unavailable · no target configured",
      available: false,
    };
  if (metrics.target_hits == null)
    return {
      label,
      rate: null,
      text: "Unavailable · reload the updated engine and rerun this study",
      available: false,
    };
  const rate = metrics.evaluated
    ? (metrics.target_hits / metrics.evaluated) * 100
    : null;
  return {
    label,
    rate,
    available: true,
    text: `${rate == null ? "—" : rate.toFixed(2) + "%"} · ${metrics.target_hits}/${metrics.evaluated} evaluated · ${metrics.missing} incomplete`,
  };
}
