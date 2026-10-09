export type MarketArticle = {
  title: string;
  url: string;
  source: string;
  indexedAt: string | null;
};
export const IDX_CHANNEL =
  "https://www.youtube.com/channel/UCXyfYHdOPLUgxMndSwf9tHg";
// Verified against the official channel feed on 7 October 2026; curated, not a live video feed.
export const IDX_VIDEOS = [
  {
    id: "KoswCVp1dv0",
    title: "Public Expose 2026 — Astra International (ASII)",
  },
  { id: "ENVi5lHxzj0", title: "Public Expose 2026 — Timah (TINS)" },
  {
    id: "YrZbMOaTTYE",
    title: "Public Expose 2026 — Raharja Energi Cepu (RATU)",
  },
];
export type MarketNewsResult = {
  items: MarketArticle[];
  at: number;
  warning: string | null;
};
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "");
const STALE_WARNING =
  "Sumber belum dapat diperbarui. Daftar terakhir tetap ditampilkan; coba lagi dalam satu menit.";
let cached: MarketNewsResult | null = null;
let nextAttempt = 0;
export function getCachedMarketNews() {
  return cached && Date.now() - cached.at <= 86_400_000 ? cached : null;
}
export function parseMarketNews(payload: unknown): MarketArticle[] {
  if (!payload || typeof payload !== "object" || !("articles" in payload))
    throw new Error("Format respons berita tidak valid.");
  const rows = (payload as { articles: unknown }).articles;
  if (!Array.isArray(rows))
    throw new Error("Format respons berita tidak valid.");
  const seen = new Set<string>();
  return rows
    .flatMap((row): MarketArticle[] => {
      if (!row || typeof row !== "object") return [];
      const item = row as Record<string, unknown>;
      if (
        typeof item.title !== "string" ||
        !item.title.trim() ||
        typeof item.url !== "string"
      )
        return [];
      try {
        const url = new URL(item.url);
        if (
          url.protocol !== "https:" ||
          seen.has(url.href) ||
          url.username ||
          url.password
        )
          return [];
        seen.add(url.href);
        const stamp =
          typeof item.published_at === "string" ? item.published_at : "";
        return [
          {
            title: item.title.trim().slice(0, 500),
            url: url.href,
            source: url.hostname.replace(/^www\./, ""),
            indexedAt:
              stamp && Number.isFinite(Date.parse(stamp)) ? stamp : null,
          },
        ];
      } catch {
        return [];
      }
    })
    .slice(0, 24);
}
export async function fetchMarketNews(
  signal: AbortSignal,
  refresh = false,
): Promise<MarketNewsResult> {
  const previous = getCachedMarketNews();
  if (previous && !refresh && Date.now() - previous.at < 300_000)
    return previous;
  if (Date.now() < nextAttempt) {
    if (previous) return { ...previous, warning: STALE_WARNING };
    throw new Error(
      "Sumber berita belum tersedia. Coba lagi dalam satu menit.",
    );
  }
  try {
    const response = await fetch(`${API_ORIGIN}/api/news`, {
      signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
      cache: refresh ? "no-cache" : "default",
    });
    if (!response.ok)
      throw new Error(
        "Sumber berita belum tersedia. Coba lagi dalam satu menit.",
      );
    const payload: unknown = await response.json();
    const items = parseMarketNews(payload);
    const metadata = payload as Record<string, unknown>;
    const at =
      typeof metadata.fetched_at === "string"
        ? Date.parse(metadata.fetched_at)
        : Date.now();
    cached = {
      items,
      at: Number.isFinite(at) ? Math.min(at, Date.now()) : Date.now(),
      warning: metadata.stale === true ? STALE_WARNING : null,
    };
    if (cached.warning) nextAttempt = Date.now() + 60_000;
    else nextAttempt = 0;
    return cached;
  } catch (caught) {
    if (signal.aborted) throw caught;
    nextAttempt = Date.now() + 60_000;
    if (previous) return { ...previous, warning: STALE_WARNING };
    throw new Error(
      "Koneksi ke sumber berita belum berhasil. Coba lagi dalam satu menit.",
    );
  }
}
