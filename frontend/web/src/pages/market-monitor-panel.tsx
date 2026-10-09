import { useEffect, useState, type FormEvent } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ExternalLink,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { TradingViewChart } from "@/components/tradingview-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { idxTicker, monitorRuns, priceMovement } from "@/lib/market-monitor";
import {
  hasWorkspaceData,
  readWorkspaceData,
  writeWorkspaceData,
} from "@/lib/workspace-storage";

const names: Record<string, string> = {
  BBCA: "Bank Central Asia",
  BBRI: "Bank Rakyat Indonesia",
  TLKM: "Telkom Indonesia",
  BMRI: "Bank Mandiri",
  ASII: "Astra International",
};
const defaults = ["BBCA", "BBRI", "TLKM", "BMRI", "ASII"];
const number = (value: number) =>
  Number.isFinite(value)
    ? new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(value)
    : "—";
const date = (value: string) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Waktu tidak tersedia";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
};

export function MarketMonitorPanel({ userId }: { userId?: string }) {
  const key = `signalgen:watchlist:${userId ?? "guest"}`;
  const [watchlist, setWatchlist] = useState<string[]>(defaults);
  const [selected, setSelected] = useState("BBCA");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState(() => monitorRuns(userId));
  useEffect(() => {
    let items = defaults;
    try {
      const stored: unknown =
        userId && hasWorkspaceData(userId, "watchlist")
          ? readWorkspaceData(userId, "watchlist")
          : JSON.parse(localStorage.getItem(key) ?? "null");
      if (Array.isArray(stored)) {
        const valid = [
          ...new Set(
            stored.filter(
              (s): s is string => typeof s === "string" && idxTicker(s) === s,
            ),
          ),
        ].slice(0, 30);
        if (stored.length === 0 || valid.length) items = valid;
      }
    } catch {
      /* Corrupt or blocked storage falls back to the starter watchlist. */
    }
    setWatchlist(items);
    setSelected(items[0] ?? "BBCA");
    setRuns(monitorRuns(userId));
    const update = () => setRuns(monitorRuns(userId));
    window.addEventListener("signalgen:monitor-run", update);
    return () => window.removeEventListener("signalgen:monitor-run", update);
  }, [key, userId]);
  function save(items: string[]) {
    setWatchlist(items);
    try {
      if (userId) {
        if (!writeWorkspaceData(userId, "watchlist", items))
          throw Error("storage");
      } else localStorage.setItem(key, JSON.stringify(items));
    } catch {
      setError("Watchlist hanya tersimpan selama halaman ini terbuka.");
    }
  }
  function add(event: FormEvent) {
    event.preventDefault();
    const ticker = idxTicker(query);
    if (!ticker) {
      setError("Masukkan kode IDX 4 huruf, misalnya BBCA.");
      return;
    }
    if (watchlist.length >= 30 && !watchlist.includes(ticker)) {
      setError("Maksimal 30 saham dalam watchlist.");
      return;
    }
    setError(null);
    if (!watchlist.includes(ticker)) save([...watchlist, ticker]);
    setSelected(ticker);
    setQuery("");
  }
  function remove(ticker: string) {
    const next = watchlist.filter((s) => s !== ticker);
    save(next);
    if (selected === ticker) setSelected(next[0] ?? "BBCA");
  }
  const entries = runs.flatMap((record) =>
    record.run.rows
      .filter((row) => idxTicker(row.decision.symbol) === selected)
      .map((row) => ({ ...row, record })),
  );
  return (
    <div className="market-monitor">
      <nav className="monitor-strip" aria-label="Pilihan saham">
        <span>
          <Activity aria-hidden="true" /> IDX
        </span>
        {watchlist.map((ticker) => (
          <button
            type="button"
            key={ticker}
            aria-pressed={selected === ticker}
            onClick={() => setSelected(ticker)}
          >
            {ticker}
            <small>{names[ticker] ?? "Saham IDX"}</small>
          </button>
        ))}
      </nav>
      <section className="monitor-chart" aria-label={`Chart ${selected}`}>
        <header>
          <span className="monitor-window-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <div className="monitor-chart__title">
            <h3>{selected}</h3>
            <p>{names[selected] ?? "Saham IDX"}</p>
            <Badge variant="outline">Harian · IDR</Badge>
          </div>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <a
                href={`https://www.tradingview.com/symbols/IDX-${selected}/`}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            TradingView
            <ExternalLink data-icon="inline-end" />
          </Button>
        </header>
        <TradingViewChart symbol={`IDX:${selected}`} label={selected} />
        <footer>
          Chart dari TradingView. Ketersediaan dan delay mengikuti penyedia
          data.
        </footer>
      </section>
      <section
        className="monitor-ledger"
        aria-label="Watchlist dan hasil screening"
      >
        <header>
          <div>
            <h3>Watchlist & hasil screening</h3>
            <p>Snapshot candle harian terakhir. Bukan harga live.</p>
          </div>
          <form onSubmit={add}>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="monitor-symbol" className="sr-only">
                Tambah saham
              </FieldLabel>
              <div className="monitor-add">
                <Input
                  id="monitor-symbol"
                  placeholder="Kode IDX, misalnya BBCA"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setError(null);
                  }}
                  aria-invalid={Boolean(error)}
                />
                <Button type="submit" variant="outline">
                  <Plus data-icon="inline-start" />
                  Tambah saham
                </Button>
              </div>
              {error && <FieldError>{error}</FieldError>}
            </Field>
          </form>
        </header>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Saham</TableHead>
              <TableHead className="monitor-price-heading--open">
                Harga buka (IDR)
              </TableHead>
              <TableHead className="monitor-price-heading--close">
                Harga tutup (IDR)
              </TableHead>
              <TableHead>RSI 14</TableHead>
              <TableHead>EMA 20</TableHead>
              <TableHead>Hasil rule</TableHead>
              <TableHead>Waktu data</TableHead>
              <TableHead>
                <span className="sr-only">Hapus saham</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {watchlist.map((ticker) => {
              const snapshot = runs.flatMap((record) =>
                record.run.rows
                  .filter((row) => idxTicker(row.decision.symbol) === ticker)
                  .map((row) => ({ ...row, record })),
              )[0];
              const movement = priceMovement(
                snapshot?.latestOpen,
                snapshot?.latestClose,
              );
              const hasOpen =
                snapshot?.latestOpen != null &&
                Number.isFinite(snapshot.latestOpen);
              const hasClose =
                snapshot?.latestClose != null &&
                Number.isFinite(snapshot.latestClose);
              return (
                <TableRow
                  key={ticker}
                  data-state={selected === ticker ? "selected" : undefined}
                >
                  <TableCell>
                    <Button
                      variant="ghost"
                      aria-pressed={selected === ticker}
                      onClick={() => setSelected(ticker)}
                    >
                      {ticker}
                    </Button>
                    <span className="monitor-company">
                      {names[ticker] ?? "Saham IDX"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className="monitor-price"
                      data-price={hasOpen ? "open" : "missing"}
                    >
                      {hasOpen ? number(snapshot.latestOpen!) : "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className="monitor-price"
                      data-price={hasClose ? movement : "missing"}
                    >
                      {movement === "up" && <ArrowUpRight aria-hidden="true" />}
                      {movement === "down" && (
                        <ArrowDownRight aria-hidden="true" />
                      )}
                      {movement === "flat" && <Minus aria-hidden="true" />}
                      {hasClose ? number(snapshot.latestClose) : "—"}
                      {movement !== "unknown" && (
                        <span className="sr-only">
                          {movement === "up"
                            ? "Naik dari harga buka"
                            : movement === "down"
                              ? "Turun dari harga buka"
                              : "Sama dengan harga buka"}
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    {snapshot ? number(snapshot.features.rsi14) : "—"}
                  </TableCell>
                  <TableCell>
                    {snapshot ? number(snapshot.features.ema20) : "—"}
                  </TableCell>
                  <TableCell>
                    {snapshot ? (
                      <>
                        <Badge
                          variant={
                            snapshot.decision.matched ? "secondary" : "outline"
                          }
                        >
                          {snapshot.decision.matched
                            ? "Sesuai rule"
                            : "Tidak sesuai"}
                        </Badge>
                        <span className="monitor-company">
                          {snapshot.record.rule}
                        </span>
                      </>
                    ) : (
                      <Badge variant="outline">Belum dievaluasi</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {snapshot ? date(snapshot.decision.timestamp) : "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Hapus ${ticker} dari watchlist`}
                      onClick={() => remove(ticker)}
                    >
                      <X />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {!watchlist.length && (
              <TableRow>
                <TableCell colSpan={8}>
                  Tambahkan kode saham untuk mulai memantau.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <footer>
          Watchlist disimpan di workspace Anda.{" "}
          <a href="#app/analysis">Jalankan screener</a> untuk mengisi hasil dan
          indikator.
        </footer>
      </section>
      <section
        className="monitor-history"
        aria-labelledby="monitor-history-title"
      >
        <header>
          <h3 id="monitor-history-title">Riwayat screening {selected}</h3>
          <span>Riwayat tersimpan · bukan sinyal otomatis</span>
        </header>
        {entries.length ? (
          <ol>
            {entries.map(({ decision, record }, index) => (
              <li key={`${record.recordedAt}-${index}`}>
                <time dateTime={record.recordedAt}>
                  {date(record.recordedAt)}
                </time>
                <strong>{record.rule}</strong>
                <Badge variant={decision.matched ? "secondary" : "outline"}>
                  {decision.matched ? "Sesuai rule" : "Tidak sesuai"}
                </Badge>
              </li>
            ))}
          </ol>
        ) : (
          <p>
            Hasil screening saham ini akan muncul setelah run selesai. Sepuluh
            screening terbaru tersedia hingga 30 hari.
          </p>
        )}
      </section>
    </div>
  );
}
