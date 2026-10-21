import type { LiveScreenerRun } from "@/analysis/screener";
import type { RuleSnapshot } from "@/lib/market-monitor";

/** Memory-only handoff. A screening snapshot is not an executed transaction. */
export type JournalScreeningDraft = {
  ownerId: string;
  symbol: string;
  ruleName: string;
  ruleSnapshot?: RuleSnapshot;
  screenedAt: string;
  run: LiveScreenerRun;
};

export function checkJournalScreening(
  draft: JournalScreeningDraft,
  userId?: string,
) {
  if (!userId || draft.ownerId !== userId)
    return {
      ok: false as const,
      reason: "This screening belongs to another session. Run screening again.",
    };
  const row = draft.run.rows.find(
    (item) => item.decision.symbol === draft.symbol,
  );
  if (!row?.decision.matched)
    return {
      ok: false as const,
      reason:
        "Only a matched screening result can be verified for a journal entry.",
    };
  if (
    !Number.isFinite(row.latestClose) ||
    row.latestClose <= 0 ||
    ![
      row.features.price,
      row.features.ema9,
      row.features.ema20,
      row.features.rsi14,
    ].every(Number.isFinite) ||
    !["IDR", "USD"].includes(draft.run.manifest.currency) ||
    !Number.isFinite(Date.parse(draft.screenedAt)) ||
    !Number.isFinite(Date.parse(row.decision.timestamp))
  )
    return {
      ok: false as const,
      reason:
        "Screening price, indicators, currency or candle time are unavailable. Run screening again.",
    };
  return { ok: true as const, row };
}
