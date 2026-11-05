import { useEffect, useMemo, useRef, useState } from "react";
import { NotebookTabs, SearchCheck } from "lucide-react";
import { api, session } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  const operation = useRef<AbortController | null>(null);
  const owner = useRef(userId);
  owner.current = userId;
  const items = records.owner === userId ? records.items : [];
  const lastPage = Math.max(0, Math.ceil(items.length / 25) - 1);
  const currentPage = Math.min(page, lastPage);
  const visibleItems = items.slice(currentPage * 25, (currentPage + 1) * 25);
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
    if (operation.current || loading || !userId || !pending.length) return;
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
      if (active()) setSaveError(message(e));
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
            Saved screening results
          </h1>
          <p>
            Keep the matched results you choose in Screener. Prices and signals
            are captured from that screening.
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
            {pending.length > 0 ? (
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
                      <Badge>{d.signal_type ?? "Match"}</Badge>
                    </TableCell>
                    <TableCell>{d.timeframe}</TableCell>
                    <TableCell>{time(d.candle_at)}</TableCell>
                    <TableCell>{price(d.price, d.currency)}</TableCell>
                    <TableCell>{time(d.screened_at)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {items.length > 25 && (
        <nav className="screening-journal__actions" aria-label="Journal pages">
          <p>
            {currentPage * 25 + 1}–
            {Math.min((currentPage + 1) * 25, items.length)} of {items.length}{" "}
            results
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
