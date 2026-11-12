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
