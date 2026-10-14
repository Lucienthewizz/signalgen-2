import type { StockInstrument } from "@/types";

// This is a UX bound, not authorization. The API and database enforce it too.
export const universeSelectionLimit = 10;
export const catalogPageSize = 12;

// Match code or company name, without modifying/sorting the API's source array.
// Pagination keeps a full IDX catalog from creating hundreds of DOM controls.
export function catalogPage(
  catalog: readonly StockInstrument[],
  query: string,
  requestedPage: number,
) {
  const terms = query
    .trim()
    .toLocaleLowerCase("id-ID")
    .split(/\s+/)
    .filter(Boolean);
  const matches = catalog.filter((stock) => {
    const text = `${stock.symbol} ${stock.name}`.toLocaleLowerCase("id-ID");
    return terms.every((term) => text.includes(term));
  });
  const pageCount = Math.max(1, Math.ceil(matches.length / catalogPageSize));
  const safePage = Number.isFinite(requestedPage)
    ? Math.trunc(requestedPage)
    : 0;
  const page = Math.min(Math.max(0, safePage), pageCount - 1);
  return {
    items: matches.slice(page * catalogPageSize, (page + 1) * catalogPageSize),
    totalMatches: matches.length,
    page,
    pageCount,
  };
}
