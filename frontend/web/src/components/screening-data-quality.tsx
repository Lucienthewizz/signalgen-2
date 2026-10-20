import { Badge } from "@/components/ui/badge";
import { candleRange, marketTimezone } from "@/lib/data-freshness";
import type { DatasetManifest } from "@/types";

export function ScreeningDataQuality({
  manifest,
  timestamps,
}: {
  manifest: DatasetManifest;
  timestamps: string[];
}) {
  const warnings = [...new Set(manifest.quality.warnings)];
  return (
    <section className="screening-data-quality" aria-label="Data quality">
      <header>
        <h4>Data quality</h4>
        <Badge variant="outline">
          {warnings.length
            ? `${warnings.length} data notes`
            : "No data notes reported"}
        </Badge>
      </header>
      <dl>
        <div>
          <dt>
            {manifest.timeframe === "1d"
              ? "Daily candle dates"
              : `${manifest.timeframe} candle times`}
          </dt>
          <dd>
            {candleRange(timestamps, manifest.market, manifest.timeframe)}
          </dd>
        </div>
        <div>
          <dt>Market / currency</dt>
          <dd>
            {manifest.market} / {manifest.currency}
          </dd>
        </div>
        <div>
          <dt>Market timezone</dt>
          <dd>{marketTimezone(manifest.market)}</dd>
        </div>
      </dl>
      <p>
        Screening snapshot, not a live quote. Timestamps are stored in{" "}
        {manifest.timezone}; dates above use the market timezone.
      </p>
      <details>
        <summary>
          View data quality{warnings.length > 0 ? ` (${warnings.length})` : ""}
        </summary>
        {warnings.length > 0 ? (
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : (
          <p>The provider reported no data warnings for this snapshot.</p>
        )}
        <p>
          “Complete” means the selected payload passed validation. It does not
          guarantee gap-free trading history, complete market coverage, or
          reconciled corporate actions.
        </p>
      </details>
    </section>
  );
}
