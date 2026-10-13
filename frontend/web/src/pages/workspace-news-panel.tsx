import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Newspaper, Play, RefreshCw, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { idxTicker } from "@/lib/market-monitor";
import { hasWorkspaceData, readWorkspaceData } from "@/lib/workspace-storage";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";
import {
  fetchMarketNews,
  filterMarketArticles,
  getCachedMarketNews,
  IDX_VIDEOS,
  type MarketArticle,
} from "@/lib/market-news";

const newsDateFormat = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function WorkspaceNewsPanel({ userId }: { userId?: string }) {
  const [selected, setSelected] = useState(IDX_VIDEOS[0]);
  const [articles, setArticles] = useState<MarketArticle[]>(
    () => getCachedMarketNews()?.items ?? [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [ticker, setTicker] = useState("all");
  const watchlist = useMemo(() => {
    try {
      const stored: unknown =
        userId && hasWorkspaceData(userId, "watchlist")
          ? readWorkspaceData(userId, "watchlist")
          : JSON.parse(
              localStorage.getItem(
                `signalgen:watchlist:${userId ?? "guest"}`,
              ) ?? "null",
            );
      if (Array.isArray(stored))
        return [
          ...new Set(
            stored.filter(
              (item): item is string =>
                typeof item === "string" && idxTicker(item) === item,
            ),
          ),
        ].slice(0, 30);
    } catch {
      /* A blocked device store must not prevent reading public news. */
    }
    return ["BBCA", "BBRI", "TLKM", "BMRI", "ASII"];
  }, [userId]);
  const visibleArticles = useMemo(
    () => filterMarketArticles(articles, query, ticker),
    [articles, query, ticker],
  );
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    let active = true;
    setLoading(true);
    setError(null);
    fetchMarketNews(controller.signal, revision > 0)
      .then((result) => {
        if (active) {
          setArticles(result.items);
          setError(result.warning);
        }
      })
      .catch((caught) => {
        if (active)
          setError(
            controller.signal.aborted
              ? "Sumber berita terlalu lama merespons. Coba lagi nanti."
              : caught instanceof Error
                ? caught.message
                : "Berita belum dapat dimuat.",
          );
      })
      .finally(() => {
        clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [revision]);
  return (
    <div className="workspace-news">
      <section className="news-video" aria-labelledby="idx-video-title">
        <header>
          <WindowDots />
          <h3 id="idx-video-title">
            <Video aria-hidden="true" />
            Video
          </h3>
          <span aria-hidden="true" />
        </header>
        <div className="news-video__layout">
          <div className="news-video__player">
            <iframe
              key={selected.id}
              src={`https://www.youtube-nocookie.com/embed/${selected.id}?autoplay=0`}
              title={selected.title}
              allow="encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
          <div className="news-video__choices">
            {IDX_VIDEOS.map((video) => (
              <button
                key={video.id}
                type="button"
                aria-pressed={selected.id === video.id}
                onClick={() => setSelected(video)}
              >
                <Play aria-hidden="true" />
                <span>{video.title}</span>
              </button>
            ))}
            <a
              href={`https://www.youtube.com/watch?v=${selected.id}`}
              target="_blank"
              rel="noreferrer"
            >
              Tonton pilihan ini di YouTube
              <ExternalLink aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
      <section
        className="news-feed"
        aria-labelledby="market-news-title"
        aria-busy={loading}
      >
        <header>
          <WindowDots />
          <h3 id="market-news-title">
            <Newspaper aria-hidden="true" />
            Berita saham
          </h3>
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => setRevision((r) => r + 1)}
          >
            <RefreshCw data-icon="inline-start" />
            {loading ? "Memuat" : error ? "Coba lagi" : "Perbarui"}
          </Button>
        </header>
        <div className="news-filters">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="news-search">Cari berita</FieldLabel>
              <Input
                id="news-search"
                type="search"
                placeholder="Cari judul atau nama perusahaan"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="news-stock">Saham watchlist</FieldLabel>
              <Select
                value={ticker}
                onValueChange={(value) => setTicker(value ?? "all")}
              >
                <SelectTrigger id="news-stock">
                  <SelectValue>
                    {ticker === "all" ? "Semua saham" : ticker}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">Semua saham</SelectItem>
                    {watchlist.map((symbol) => (
                      <SelectItem key={symbol} value={symbol}>
                        {symbol}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <p role="status">
            {visibleArticles.length} berita
            {ticker !== "all" ? ` terkait ${ticker}` : ""}. Filter mencocokkan
            judul berita.
          </p>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Berita belum dapat diperbarui</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {loading && !articles.length ? (
          <div
            className="news-loading"
            role="status"
            aria-label="Memuat berita"
          >
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-20" />
            ))}
          </div>
        ) : visibleArticles.length ? (
          <ul>
            {visibleArticles.map((article) => (
              <li key={article.url}>
                <div>
                  <Badge variant="outline">{article.source}</Badge>
                  {article.indexedAt && (
                    <time dateTime={article.indexedAt}>
                      {newsDateFormat.format(new Date(article.indexedAt))}
                    </time>
                  )}
                </div>
                <a href={article.url} target="_blank" rel="noreferrer">
                  {article.title}
                  <ExternalLink aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          (!error || articles.length > 0) && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {articles.length
                    ? "Tidak ada judul yang cocok"
                    : "Belum ada berita ditemukan"}
                </EmptyTitle>
                <EmptyDescription>
                  {articles.length
                    ? "Coba kata kunci lain atau tampilkan semua saham."
                    : "Sumber belum mengembalikan berita saham. Coba perbarui lagi nanti."}
                </EmptyDescription>
              </EmptyHeader>
              {(query || ticker !== "all") && (
                <EmptyContent>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setQuery("");
                      setTicker("all");
                    }}
                  >
                    Reset filter
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          )
        )}
      </section>
    </div>
  );
}

function WindowDots() {
  return (
    <span className="news-window-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
