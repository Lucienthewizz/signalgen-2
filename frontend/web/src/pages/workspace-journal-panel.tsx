import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, RefreshCw, Save, Pencil, Trash2 } from "lucide-react";
import { api, session } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { useActionNotifications } from "@/components/ui/toast";
import { JournalScreeningVerification } from "@/components/journal-screening-verification";
import { JournalPnlChart } from "@/components/journal-pnl-chart";
import { journalPerformance, localJournalDate } from "@/lib/journal";
import type { JournalScreeningDraft } from "@/lib/journal-screening";
import type {
  RecordedTrade,
  TradeInput,
  ServerRecord,
} from "@/lib/server-records";

const blank = (): TradeInput => ({
  symbol: "",
  market: "IDX",
  currency: "IDR",
  side: "BUY",
  quantity: 100,
  entry_price: 0,
  exit_price: null,
  entry_fee: 0,
  exit_fee: 0,
  entry_date: localJournalDate(),
  exit_date: "",
  book: "Trading journal",
  note: "",
});
type Item = ServerRecord<RecordedTrade>;
const message = (e: unknown) =>
  e instanceof Error
    ? e.message
    : "Journal request failed. Retry when the server is available.";
export function JournalPanel({
  draftSymbol,
  clearDraft,
  screeningDraft,
  userId,
}: {
  draftSymbol: string | null;
  clearDraft: () => void;
  screeningDraft: JournalScreeningDraft | null;
  userId?: string;
}) {
  const [records, setRecords] = useState<{ owner: string; items: Item[] }>({
    owner: "",
    items: [],
  });
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [reload, setReload] = useState(0);
  const [captureOpen, setCaptureOpen] = useState(
      Boolean(draftSymbol) && !screeningDraft,
    ),
    [form, setForm] = useState<TradeInput>(blank),
    [editing, setEditing] = useState<Item | null>(null),
    [pendingDelete, setPendingDelete] = useState<Item | null>(null);
  const [month, setMonth] = useState(""),
    [instrument, setInstrument] = useState(""),
    [book, setBook] = useState(""),
    [currency, setCurrency] = useState("IDR");
  const captureTrigger = useRef<HTMLButtonElement>(null),
    returnFocus = useRef<HTMLButtonElement | null>(null),
    operation = useRef<AbortController | null>(null),
    lock = useRef(false);
  const newRecordID = useRef(crypto.randomUUID());
  useActionNotifications(notice, error);
  const ownerRef = useRef(userId);
  ownerRef.current = userId;
  useEffect(() => {
    const controller = new AbortController(),
      revision = session.getIdentityRevision();
    let alive = true;
    const active = () =>
      alive &&
      !controller.signal.aborted &&
      session.getIdentityRevision() === revision &&
      ownerRef.current === userId;
    setLoading(true);
    setError(null);
    setRecords({ owner: userId ?? "", items: [] });
    if (userId)
      void api
        .listRecords<RecordedTrade>("journal", controller.signal)
        .then((r) => {
          if (active()) setRecords({ owner: userId, items: r.items });
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
    operation.current?.abort();
    operation.current = null;
    lock.current = false;
    setBusy(false);
    newRecordID.current = crypto.randomUUID();
    setForm({ ...blank(), symbol: draftSymbol ?? "" });
    setEditing(null);
    setPendingDelete(null);
    const stop = session.onIdentityChange(() => {
      operation.current?.abort();
      operation.current = null;
      lock.current = false;
      setBusy(false);
      newRecordID.current = crypto.randomUUID();
      setRecords({ owner: "", items: [] });
      setForm(blank());
      setEditing(null);
      setPendingDelete(null);
      setCaptureOpen(false);
      setNotice(null);
      setError(null);
    });
    return () => {
      operation.current?.abort();
      stop();
    };
  }, [userId]);
  useEffect(() => {
    if (draftSymbol && !screeningDraft) {
      setForm((f) => ({ ...f, symbol: draftSymbol }));
      setCaptureOpen(true);
    }
  }, [draftSymbol, screeningDraft]);
  const items = records.owner === userId ? records.items : [];
  const visible = useMemo(
    () =>
      items
        .filter(
          (r) =>
            r.data.currency === currency &&
            (!instrument || r.data.symbol === instrument) &&
            (!book || r.data.book === book) &&
            (!month ||
              (r.data.exit_date || r.data.entry_date).slice(0, 7) === month),
        )
        .sort(
          (a, b) =>
            (b.data.exit_date || b.data.entry_date).localeCompare(
              a.data.exit_date || a.data.entry_date,
            ) || a.id.localeCompare(b.id),
        ),
    [items, currency, instrument, book, month],
  );
  const closed = visible
    .filter((r) => r.data.net_pl !== null && r.data.exit_price !== null)
    .map((r) => ({
      id: r.id,
      closedAt: r.data.exit_date + "T12:00:00Z",
      symbol: r.data.symbol,
      exit: r.data.exit_price!,
      pnl: r.data.net_pl!,
    }));
  const metrics = journalPerformance(closed);
  const money = (n: number) =>
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  function reset() {
    newRecordID.current = crypto.randomUUID();
    setForm(blank());
    setEditing(null);
    setCaptureOpen(false);
    clearDraft();
  }
  async function mutate(remove?: Item) {
    if (lock.current || !userId) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const controller = new AbortController();
    operation.current = controller;
    const owner = userId,
      revision = session.getIdentityRevision();
    const active = () =>
      !controller.signal.aborted &&
      ownerRef.current === owner &&
      session.getIdentityRevision() === revision;
    try {
      await api.ensureAppSession();
      if (!active()) return;
      if (remove)
        await api.deleteRecord(
          "journal",
          remove.id,
          remove.version,
          controller.signal,
        );
      else
        await api.saveRecord<RecordedTrade>(
          "journal",
          editing?.id ?? newRecordID.current,
          editing?.version ?? 0,
          form,
          controller.signal,
        );
      if (!active()) return;
      setNotice(remove ? "Trade deleted." : "Trade saved to your account.");
      setPendingDelete(null);
      reset();
      setReload((n) => n + 1);
    } catch (e) {
      if (active()) setError(message(e));
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        lock.current = false;
        if (active()) setBusy(false);
      }
    }
  }
  const change = <K extends keyof TradeInput>(key: K, value: TradeInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  function submit(e: FormEvent) {
    e.preventDefault();
    void mutate();
  }
  return (
    <div className="journal-workspace">
      <JournalScreeningVerification
        draft={screeningDraft}
        userId={userId}
        returnFocus={captureTrigger}
        onClose={clearDraft}
        onVerified={(draft) => {
          const row = draft.run.rows.find(
            (r) => r.decision.symbol === draft.symbol,
          )!;
          setEditing(null);
          setForm({
            ...blank(),
            symbol: draft.symbol.replace(/\.JK$/, ""),
            side: row.decision.signal_type ?? "BUY",
            entry_price: row.latestClose,
            market: draft.run.manifest.market as "IDX" | "US",
            currency: draft.run.manifest.currency as "IDR" | "USD",
            quantity: draft.run.manifest.market === "IDX" ? 100 : 1,
          });
          clearDraft();
          setCaptureOpen(true);
        }}
      />
      <section className="journal-toolbar" aria-label="Journal filters">
        <FieldGroup className="journal-toolbar__filters">
          <Field>
            <FieldLabel htmlFor="journal-currency">Currency</FieldLabel>
            <select
              id="journal-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              <option>IDR</option>
              <option>USD</option>
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="journal-book">Journal</FieldLabel>
            <select
              id="journal-book"
              value={book}
              onChange={(e) => setBook(e.target.value)}
            >
              <option value="">All journals</option>
              {[...new Set(items.map((r) => r.data.book))].map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="journal-instrument">Instrument</FieldLabel>
            <select
              id="journal-instrument"
              value={instrument}
              onChange={(e) => setInstrument(e.target.value)}
            >
              <option value="">All instruments</option>
              {[...new Set(items.map((r) => r.data.symbol))].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field className="journal-month-filter">
            <FieldLabel htmlFor="journal-month">Month</FieldLabel>
            <div>
              <Input
                id="journal-month"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Clear month filter"
                disabled={!month}
                onClick={() => setMonth("")}
              >
                <X />
              </Button>
            </div>
          </Field>
        </FieldGroup>
        <div className="journal-toolbar__actions">
          <Button
            variant="outline"
            size="icon"
            aria-label="Refresh journal"
            disabled={loading || busy}
            onClick={() => setReload((n) => n + 1)}
          >
            <RefreshCw />
          </Button>
          <Button
            ref={captureTrigger}
            variant={captureOpen ? "destructive" : "default"}
            disabled={busy}
            aria-expanded={captureOpen}
            onClick={() =>
              captureOpen
                ? reset()
                : (setEditing(null), setForm(blank()), setCaptureOpen(true))
            }
          >
            {captureOpen ? (
              <X data-icon="inline-start" />
            ) : (
              <Plus data-icon="inline-start" />
            )}
            {captureOpen ? "Close journal form" : "Open journal form"}
          </Button>
        </div>
      </section>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Journal unavailable</AlertTitle>
          <AlertDescription>
            {error}{" "}
            <Button
              variant="outline"
              disabled={loading || busy}
              onClick={() => setReload((n) => n + 1)}
            >
              Retry journal
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {captureOpen && (
        <section className="panel journal-capture">
          <div className="panel-heading">
            <div>
              <h3>{editing ? "Edit recorded trade" : "Record a trade"}</h3>
              <p>
                User-recorded transactions, not broker-verified fills. Leave
                exit fields empty for an open position. P&amp;L is calculated by
                the server after fees.
              </p>
            </div>
            <Badge variant="outline">{form.currency}</Badge>
          </div>
          <form className="control-grid" onSubmit={submit}>
            <fieldset
              className="journal-trade-fields control-wide"
              disabled={busy}
            >
              <FieldGroup className="control-grid">
                <Field>
                  <FieldLabel htmlFor="trade-market">Market</FieldLabel>
                  <select
                    id="trade-market"
                    value={form.market}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        market: e.target.value as "IDX" | "US",
                        currency: e.target.value === "IDX" ? "IDR" : "USD",
                        quantity: e.target.value === "IDX" ? 100 : 1,
                      }))
                    }
                  >
                    <option>IDX</option>
                    <option>US</option>
                  </select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="trade-symbol">Symbol</FieldLabel>
                  <Input
                    id="trade-symbol"
                    required
                    maxLength={20}
                    placeholder="e.g. BBCA"
                    value={form.symbol}
                    onChange={(e) =>
                      change("symbol", e.target.value.toUpperCase())
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="trade-side">Side</FieldLabel>
                  <select
                    id="trade-side"
                    value={form.side}
                    onChange={(e) =>
                      change("side", e.target.value as "BUY" | "SELL")
                    }
                  >
                    <option value="BUY">BUY / Long</option>
                    <option value="SELL">SELL / Short</option>
                  </select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="trade-quantity">
                    {form.market === "IDX" ? "Lot" : "Shares"}
                  </FieldLabel>
                  <Input
                    id="trade-quantity"
                    type="number"
                    required
                    min={form.market === "IDX" ? 1 : 0.000001}
                    step={form.market === "IDX" ? 1 : "any"}
                    value={form.quantity / (form.market === "IDX" ? 100 : 1)}
                    onChange={(e) =>
                      change(
                        "quantity",
                        Number(e.target.value) *
                          (form.market === "IDX" ? 100 : 1),
                      )
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="trade-entry">
                    Entry price ({form.currency})
                  </FieldLabel>
                  <Input
                    id="trade-entry"
                    type="number"
                    required
                    min="0.000001"
                    step="any"
                    value={form.entry_price || ""}
                    onChange={(e) =>
                      change("entry_price", Number(e.target.value))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="trade-entry-date">Entry date</FieldLabel>
                  <Input
                    id="trade-entry-date"
                    type="date"
                    required
                    max={localJournalDate()}
                    value={form.entry_date}
                    onChange={(e) => change("entry_date", e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="trade-exit">
                    Exit price ({form.currency}, optional)
                  </FieldLabel>
                  <Input
                    id="trade-exit"
                    type="number"
                    min="0.000001"
                    step="any"
                    value={form.exit_price ?? ""}
                    onChange={(e) =>
                      change(
                        "exit_price",
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="trade-exit-date">Exit date</FieldLabel>
                  <Input
                    id="trade-exit-date"
                    type="date"
                    required={form.exit_price !== null}
                    min={form.entry_date}
                    max={localJournalDate()}
                    value={form.exit_date}
                    onChange={(e) => change("exit_date", e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="trade-entry-fee">
                    Entry fee ({form.currency})
                  </FieldLabel>
                  <Input
                    id="trade-entry-fee"
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={form.entry_fee}
                    onChange={(e) =>
                      change("entry_fee", Number(e.target.value))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="trade-exit-fee">
                    Exit fee ({form.currency})
                  </FieldLabel>
                  <Input
                    id="trade-exit-fee"
                    type="number"
                    min="0"
                    step="any"
                    required
                    value={form.exit_fee}
                    onChange={(e) => change("exit_fee", Number(e.target.value))}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="trade-book">Journal name</FieldLabel>
                  <Input
                    id="trade-book"
                    required
                    maxLength={80}
                    value={form.book}
                    onChange={(e) => change("book", e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="trade-note">Trade note</FieldLabel>
                  <Textarea
                    id="trade-note"
                    maxLength={2000}
                    value={form.note}
                    onChange={(e) => change("note", e.target.value)}
                  />
                </Field>
              </FieldGroup>
              <div className="journal-capture-actions">
                <Button type="submit" disabled={!userId || loading}>
                  <Save data-icon="inline-start" />
                  {busy ? "Saving…" : editing ? "Update trade" : "Save trade"}
                </Button>
                <Button type="button" variant="outline" onClick={reset}>
                  Close form
                </Button>
              </div>
            </fieldset>
          </form>
        </section>
      )}
      {loading ? (
        <Skeleton className="journal-loading" />
      ) : (
        !error && (
          <>
            <section
              className="journal-performance"
              aria-label="Trading performance"
            >
              <div className="journal-performance__summary">
                <div>
                  <span>Performance of displayed trades</span>
                  <strong
                    className={metrics.totalPnl >= 0 ? "positive" : "negative"}
                  >
                    {money(metrics.totalPnl)}
                  </strong>
                  <small>
                    {closed.length} closed trades · {currency} only · after
                    recorded fees
                  </small>
                </div>
                <dl>
                  <div>
                    <dt>Win rate</dt>
                    <dd>{closed.length ? `${metrics.winRate}%` : "—"}</dd>
                  </div>
                  <div>
                    <dt>Profit factor</dt>
                    <dd>
                      {metrics.profitFactor === null
                        ? "—"
                        : `${metrics.profitFactor.toFixed(2)}×`}
                    </dd>
                  </div>
                  <div>
                    <dt>Average win</dt>
                    <dd>{closed.length ? money(metrics.averageWin) : "—"}</dd>
                  </div>
                </dl>
              </div>
              <JournalPnlChart records={closed} currency={currency} />
            </section>
            <section
              className="journal-ledger"
              aria-label="Recorded trade history"
            >
              <header>
                <div>
                  <h3>Recorded trades</h3>
                  <p>
                    Open positions are excluded from realized P&amp;L. Up to
                    1,000 trades per account.
                  </p>
                </div>
                <Badge variant="outline">{visible.length} records</Badge>
              </header>
              <div
                className="journal-ledger__table"
                role="region"
                aria-label="Recorded trades table, scroll horizontally on smaller screens"
                tabIndex={0}
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      {[
                        "Instrument",
                        "Position",
                        "Entry / exit",
                        "Dates",
                        "Net P&L",
                        "Actions",
                      ].map((h) => (
                        <TableHead key={h}>{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <strong>{r.data.symbol}</strong>
                          <small>{r.data.book}</small>
                        </TableCell>
                        <TableCell>
                          {r.data.side === "BUY" ? "Long" : "Short"}
                          <small>
                            {r.data.quantity.toLocaleString()} shares
                          </small>
                        </TableCell>
                        <TableCell>
                          {money(r.data.entry_price)} /{" "}
                          {r.data.exit_price === null
                            ? "Open"
                            : money(r.data.exit_price)}
                        </TableCell>
                        <TableCell>
                          {r.data.entry_date}
                          <small>{r.data.exit_date || "Still open"}</small>
                        </TableCell>
                        <TableCell>
                          <strong
                            className={
                              (r.data.net_pl ?? 0) >= 0
                                ? "positive"
                                : "negative"
                            }
                          >
                            {r.data.net_pl === null
                              ? "—"
                              : money(r.data.net_pl)}
                          </strong>
                          <small>
                            {r.data.return_pct === null
                              ? "Unrealized not estimated"
                              : `${r.data.return_pct.toFixed(2)}%`}
                          </small>
                        </TableCell>
                        <TableCell>
                          <div className="backtest-actions">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              aria-label={`Edit trade ${r.data.symbol}`}
                              onClick={() => {
                                setEditing(r);
                                const {
                                  net_pl: _,
                                  return_pct: __,
                                  ...input
                                } = r.data;
                                setForm(input);
                                setCaptureOpen(true);
                              }}
                            >
                              <Pencil data-icon="inline-start" />
                              Edit
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={busy}
                              aria-label={`Delete trade ${r.data.symbol}`}
                              onClick={(e) => {
                                returnFocus.current = e.currentTarget;
                                setPendingDelete(r);
                              }}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!visible.length && (
                      <TableRow>
                        <TableCell colSpan={6}>
                          No recorded trades match these filters. Record your
                          first trade above.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </section>
          </>
        )
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete recorded trade?"
        description="This removes the trade from your account and recalculates performance. This cannot be undone."
        destructive
        confirmLabel="Delete trade"
        returnFocus={returnFocus}
        onCancel={() => {
          if (!busy) setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) void mutate(pendingDelete);
        }}
      />
    </div>
  );
}
