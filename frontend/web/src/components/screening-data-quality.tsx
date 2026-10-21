import { useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoDialog } from "@/components/ui/info-dialog";
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
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={trigger}
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <ShieldCheck data-icon="inline-start" /> View data quality
        {warnings.length > 0 && (
          <Badge variant="secondary">{warnings.length}</Badge>
        )}
      </Button>
      <InfoDialog
        open={open}
        onOpenChange={setOpen}
        title="Data quality"
        description="The data behind this screening result. This is a candle snapshot, not a live quote."
        returnFocus={trigger}
        wide
      >
        <section
          className="screening-data-quality"
          aria-label="Snapshot quality details"
        >
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
              <dt>Candle interval</dt>
              <dd>
                {manifest.timeframe === "1d" ? "Daily" : manifest.timeframe}
              </dd>
            </div>
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
            <div>
              <dt>Total supplied candles</dt>
              <dd>{manifest.candle_count.toLocaleString("en-GB")}</dd>
            </div>
            <div>
              <dt>Warmup target</dt>
              <dd>{manifest.warmup_candles} candles</dd>
            </div>
          </dl>
          <p>
            Screening snapshot, not a live quote. Timestamps are stored in{" "}
            {manifest.timezone}; dates above use the market timezone. The candle
            total includes warmup data across the dataset, not a count per
            stock.
          </p>
          <div className="screening-data-quality__notes">
            <h4>Data notes</h4>
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
              “Complete” means the selected payload passed validation. It does
              not guarantee gap-free trading history, complete market coverage,
              or reconciled corporate actions.
            </p>
          </div>
        </section>
      </InfoDialog>
    </>
  );
}
