import type { AccountState, EffectiveAccess } from "@/types";

// Presentation compatibility for old fixtures/servers. All real permissions
// and limits still come from the policy-aware backend and are checked on writes.
export function tierAccess(
  account: AccountState | null | undefined,
): EffectiveAccess | null {
  if (!account) return null;
  if (account.access) return account.access;
  const paid = account.features.includes("screener"),
    pro = account.features.includes("backtest");
  return {
    plan_code: pro ? "pro" : paid ? "analyst" : "free",
    source: "legacy",
    features: account.features,
    limits: {
      custom_rules: pro ? 50 : paid ? 10 : 0,
      stock_universes: pro ? 20 : paid ? 5 : 1,
    },
    screening: {
      max_symbols: paid ? 10 : 3,
      timeframes: paid ? ["1m", "5m", "15m", "1h", "1d"] : ["1d"],
      system_rules_only: !paid,
    },
  };
}
export function tierName(code: string) {
  return code === "pro" ? "Pro" : code === "analyst" ? "Analyst" : "Free";
}
export function monthlyPrice(amount: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}
