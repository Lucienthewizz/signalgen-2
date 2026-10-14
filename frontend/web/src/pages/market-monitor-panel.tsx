import { useEffect, useMemo, useState, type FormEvent } from "react";
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  idxTicker,
  monitorRuns,
  priceMovement,
  openCloseChange,
  snapshotAge,
} from "@/lib/market-monitor";
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
    ? new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(value)
    : "—";
const date = (value: string) => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-GB", {
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
  const [sort, setSort] = useState("watchlist");
  const snapshots = useMemo(() => {
    const items = new Map<
      string,
      (typeof runs)[number]["run"]["rows"][number] & {
        record: (typeof runs)[number];
      }
    >();
    for (const record of runs)
      for (const row of record.run.rows) {
        const ticker = idxTicker(row.decision.symbol);
        if (ticker && !items.has(ticker)) items.set(ticker, { ...row, record });
      }
    return items;
  }, [runs]);
  const displayedWatchlist = useMemo(() => {
    if (sort === "watchlist") return watchlist;
    const score = (ticker: string) => {
      const item = snapshots.get(ticker);
      if (!item) return -Infinity;
      if (sort === "change")
        return openCloseChange(item.latestOpen, item.latestClose) ?? -Infinity;
      if (sort === "matched") return Number(item.decision.matched);
      return Date.parse(item.decision.timestamp) || -Infinity;
    };
    return [...watchlist].sort((a, b) => {
      const x = score(a),
        y = score(b);
      return (x === y ? 0 : x > y ? -1 : 1) || a.localeCompare(b);
    });
  }, [watchlist, snapshots, sort]);
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
      setError("Your watchlist is available only while this page is open.");
    }
  }
  function add(event: FormEvent) {
    event.preventDefault();
    const ticker = idxTicker(query);
    if (!ticker) {
      setError("Enter a four-letter IDX ticker, such as BBCA.");
      return;
    }
    if (watchlist.length >= 30 && !watchlist.includes(ticker)) {
      setError("Your watchlist can contain up to 30 stocks.");
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
      <nav className="monitor-strip" aria-label="Stock selection">
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
            <small>{names[ticker] ?? "IDX stock"}</small>
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
            <p>{names[selected] ?? "IDX stock"}</p>
            <Badge variant="outline">Daily · IDR</Badge>
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
          Chart by TradingView. Availability and delays follow the data
          provider.
        </footer>
      </section>
      <section
        className="monitor-ledger"
        aria-label="Watchlist and screening results"
      >
        <header>
          <div>
            <h3>Watchlist & screening results</h3>
            <p>Latest daily candle snapshots. Not live prices.</p>
          </div>
          <form onSubmit={add}>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="monitor-symbol" className="sr-only">
                Add stock
              </FieldLabel>
              <div className="monitor-add">
                <Input
                  id="monitor-symbol"
                  placeholder="IDX ticker, e.g. BBCA"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setError(null);
                  }}
                  aria-invalid={Boolean(error)}
                />
                <Button type="submit" variant="outline">
                  <Plus data-icon="inline-start" />
                  Add stock
                </Button>
              </div>
              {error && <FieldError>{error}</FieldError>}
            </Field>
          </form>
        </header>
        <div className="monitor-toolbar">
          <Field>
            <FieldLabel htmlFor="monitor-sort">Sort table</FieldLabel>
            <Select
              value={sort}
              onValueChange={(value) => setSort(value ?? "watchlist")}
              items={[
                { value: "watchlist", label: "Watchlist order" },
                { value: "change", label: "Highest open-to-close change" },
                { value: "matched", label: "Matches first" },
                { value: "latest", label: "Latest candle" },
              ]}
            >
              <SelectTrigger id="monitor-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="watchlist">Watchlist order</SelectItem>
                  <SelectItem value="change">
                    Highest open-to-close change
                  </SelectItem>
                  <SelectItem value="matched">Matches first</SelectItem>
                  <SelectItem value="latest">Latest candle</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <p>
            Percentages compare the open and close of the same candle, not the
            previous day's close.
          </p>
        </div>
        <Table>
          <colgroup>
            <col style={{ width: "18%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "6%" }} />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>Stock</TableHead>
              <TableHead className="monitor-price-heading--open">
                Open <span className="monitor-unit">IDR</span>
              </TableHead>
              <TableHead className="monitor-price-heading--close">
                Close <span className="monitor-unit">IDR</span>
              </TableHead>
              <TableHead>RSI 14</TableHead>
              <TableHead>EMA 20</TableHead>
              <TableHead>Rule result</TableHead>
              <TableHead>Data time</TableHead>
              <TableHead>
                <span className="sr-only">Remove stock</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayedWatchlist.map((ticker) => {
              const snapshot = snapshots.get(ticker);
              const change = openCloseChange(
                snapshot?.latestOpen,
                snapshot?.latestClose,
              );
              const age = snapshotAge(snapshot?.decision.timestamp);
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
                  <TableCell data-label="Stock">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-pressed={selected === ticker}
                      onClick={() => setSelected(ticker)}
                    >
                      {ticker}
                    </Button>
                    <span
                      className="monitor-company"
                      title={names[ticker] ?? "IDX stock"}
                    >
                      {names[ticker] ?? "IDX stock"}
                    </span>
                  </TableCell>
                  <TableCell data-label="Open · IDR">
                    <span
                      className="monitor-price"
                      data-price={hasOpen ? "open" : "missing"}
                    >
                      {hasOpen ? number(snapshot.latestOpen!) : "—"}
                    </span>
                  </TableCell>
                  <TableCell data-label="Close · IDR">
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
                            ? "Above opening price"
                            : movement === "down"
                              ? "Below opening price"
                              : "Unchanged from opening price"}
                        </span>
                      )}
                    </span>
                    {change !== null && (
                      <small
                        className="monitor-change"
                        data-direction={movement}
                      >
                        {change > 0 ? "+" : ""}
                        {number(change)}%
                      </small>
                    )}
                  </TableCell>
                  <TableCell data-label="RSI 14">
                    {snapshot ? number(snapshot.features.rsi14) : "—"}
                  </TableCell>
                  <TableCell data-label="EMA 20">
                    {snapshot ? number(snapshot.features.ema20) : "—"}
                  </TableCell>
                  <TableCell data-label="Rule result">
                    <div className="monitor-result">
                      {snapshot ? (
                        <>
                          <Badge
                            variant={
                              snapshot.decision.matched
                                ? "secondary"
                                : "outline"
                            }
                          >
                            {snapshot.decision.matched
                              ? "Matched"
                              : "Not matched"}
                          </Badge>
                          <span
                            className="monitor-company"
                            title={snapshot.record.rule}
                          >
                            {snapshot.record.rule}
                          </span>
                        </>
                      ) : (
                        <Badge variant="outline">Not evaluated</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell data-label="Data time">
                    {snapshot ? (
                      <time dateTime={snapshot.decision.timestamp}>
                        {date(snapshot.decision.timestamp)}
                      </time>
                    ) : (
                      "—"
                    )}
                    {age === "old" && (
                      <Badge variant="outline">Older snapshot</Badge>
                    )}
                    {age === "future" && (
                      <Badge variant="destructive">Check data time</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${ticker} from watchlist`}
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
                  Add a stock ticker to start monitoring.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <footer>
          Your watchlist is saved in your workspace.{" "}
          <a href="#app/analysis">Run screener</a> to populate results and
          indicators. Snapshots older than seven calendar days are marked as
          older; this does not account for the exchange trading calendar.
        </footer>
      </section>
      <section
        className="monitor-history"
        aria-labelledby="monitor-history-title"
      >
        <header>
          <h3 id="monitor-history-title">Screening history {selected}</h3>
          <span>Saved history · not automated signals</span>
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
                  {decision.matched ? "Matched" : "Not matched"}
                </Badge>
              </li>
            ))}
          </ol>
        ) : (
          <p>
            Results for this stock appear after a completed run. The ten most
            recent runs are available for up to 30 days.
          </p>
        )}
      </section>
    </div>
  );
}
