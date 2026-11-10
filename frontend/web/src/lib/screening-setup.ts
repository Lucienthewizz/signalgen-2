import type { AccountState, RuleResource, StockUniverse } from "@/types";

/** Readiness is guidance only; the server authorizes every screening run. */
export function screeningSetup(
  account: AccountState | null,
  rules: RuleResource[],
  universes: StockUniverse[],
) {
  const access = account?.access;
  const allowed = Boolean(account?.features.includes("screener"));
  const rule = rules.find(
    (item) =>
      !access?.screening.system_rules_only || item.owner_type === "system",
  );
  const universe = universes.find(
    (item) =>
      item.symbols.length > 0 &&
      item.symbols.length <= (access?.screening.max_symbols ?? 10),
  );
  const view = !allowed
    ? "subscription"
    : !rule
      ? "rules"
      : !universe
        ? "universes"
        : "analysis";
  const label = !allowed
    ? "View plan & access"
    : !rule
      ? access?.screening.system_rules_only
        ? "Review system rules"
        : "Choose a rule"
      : !universe
        ? universes.length
          ? "Adjust stock universe"
          : "Choose your first stocks"
        : "Open screener";
  return {
    allowed,
    rule,
    universe,
    view,
    label,
    ready: view === "analysis",
  } as const;
}
