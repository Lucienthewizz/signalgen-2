import { useEffect, useMemo, useRef, useState } from "react";
import "@/styles/screening-journal.css";
import { Download, NotebookTabs, SearchCheck } from "lucide-react";
import { api, ApiError, session } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { JournalPortfolio } from "@/components/journal-portfolio";
import { JournalBento } from "@/components/journal-bento";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  journalScreeningReceipt,
  type JournalScreeningDraft,
} from "@/lib/journal-screening";
import {
  isScreeningJournalRecord,
  type ScreeningJournalEntry,
} from "@/lib/screening-journal";
import { SINGAPORE_TIME_ZONE } from "@/lib/calendar";
import type { ServerRecord } from "@/lib/server-records";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import { DateInput } from "@/components/date-input";
import { downloadCsv } from "@/lib/csv";
import {
  emptyJournalFilters,
  filterJournal,
  journalCsvRows,
} from "@/lib/journal-explorer";

type Item = ServerRecord<ScreeningJournalEntry>;
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Journal is unavailable. Please try again.";
const time = (value: string) =>
  new Date(value).toLocaleString("en-GB", {
    timeZone: SINGAPORE_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  });
const price = (value: number, currency: string) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "IDR" ? 0 : 2,
  }).format(value);

export function JournalPanel({
  screeningDraft,
  screeningDrafts = [],
  userId,
  clearDraft,
}: {
  screeningDraft: JournalScreeningDraft | null;
  screeningDrafts?: JournalScreeningDraft[];
  userId?: string;
  clearDraft: () => void;
}) {
  const [records, setRecords] = useState<{ owner: string; items: Item[] }>({
    owner: "",
    items: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const [saveError, setSaveError] = useState("");
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState({ ...emptyJournalFilters });
  const [tradeDraft, setTradeDraft] = useState<ScreeningJournalEntry | null>(
    null,
  );
  const [detailId, setDetailId] = useState<string | null>(null);
  const [receiptInvalid, setReceiptInvalid] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const operation = useRef<AbortController | null>(null);
  const owner = useRef(userId);
  owner.current = userId;
  const items = records.owner === userId ? records.items : [];
  const filtered = useMemo(
    () => filterJournal(items, filters),
    [items, filters],
  );
  const rules = useMemo(
    () =>
      [
        ...new Map(
          items.map(({ data: d }) => [d.rule_id, d.rule_name]),
        ).entries(),
      ].sort((a, b) => a[1].localeCompare(b[1])),
    [items],
  );
  const detail = items.find((item) => item.id === detailId)?.data;
  const lastPage = Math.max(0, Math.ceil(filtered.length / 25) - 1);
  const currentPage = Math.min(page, lastPage);
  const visibleItems = filtered.slice(currentPage * 25, (currentPage + 1) * 25);
  const changeFilter = (key: keyof typeof filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(0);
    setDetailId(null);
    setExportNotice("");
  };
  useEffect(() => {
    if (detailId) detailHeading.current?.focus();
  }, [detailId]);
  const selected = useMemo(() => {
    const unique = new Set<string>();
    return [
      ...(screeningDraft ? [screeningDraft] : []),
      ...screeningDrafts,
    ].filter((d) => {
      const receipt = journalScreeningReceipt(d, userId);
      if (!receipt || unique.has(receipt)) return false;
      unique.add(receipt);
      return true;
    });
  }, [screeningDraft, screeningDrafts, userId]);
  const pending = selected.filter(
    (d) => !saved.includes(journalScreeningReceipt(d, userId)!),
  );

  useEffect(() => {
    const controller = new AbortController(),
      revision = session.getIdentityRevision();
    let alive = true;
    const active = () =>
      alive &&
      !controller.signal.aborted &&
      owner.current === userId &&
      session.getIdentityRevision() === revision;
    setLoading(true);
    setError("");
    if (userId)
      void api
        .listScreeningJournal(controller.signal)
        .then((response) => {
          if (active())
            setRecords({
              owner: userId,
              items: response.items.filter(isScreeningJournalRecord),
            });
        })
        .catch((e) => {
          if (active()) setError(message(e));
        })
        .finally(() => {
          if (active()) setLoading(false);
        });
    else setLoading(false);
    return () => {
      alive = false;
      controller.abort();
    };
  }, [userId, reload]);

  useEffect(() => {
    const stop = () => {
      operation.current?.abort();
      operation.current = null;
      setSaving(false);
      setSaved([]);
      setPage(0);
      setSaveError("");
      setReceiptInvalid(false);
      setDetailId(null);
      setFilters({ ...emptyJournalFilters });
      setExportNotice("");
      setRecords({ owner: "", items: [] });
    };
    stop();
    const unsubscribe = session.onIdentityChange(stop);
    return () => {
      operation.current?.abort();
      operation.current = null;
      unsubscribe();
    };
  }, [userId]);

  async function save() {
    if (
      operation.current ||
      loading ||
      receiptInvalid ||
      !userId ||
      !pending.length
    )
      return;
    const controller = new AbortController(),
      id = userId,
      revision = session.getIdentityRevision();
    const active = () =>
      !controller.signal.aborted &&
      owner.current === id &&
      session.getIdentityRevision() === revision;
    operation.current = controller;
    setSaving(true);
    setSaveError("");
    try {
      await api.ensureAppSession();
      for (const draft of pending) {
        if (!active()) return;
        const receipt = journalScreeningReceipt(draft, id);
        if (!receipt)
          throw Error("Run screening again and select a matched result.");
        const item = await api.saveScreeningJournal(receipt, controller.signal);
        if (!active()) return;
        if (!isScreeningJournalRecord(item))
          throw Error(
            "The server returned an invalid screening journal entry.",
          );
        setRecords((current) => ({
          owner: id,
          items: [
            item,
            ...(current.owner === id ? current.items : []).filter(
              (existing) => existing.id !== item.id,
            ),
          ],
        }));
        setSaved((current) => [...current, receipt]);
        setPage(0);
      }
    } catch (e) {
      if (active()) {
        setSaveError(message(e));
        setReceiptInvalid(
          e instanceof ApiError && e.code === "SCREENING_RECEIPT_INVALID",
        );
      }
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setSaving(false);
      }
    }
  }

  if (!userId) return <p>Sign in to view your screening journal.</p>;
  return (
    <section
      className="workspace-panel screening-journal"
      aria-label="Screening journal"
    >
      <div className="journal-toolbar screening-journal__intro">
        <div>
          <h1 id="workspace-route-heading" tabIndex={-1}>
            Screening journal
          </h1>
          <p>
            Save screening results, record your executed transactions, and
            review realized P&L.
          </p>
        </div>
        <Button
          variant="outline"
          nativeButton={false}
          render={<a href="#app/analysis" />}
        >
          <SearchCheck /> Open screener
        </Button>
      </div>
      {selected.length > 0 && (
        <section
          className="screening-journal__selection"
          aria-label="Selected screening results"
        >
          <div className="screening-journal__selection-heading">
            <h3>
              {selected.length} matched{" "}
              {selected.length === 1 ? "result" : "results"} selected
            </h3>
            <Badge>From screening</Badge>
          </div>
          <ul>
            {selected.map((d) => {
              const row = d.run.rows.find(
                (r) => r.decision.symbol === d.symbol,
              )!;
              const complete = saved.includes(
                journalScreeningReceipt(d, userId)!,
              );
              return (
                <li key={journalScreeningReceipt(d, userId)!}>
                  <strong>{d.symbol.replace(/\.JK$/, "")}</strong>
                  <span>{d.ruleName}</span>
                  <span>
                    {price(row.features.price, d.run.manifest.currency)}
                  </span>
                  <span>{complete ? "Saved" : "Ready to save"}</span>
                </li>
              );
            })}
          </ul>
          {saveError && (
            <Alert variant="destructive">
              <AlertTitle>Some results could not be saved</AlertTitle>
              <AlertDescription>
                {saveError} Results already saved will not be saved again.
              </AlertDescription>
            </Alert>
          )}
          <div className="screening-journal__actions">
            {receiptInvalid ? (
              <>
                <p>
                  This screening proof has expired or the API restarted. Saved
                  results are safe.
                </p>
                <Button
                  nativeButton={false}
                  render={<a href="#app/analysis" />}
                  onClick={clearDraft}
                >
                  Run screening again
                </Button>
              </>
            ) : pending.length > 0 ? (
              <Button onClick={() => void save()} disabled={saving || loading}>
                {saving
                  ? "Saving screening results…"
                  : saveError
                    ? "Retry unsaved results"
                    : `Save ${pending.length} ${pending.length === 1 ? "result" : "results"} to journal`}
              </Button>
            ) : (
              <>
                <p role="status">Selected results saved to your journal.</p>
                <Button variant="outline" onClick={clearDraft}>
                  Done
                </Button>
              </>
            )}
          </div>
        </section>
      )}
      {items.length > 0 && (
        <>
          <FieldGroup
            className="journal-explorer-filters"
            aria-label="Filter screening journal"
          >
            <Field>
              <FieldLabel htmlFor="journal-search">Search</FieldLabel>
              <Input
                id="journal-search"
                placeholder="Stock or rule…"
                value={filters.search}
                onChange={(e) => changeFilter("search", e.target.value)}
              />
            </Field>
            {(
              [
                ["rule", "Rule", [["", "All rules"], ...rules]],
                [
                  "signal",
                  "Signal",
                  [
                    ["", "All signals"],
                    ["BUY", "BUY"],
                    ["SELL", "SELL"],
                    ["MATCH", "Match (unspecified)"],
                  ],
                ],
                [
                  "market",
                  "Market",
                  [
                    ["", "All markets"],
                    ["IDX", "IDX · IDR"],
                    ["US", "US · USD"],
                  ],
                ],
                [
                  "sort",
                  "Sort",
                  [
                    ["newest", "Newest first"],
                    ["oldest", "Oldest first"],
                    ["symbol", "Stock symbol"],
                  ],
                ],
              ] as [keyof typeof filters, string, string[][]][]
            ).map(([key, label, options]) => (
              <Field key={key}>
                <FieldLabel htmlFor={`journal-${key}`}>{label}</FieldLabel>
                <Select
                  value={filters[key]}
                  onValueChange={(value) => changeFilter(key, value ?? "")}
                >
                  <SelectTrigger id={`journal-${key}`}>
                    <SelectValue>
                      {options.find((o) => o[0] === filters[key])?.[1]}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {options.map(([value, label]) => (
                        <SelectItem value={value} key={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            ))}
            <Field>
              <FieldLabel htmlFor="journal-from">
                Screened from (SGT)
              </FieldLabel>
              <DateInput
                id="journal-from"
                value={filters.from}
                onValueChange={(value) => changeFilter("from", value)}
                max={filters.to || undefined}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="journal-to">Screened to (SGT)</FieldLabel>
              <DateInput
                id="journal-to"
                value={filters.to}
                onValueChange={(value) => changeFilter("to", value)}
                min={filters.from || undefined}
              />
            </Field>
          </FieldGroup>
          <div className="screening-journal__actions journal-explorer-actions">
            <p role="status">
              {filtered.length} of {items.length} saved results · date filters
              use screening time in SGT
            </p>
            <div>
              <Button
                variant="ghost"
                onClick={() => {
                  setFilters({ ...emptyJournalFilters });
                  setPage(0);
                  setDetailId(null);
                  setExportNotice("");
                }}
              >
                Clear filters
              </Button>
              <Button
                variant="outline"
                disabled={!filtered.length}
                onClick={() => {
                  downloadCsv(
                    "signalgen-screening-journal.csv",
                    journalCsvRows(filtered),
                  );
                  setExportNotice(
                    `Exported ${filtered.length} screening snapshots.`,
                  );
                }}
              >
                <Download data-icon="inline-start" /> Export filtered CSV
              </Button>
            </div>
          </div>
          {exportNotice && <p role="status">{exportNotice}</p>}
        </>
      )}
      <JournalBento
        items={filtered}
        portfolio={
          <JournalPortfolio
            key={userId}
            userId={userId}
            draft={tradeDraft}
            onClearDraft={() => setTradeDraft(null)}
          />
        }
      />
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Journal unavailable</AlertTitle>
          <AlertDescription>
            {error}{" "}
            {items.length > 0 && "Previously loaded results remain visible."}
          </AlertDescription>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReload((v) => v + 1)}
          >
            Retry journal
          </Button>
        </Alert>
      )}
      {loading && items.length === 0 ? (
        <div
          className="screening-journal__loading"
          aria-label="Loading screening journal"
          aria-busy="true"
        >
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : items.length === 0 && !error ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <NotebookTabs />
            </EmptyMedia>
            <EmptyTitle>No screening results saved yet</EmptyTitle>
            <EmptyDescription>
              Run a screening, select matched stocks, then choose Add to
              journal.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : items.length > 0 && !filtered.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No results match these filters</EmptyTitle>
            <EmptyDescription>
              Try another stock, rule or date range. Your saved snapshots have
              not changed.
            </EmptyDescription>
          </EmptyHeader>
          <Button
            variant="outline"
            onClick={() => {
              setFilters({ ...emptyJournalFilters });
              setPage(0);
            }}
          >
            Reset journal filters
          </Button>
        </Empty>
      ) : items.length > 0 ? (
        <div className="journal-ledger">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stock</TableHead>
                <TableHead>Market</TableHead>
                <TableHead>Rule</TableHead>
                <TableHead>Signal</TableHead>
                <TableHead>Interval</TableHead>
                <TableHead>Candle time (SGT)</TableHead>
                <TableHead>Screening price</TableHead>
                <TableHead>Screened at (SGT)</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleItems.map((item) => {
                const d = item.data;
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <strong>{d.symbol.replace(/\.JK$/, "")}</strong>
                    </TableCell>
                    <TableCell>
                      {d.market} / {d.currency}
                    </TableCell>
                    <TableCell>{d.rule_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" data-signal={d.signal_type}>
                        {d.signal_type ?? "Match"}
                      </Badge>
                    </TableCell>
                    <TableCell>{d.timeframe}</TableCell>
                    <TableCell>{time(d.candle_at)}</TableCell>
                    <TableCell>{price(d.price, d.currency)}</TableCell>
                    <TableCell>{time(d.screened_at)}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-expanded={detailId === item.id}
                        aria-controls="journal-snapshot-detail"
                        onClick={() =>
                          setDetailId(detailId === item.id ? null : item.id)
                        }
                      >
                        View {d.symbol.replace(/\.JK$/, "")} details
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setTradeDraft({ ...d })}
                      >
                        Record {d.symbol.replace(/\.JK$/, "")} trade
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {detail && (
        <section
          id="journal-snapshot-detail"
          className="journal-snapshot-detail"
          aria-label="Screening snapshot details"
        >
          <div className="screening-journal__actions">
            <h2 ref={detailHeading} tabIndex={-1}>
              {detail.symbol.replace(/\.JK$/, "")} · Screening details
            </h2>
            <Button
              variant="ghost"
              onClick={() => {
                setDetailId(null);
                document
                  .querySelector<HTMLButtonElement>(
                    'button[aria-expanded="true"][aria-controls="journal-snapshot-detail"]',
                  )
                  ?.focus();
              }}
            >
              Close details
            </Button>
          </div>
          <p>Read-only snapshot. Not a broker fill or a live quote.</p>
          <dl>
            <div>
              <dt>Rule</dt>
              <dd>{detail.rule_name}</dd>
            </div>
            <div>
              <dt>Signal</dt>
              <dd>
                <Badge variant="outline" data-signal={detail.signal_type}>
                  {detail.signal_type ?? "Match"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>Screening price</dt>
              <dd>{price(detail.price, detail.currency)}</dd>
            </div>
            <div>
              <dt>Market / interval</dt>
              <dd>
                {detail.market} / {detail.timeframe}
              </dd>
            </div>
            <div>
              <dt>Candle (SGT)</dt>
              <dd>{time(detail.candle_at)}</dd>
            </div>
            <div>
              <dt>Screened (SGT)</dt>
              <dd>{time(detail.screened_at)}</dd>
            </div>
            {Object.entries({
              RSI14: detail.features?.rsi14,
              EMA9: detail.features?.ema9,
              EMA20: detail.features?.ema20,
              ...detail.features?.values,
            }).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  {Number.isFinite(value)
                    ? new Intl.NumberFormat("en-GB", {
                        maximumFractionDigits: 4,
                      }).format(value)
                    : "Unavailable"}
                </dd>
              </div>
            ))}
          </dl>
          <h3>Match evidence</h3>
          <ul>
            {(detail.reason_codes ?? []).map((reason, i) => (
              <li key={i}>{reason.replaceAll("_", " ")}</li>
            ))}
          </ul>
          <details>
            <summary>Snapshot verification metadata</summary>
            <dl>
              <div>
                <dt>Dataset checksum</dt>
                <dd>{detail.dataset_checksum || "Unavailable"}</dd>
              </div>
              <div>
                <dt>Rule definition hash</dt>
                <dd>{detail.definition_hash || "Unavailable"}</dd>
              </div>
            </dl>
          </details>
        </section>
      )}
      {filtered.length > 25 && (
        <nav className="screening-journal__actions" aria-label="Journal pages">
          <p>
            {currentPage * 25 + 1}–
            {Math.min((currentPage + 1) * 25, filtered.length)} of{" "}
            {filtered.length} results
          </p>
          <div>
            <Button
              variant="outline"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous results
            </Button>
            <Button
              variant="outline"
              disabled={currentPage === lastPage}
              onClick={() => setPage(currentPage + 1)}
            >
              Next results
            </Button>
          </div>
        </nav>
      )}
      <p className="screening-journal__note">
        A saved signal is a screening snapshot. It does not record a broker
        transaction.
      </p>
    </section>
  );
}
