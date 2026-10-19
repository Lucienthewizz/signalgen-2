import type { ScreenerDecision } from "@/types";

export function screeningStatus(
  decision: Pick<ScreenerDecision, "matched" | "signal_type" | "reason_codes">,
) {
  if (decision.reason_codes.includes("COOLDOWN_ACTIVE")) return "cooldown";
  return decision.matched
    ? decision.signal_type === "SELL"
      ? "sell"
      : decision.signal_type === "BUY"
        ? "buy"
        : "matched"
    : "rejected";
}
export const screeningStatusLabels = {
  all: "All results",
  matched: "Matched",
  buy: "BUY",
  sell: "SELL",
  cooldown: "Cooldown",
  rejected: "Not matched",
};
