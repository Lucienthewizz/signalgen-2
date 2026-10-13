import {
  hasWorkspaceData,
  readWorkspaceData,
  writeWorkspaceData,
} from "@/lib/workspace-storage";
export type ScreenerPreferences = {
  ruleId: string;
  universeId: string;
  filter: "all" | "matched" | "rejected";
  search: string;
  sort: "symbol" | "matched" | "close" | "rsi";
};

export const defaultPreferences: ScreenerPreferences = {
  ruleId: "",
  universeId: "",
  filter: "all",
  search: "",
  sort: "symbol",
};
const key = (userId: string) =>
  `signalgen.screener-preferences.v1.${encodeURIComponent(userId)}`;

export function readScreenerPreferences(userId: string): ScreenerPreferences {
  try {
    const cloud = readWorkspaceData(userId, "screener-preferences");
    const raw = hasWorkspaceData(userId, "screener-preferences")
      ? JSON.stringify(cloud)
      : localStorage.getItem(key(userId));
    if (!raw || raw.length > 4096) return { ...defaultPreferences };
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object") return { ...defaultPreferences };
    return {
      ruleId:
        typeof value.ruleId === "string" ? value.ruleId.slice(0, 160) : "",
      universeId:
        typeof value.universeId === "string"
          ? value.universeId.slice(0, 160)
          : "",
      filter: ["all", "matched", "rejected"].includes(value.filter)
        ? value.filter
        : "all",
      search: typeof value.search === "string" ? value.search.slice(0, 80) : "",
      sort: ["symbol", "matched", "close", "rsi"].includes(value.sort)
        ? value.sort
        : "symbol",
    };
  } catch {
    return { ...defaultPreferences };
  }
}

export function saveScreenerPreferences(
  userId: string,
  value: ScreenerPreferences,
): boolean {
  try {
    return writeWorkspaceData(userId, "screener-preferences", value);
  } catch {
    return false;
  }
}

export function filteredRows<
  T extends {
    decision: { symbol: string; matched: boolean };
    latestClose: number;
    features: { rsi14: number };
  },
>(rows: T[], filter: string, search: string, sort: string): T[] {
  const query = search.trim().toUpperCase();
  return rows
    .filter(
      (row) =>
        row.decision.symbol.toUpperCase().includes(query) &&
        (filter === "all" ||
          (filter === "matched"
            ? row.decision.matched
            : !row.decision.matched)),
    )
    .sort((a, b) => {
      if (sort === "matched")
        return (
          Number(b.decision.matched) - Number(a.decision.matched) ||
          a.decision.symbol.localeCompare(b.decision.symbol)
        );
      if (sort === "close") return b.latestClose - a.latestClose;
      if (sort === "rsi") return b.features.rsi14 - a.features.rsi14;
      return a.decision.symbol.localeCompare(b.decision.symbol);
    });
}
