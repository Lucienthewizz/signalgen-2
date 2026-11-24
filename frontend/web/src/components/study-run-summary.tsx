import type { StudyProgress } from "@/analysis/signal-study";
import { Button } from "@/components/ui/button";

function elapsedTime(ms?: number) {
  if (ms == null) return "Not recorded";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export function studyOutcomeMessage(progress: StudyProgress): string {
  if (progress.remaining || progress.failedBatches.length)
    return "Run interrupted. Available results are kept.";
  if (progress.failures.length || progress.swing.missing)
    return "Run finished with data issues.";
  return "Run complete. All stocks evaluated.";
}

export function StudyRunSummary({
  elapsedMs,
  completed,
  failed,
  remaining,
  total,
}: {
  elapsedMs?: number;
  completed: number;
  failed: number;
  remaining: number;
  total: number;
}) {
  return (
    <dl className="study-run-summary" aria-label="Run summary">
      <div>
        <dt>Elapsed time</dt>
        <dd>{elapsedTime(elapsedMs)}</dd>
      </div>
      <div>
        <dt>Stocks evaluated</dt>
        <dd>
          {completed.toLocaleString()} / {total.toLocaleString()}
        </dd>
      </div>
      <div>
        <dt>Could not evaluate</dt>
        <dd data-failed={failed > 0 || undefined}>{failed.toLocaleString()}</dd>
      </div>
      <div>
        <dt>Remaining</dt>
        <dd>{remaining.toLocaleString()}</dd>
      </div>
    </dl>
  );
}

const failureReasons: Record<string, string> = {
  HISTORY_INSUFFICIENT: "Insufficient daily candle history",
  INSUFFICIENT_HISTORY: "Insufficient daily candle history",
  INSUFFICIENT_CANDLES: "Insufficient daily candle history",
  PROVIDER_UNAVAILABLE: "Market data provider unavailable",
  RATE_LIMITED: "Market data request limited",
};

export function StudyRunIssues({
  progress,
  onRetry,
  retryDisabled,
}: {
  progress: StudyProgress;
  onRetry?: () => void;
  retryDisabled?: boolean;
}) {
  const { failures, failedBatches } = progress;
  if (!failures.length && !failedBatches.length && !onRetry) return null;
  const issueCounts = [
    failures.length &&
      `${failures.length} failed ${failures.length === 1 ? "stock" : "stocks"}`,
    failedBatches.length &&
      `${failedBatches.length} interrupted ${failedBatches.length === 1 ? "batch" : "batches"}`,
  ].filter(Boolean);
  return (
    <div className="study-run-issues">
      {!!(failures.length || failedBatches.length) && (
        <details>
          <summary>Processing issues ({issueCounts.join(", ")})</summary>
          {!!failedBatches.length && (
            <p>Completed results are kept when a batch is interrupted.</p>
          )}
          {!!failures.length && (
            <ul>
              {failures.slice(0, 100).map(({ symbol, code, retryable }) => (
                <li key={symbol}>
                  <strong>{symbol}</strong> —{" "}
                  {failureReasons[code] ??
                    code.replaceAll("_", " ").toLowerCase()}
                  {retryable ? " (retry available)" : ""}
                </li>
              ))}
            </ul>
          )}
          {failures.length > 100 && (
            <p>Showing the first 100 of {failures.length} failed stocks.</p>
          )}
        </details>
      )}
      {onRetry && (
        <Button
          type="button"
          variant="outline"
          onClick={onRetry}
          disabled={retryDisabled}
        >
          {progress.remaining ? "Retry and continue" : "Retry failed stocks"}
        </Button>
      )}
    </div>
  );
}
