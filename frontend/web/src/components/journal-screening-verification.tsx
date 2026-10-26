import type { RefObject } from "react";
import { InfoDialog } from "@/components/ui/info-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import {
  checkJournalScreening,
  type JournalScreeningDraft,
} from "@/lib/journal-screening";
import {
  conditionEvidence,
  decisionLabel,
  decisionReasons,
} from "@/lib/workspace-feedback";
import { marketCandleDate, marketTimezone } from "@/lib/data-freshness";
import { formatStockPrice } from "@/lib/stock-market";
import { conditionSummary } from "@/lib/rule-workflow";

export function JournalScreeningVerification({
  draft,
  userId,
  onClose,
  onVerified,
  returnFocus,
}: {
  draft: JournalScreeningDraft | null;
  userId?: string;
  onClose: () => void;
  onVerified: (draft: JournalScreeningDraft) => void;
  returnFocus: RefObject<HTMLElement | null>;
}) {
  if (!draft) return null;
  const check = checkJournalScreening(draft, userId);
  const row = check.ok ? check.row : null;
  const manifest = draft.run.manifest;
  const conditions = draft.ruleSnapshot?.definition?.conditions;
  const number = (value: number) =>
    new Intl.NumberFormat("en-GB", { maximumFractionDigits: 4 }).format(value);
  return (
    <InfoDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Verify screening details"
      description="Review the captured signal before copying it into your trade form. A match is not a broker order or proof of a trade."
      returnFocus={returnFocus}
      wide
      actions={
        <Button
          disabled={!check.ok}
          onClick={() => {
            const current = checkJournalScreening(draft, userId);
            if (!current.ok) {
              toast.add({
                type: "error",
                title: "Verification failed",
                description: current.reason,
              });
              return;
            }
            onVerified(draft);
            toast.add({
              type: "success",
              title: "Screening verified",
              description:
                "Details copied to the unsaved trade form. No transaction was saved.",
            });
          }}
        >
          Use in journal form
        </Button>
      }
    >
      {!check.ok ? (
        <Alert variant="destructive">
          <AlertTitle>Verification unavailable</AlertTitle>
          <AlertDescription>{check.reason}</AlertDescription>
        </Alert>
      ) : (
        row && (
          <>
            <dl className="journal-verification-facts">
              <div>
                <dt>Stock / signal</dt>
                <dd>
                  {draft.symbol.replace(/\.JK$/, "")}{" "}
                  <Badge variant="success">{decisionLabel(row.decision)}</Badge>
                </dd>
              </div>
              <div>
                <dt>Rule</dt>
                <dd>{draft.ruleName}</dd>
              </div>
              <div>
                <dt>Open price ({manifest.currency})</dt>
                <dd>
                  {row.latestOpen == null
                    ? "Unavailable"
                    : formatStockPrice(row.latestOpen, manifest.currency)}
                </dd>
              </div>
              <div>
                <dt>Close price ({manifest.currency})</dt>
                <dd>{formatStockPrice(row.latestClose, manifest.currency)}</dd>
              </div>
              <div>
                <dt>Market / interval</dt>
                <dd>
                  {manifest.market} / {manifest.currency} · {manifest.timeframe}
                </dd>
              </div>
              <div>
                <dt>Completed candle</dt>
                <dd>
                  {marketCandleDate(
                    row.decision.timestamp,
                    manifest.market,
                    manifest.timeframe,
                  )}
                  <small>{marketTimezone(manifest.market)}</small>
                </dd>
              </div>
              <div>
                <dt>Screened at</dt>
                <dd>{new Date(draft.screenedAt).toLocaleString("en-GB")}</dd>
              </div>
              <div>
                <dt>Indicators</dt>
                <dd>
                  RSI14 {number(row.features.rsi14)}
                  <small>
                    EMA9 {number(row.features.ema9)} · EMA20{" "}
                    {number(row.features.ema20)}
                  </small>
                </dd>
              </div>
            </dl>
            <p className="journal-verification-reason">
              {decisionReasons(
                row.decision.reason_codes,
                draft.ruleSnapshot?.definition?.logic,
              )}
            </p>
            {conditions?.length ? (
              <>
                <h4>
                  Condition evidence ·{" "}
                  {draft.ruleSnapshot?.definition?.logic === "OR"
                    ? "Match any"
                    : "Match all"}
                </h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Condition</TableHead>
                      <TableHead>Current values</TableHead>
                      <TableHead>Previous candle</TableHead>
                      <TableHead>Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {conditions.map((condition, index) => {
                      const evidence = conditionEvidence(
                        condition,
                        row.features,
                        row.prevFeatures,
                      );
                      return (
                        <TableRow key={index}>
                          <TableCell>{conditionSummary(condition)}</TableCell>
                          <TableCell>
                            {evidence
                              ? `${number(evidence.left)} / ${number(evidence.right)}`
                              : "Unavailable"}
                          </TableCell>
                          <TableCell>
                            {evidence?.previous
                              ? `${number(evidence.previous.left)} / ${number(evidence.previous.right)}`
                              : "Not required / unavailable"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                evidence?.available
                                  ? evidence.passed
                                    ? "success"
                                    : "destructive"
                                  : "outline"
                              }
                            >
                              {!evidence?.available
                                ? "Unavailable"
                                : evidence.passed
                                  ? "Met"
                                  : "Not met"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </>
            ) : (
              <p>
                The saved rule definition is unavailable or private. The
                server's recorded match is shown; individual conditions are not
                inferred.
              </p>
            )}
            <Alert>
              <AlertTitle>Snapshot only · not yet saved</AlertTitle>
              <AlertDescription>
                The price is from the completed candle, not a live quote or an
                executed fill. Journal saving is unavailable until the backend
                journal API is implemented.
              </AlertDescription>
            </Alert>
          </>
        )
      )}
    </InfoDialog>
  );
}
