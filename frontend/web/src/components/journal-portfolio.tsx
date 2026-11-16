import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { api, ApiError, session } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { DateInput } from "@/components/date-input";
import { JournalPnlChart } from "@/components/journal-pnl-chart";
import {
  portfolioClosedTrades,
  confirmsPortfolioWrite,
  type PortfolioData,
  type PortfolioSummary,
  type PortfolioTransaction,
} from "@/lib/portfolio";
import type { ScreeningJournalEntry } from "@/lib/screening-journal";
import "@/styles/journal-portfolio.css";

type Form = PortfolioData;
const nowSGT = () =>
  new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 19);
const blank = (): Form => ({
  symbol: "",
  market: "IDX",
  currency: "IDR",
  side: "BUY",
  quantity: "100",
  price: "",
  fee: "0",
  executed_at: nowSGT(),
  book: "Screening journal",
  note: "",
});
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Portfolio unavailable. Try again.";
const money = (value: number, currency: string) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
export function JournalPortfolio({
  userId,
  draft,
  onClearDraft,
}: {
  userId: string;
  draft: ScreeningJournalEntry | null;
  onClearDraft: () => void;
}) {
  const [archive, setArchive] = useState<{
    owner: string;
    items: PortfolioTransaction[];
    summary: PortfolioSummary;
  } | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [market, setMarket] = useState<"IDX" | "US">("IDX");
  const [book, setBook] = useState("");
  const [form, setForm] = useState<Form>(blank);
  const [edit, setEdit] = useState<PortfolioTransaction | null>(null);
  const [open, setOpen] = useState(false);
  const [ledger, setLedger] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [uncertain, setUncertain] = useState<PortfolioTransaction | null>(null);
  const [retrySame, setRetrySame] = useState(false);
  const [savedConflict, setSavedConflict] =
    useState<PortfolioTransaction | null>(null);
  const [notice, setNotice] = useState("");
  const saveErrorRef = useRef<HTMLParagraphElement>(null);
  const formLocked = busy || Boolean(uncertain);
  const operation = useRef<AbortController | null>(null);
  const identity = useRef(userId);
  identity.current = userId;
  const saveId = useRef("");
  const trigger = useRef<HTMLButtonElement>(null);
  const items = archive?.owner === userId ? archive.items : [];
  const summary = archive?.owner === userId ? archive.summary : null;
  const currency = market === "IDX" ? "IDR" : "USD";
  const filtered = useMemo(
    () =>
      items.filter(
        (tx) => tx.data.market === market && (!book || tx.data.book === book),
      ),
    [items, market, book],
  );
  const trades = useMemo(() => {
    try {
      return portfolioClosedTrades(filtered);
    } catch {
      return null;
    }
  }, [filtered]);
  const totals = summary?.totals.filter(
    (t) => t.market === market && (!book || t.book === book),
  );
  const realized = totals?.reduce((s, t) => s + Number(t.realized_pnl), 0) ?? 0;
  useEffect(() => {
    const controller = new AbortController(),
      revision = session.getIdentityRevision();
    let active = true;
    setLoading(true);
    setError("");
    void Promise.all([
      api.portfolioTransactions(controller.signal),
      api.portfolio(controller.signal),
    ])
      .then(([list, summary]) => {
        if (
          !Array.isArray(list.items) ||
          !Array.isArray(summary.totals) ||
          !Array.isArray(summary.positions)
        )
          throw Error("Portfolio data is unavailable. Reload to try again.");
        if (
          active &&
          identity.current === userId &&
          session.getIdentityRevision() === revision
        )
          setArchive({ owner: userId, items: list.items, summary });
      })
      .catch((e) => {
        if (active && !controller.signal.aborted) setError(errorText(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [userId, reload]);
  useEffect(() => {
    operation.current?.abort();
    setOpen(false);
    setLedger(false);
    setEdit(null);
    setNotice("");
    setBusy(false);
    setUncertain(null);
    setRetrySame(false);
    setSavedConflict(null);
    setSaveError("");
    setBook("");
    return () => operation.current?.abort();
  }, [userId]);
  useEffect(() => {
    if (draft) {
      if (operation.current || uncertain) {
        setOpen(true);
        return;
      }
      setForm({
        ...blank(),
        symbol: draft.symbol,
        market: draft.market as "IDX" | "US",
        currency: draft.currency as "IDR" | "USD",
        price: String(draft.price),
        quantity: draft.market === "IDX" ? "100" : "1",
        side: draft.signal_type === "SELL" ? "SELL" : "BUY",
        note: `From screening: ${draft.rule_name}; ${draft.screened_at}. Execution entered manually.`,
      });
      setEdit(null);
      saveId.current = crypto.randomUUID();
      setSaveError("");
      setOpen(true);
    }
  }, [draft]);
  useEffect(() => {
    if (saveError && !busy) saveErrorRef.current?.focus();
  }, [saveError, busy]);
  function create() {
    if (operation.current) return;
    if (uncertain) {
      setOpen(true);
      return;
    }
    setForm(blank());
    setEdit(null);
    saveId.current = crypto.randomUUID();
    setSaveError("");
    setOpen(true);
  }
  function close() {
    if (busy) return;
    setOpen(false);
    if (!uncertain) onClearDraft();
  }
  function confirmSaved() {
    setUncertain(null);
    setRetrySame(false);
    setSavedConflict(null);
    setSaveError("");
    setOpen(false);
    onClearDraft();
    setNotice("Transaction saved.");
    setReload((v) => v + 1);
  }
  async function writeTransaction(tx: PortfolioTransaction) {
    if (operation.current) return;
    const controller = new AbortController(),
      owner = userId,
      revision = session.getIdentityRevision();
    operation.current = controller;
    setBusy(true);
    setSaveError("");
    const active = () =>
      identity.current === owner &&
      session.getIdentityRevision() === revision &&
      !controller.signal.aborted;
    try {
      const saved = await api.savePortfolioTransaction(
        tx.id,
        tx.version,
        tx.data,
        controller.signal,
      );
      if (!active()) return;
      if (!confirmsPortfolioWrite(tx, saved))
        throw Error("The response did not confirm the submitted transaction.");
      confirmSaved();
    } catch (e) {
      if (!active()) return;
      if (
        uncertain ||
        !(e instanceof ApiError) ||
        e.status === 0 ||
        e.status >= 500 ||
        e.status === 408 ||
        e.code === "VERSION_CONFLICT"
      ) {
        setUncertain(tx);
        setRetrySame(false);
        setSaveError(
          "Confirmation was not received. This transaction may already be saved. Check transactions before trying again.",
        );
      } else setSaveError(errorText(e));
    } finally {
      if (active()) setBusy(false);
      if (operation.current === controller) operation.current = null;
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (operation.current || uncertain) return;
    try {
      const symbol = form.symbol.trim().toUpperCase();
      await writeTransaction({
        id: saveId.current,
        version: edit?.version ?? 0,
        data: {
          ...form,
          book: form.book.trim(),
          symbol:
            form.market === "IDX" && !symbol.endsWith(".JK")
              ? symbol + ".JK"
              : symbol,
          executed_at: new Date(form.executed_at + "+08:00").toISOString(),
        },
      });
    } catch (e) {
      setSaveError(errorText(e));
    }
  }
  async function checkSaved() {
    if (!uncertain || operation.current) return;
    const tx = uncertain,
      controller = new AbortController(),
      owner = userId,
      revision = session.getIdentityRevision();
    operation.current = controller;
    setBusy(true);
    setRetrySame(false);
    setSavedConflict(null);
    setSaveError("");
    const active = () =>
      identity.current === owner &&
      session.getIdentityRevision() === revision &&
      !controller.signal.aborted;
    try {
      const saved = await api.portfolioTransaction(tx.id, controller.signal);
      if (!active()) return;
      if (
        !saved?.data ||
        saved.id !== tx.id ||
        !Number.isInteger(saved.version) ||
        saved.version < 1 ||
        Object.keys(tx.data).some(
          (key) => typeof saved.data[key as keyof Form] !== "string",
        )
      )
        throw Error("The saved record could not be verified.");
      if (confirmsPortfolioWrite(tx, saved)) confirmSaved();
      else if (saved.version === tx.version && tx.version > 0) {
        setRetrySame(true);
        setSaveError(
          "The record still has its earlier version. You can retry the same submitted change without creating another record.",
        );
      } else {
        setSavedConflict(saved);
        setSaveError(
          "A different saved version exists. Your draft is preserved. Use the saved version to review it before editing again.",
        );
      }
    } catch (e) {
      if (!active()) return;
      if (e instanceof ApiError && e.status === 404) {
        if (tx.version === 0) {
          setRetrySame(true);
          setSaveError(
            "No matching record was found yet. Retry keeps the same transaction ID and submitted details; it does not create a second draft.",
          );
        } else {
          setUncertain(null);
          setSaveError(
            "The original record is no longer available. Close this form and review Transactions before creating a new record.",
          );
        }
      } else
        setSaveError(
          "The save could not be verified. Your draft is preserved. Check transactions again when the service is available.",
        );
    } finally {
      if (active()) setBusy(false);
      if (operation.current === controller) operation.current = null;
    }
  }
  function startEdit(tx: PortfolioTransaction, useSavedVersion = false) {
    if (operation.current) return;
    if (uncertain && !useSavedVersion) {
      setLedger(false);
      setOpen(true);
      return;
    }
    setUncertain(null);
    setRetrySame(false);
    setSavedConflict(null);
    setForm({
      ...tx.data,
      executed_at: new Date(Date.parse(tx.data.executed_at) + 8 * 3600000)
        .toISOString()
        .slice(0, 19),
    });
    setEdit(tx);
    saveId.current = tx.id;
    setSaveError("");
    setLedger(false);
    setOpen(true);
  }
  const field = (key: keyof Form, label: string, type = "text", extra = {}) => (
    <Field key={key}>
      <FieldLabel htmlFor={`portfolio-${key}`}>{label}</FieldLabel>
      <Input
        id={`portfolio-${key}`}
        type={type}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        required
        {...extra}
      />
    </Field>
  );
  const choose = (
    label: string,
    value: string,
    options: [string, string][],
    change: (v: string) => void,
    disabled = false,
  ) => (
    <Select
      items={options.map(([value, label]) => ({ value, label }))}
      value={value}
      disabled={disabled}
      onValueChange={(v) => change(v ?? "")}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
  return (
    <section
      className="journal-portfolio"
      aria-label="Portfolio performance"
      aria-busy={loading}
    >
      <header>
        <div>
          <h2>Portfolio</h2>
          <p>Recorded transactions · realized P&amp;L after fees</p>
        </div>
        <Button ref={trigger} size="sm" variant="outline" onClick={create}>
          {uncertain ? "Review pending transaction" : "Record transaction"}
        </Button>
      </header>
      <div className="journal-portfolio__filters">
        {choose(
          "Portfolio market",
          market,
          [
            ["IDX", "IDX · IDR"],
            ["US", "US · USD"],
          ],
          (v) => setMarket(v as "IDX" | "US"),
        )}
        {choose(
          "Portfolio book",
          book,
          [
            ["", "All portfolios"],
            ...[...new Set(items.map((t) => t.data.book))]
              .sort()
              .map((b) => [b, b] as [string, string]),
          ],
          setBook,
        )}
      </div>
      {loading && !summary ? (
        <p role="status">Loading portfolio…</p>
      ) : error ? (
        <Alert variant="destructive">
          <AlertTitle>Portfolio unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setReload((v) => v + 1)}
          >
            Retry portfolio
          </Button>
        </Alert>
      ) : (
        <>
          <strong
            className="journal-portfolio__value"
            data-negative={realized < 0 || undefined}
          >
            {money(realized, currency)}
          </strong>
          {trades ? (
            <JournalPnlChart records={trades} currency={currency} />
          ) : (
            <p role="alert">
              Transaction history could not be reconciled. Reload the portfolio
              before recording more transactions.
            </p>
          )}
          <p>
            Record a BUY to open a position and a SELL to realize P&amp;L. Open
            positions are excluded from this chart.
          </p>
        </>
      )}
      <footer>
        <Button size="sm" variant="ghost" onClick={() => setLedger(true)}>
          Transactions ({filtered.length})
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={() => setReload((v) => v + 1)}
        >
          Refresh portfolio
        </Button>
      </footer>
      <p role="status" aria-atomic="true">
        {notice}
      </p>
      {uncertain && !open && (
        <p role="status">
          An unconfirmed transaction draft is preserved. Review it before
          recording another trade.
        </p>
      )}
      <Dialog.Root
        open={open}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="signalgen-confirm__backdrop" />
          <Dialog.Viewport className="signalgen-confirm__viewport">
            <Dialog.Popup
              className="signalgen-confirm portfolio-dialog"
              finalFocus={trigger}
            >
              <Dialog.Title className="signalgen-confirm__title">
                {edit ? "Edit transaction" : "Record transaction"}
              </Dialog.Title>
              <Dialog.Description className="signalgen-confirm__description">
                Enter the trade you executed. Screening prices are a starting
                point. SELL requires recorded holdings in the same portfolio.
              </Dialog.Description>
              <form onSubmit={save}>
                <p
                  role="status"
                  aria-atomic="true"
                  className="portfolio-save-status"
                >
                  {busy
                    ? uncertain
                      ? "Checking transaction status…"
                      : "Saving transaction. Submitted details are locked."
                    : uncertain
                      ? "Submitted details are locked until the save is checked."
                      : ""}
                </p>
                <fieldset
                  disabled={formLocked}
                  className="min-w-0 border-0 p-0"
                >
                  <FieldGroup className="portfolio-form">
                    <Field>
                      <FieldLabel>Market</FieldLabel>
                      {choose(
                        "Transaction market",
                        form.market,
                        [
                          ["IDX", "IDX · IDR"],
                          ["US", "US · USD"],
                        ],
                        (v) =>
                          setForm((f) => ({
                            ...f,
                            market: v as "IDX" | "US",
                            currency: v === "IDX" ? "IDR" : "USD",
                            quantity: v === "IDX" ? "100" : "1",
                          })),
                      )}
                    </Field>
                    {field("symbol", "Stock symbol", "text", { maxLength: 20 })}
                    <Field>
                      <FieldLabel>Transaction side</FieldLabel>
                      {choose(
                        "Transaction side",
                        form.side,
                        [
                          ["BUY", "BUY · add shares"],
                          ["SELL", "SELL · close shares"],
                        ],
                        (v) =>
                          setForm((f) => ({ ...f, side: v as "BUY" | "SELL" })),
                      )}
                    </Field>
                    {field(
                      "quantity",
                      form.market === "IDX" ? "Shares (100 per lot)" : "Shares",
                      "number",
                      {
                        min: form.market === "IDX" ? 100 : 0.000001,
                        step: form.market === "IDX" ? 100 : 0.000001,
                        max: 100000000,
                      },
                    )}
                    {field(
                      "price",
                      `Executed price (${form.currency})`,
                      "number",
                      { min: 0.000001, step: 0.000001, max: 1000000000 },
                    )}
                    {field("fee", `Fee (${form.currency})`, "number", {
                      min: 0,
                      step: 0.000001,
                    })}
                    <Field>
                      <FieldLabel htmlFor="portfolio-date">
                        Execution date (SGT)
                      </FieldLabel>
                      <DateInput
                        id="portfolio-date"
                        value={form.executed_at.slice(0, 10)}
                        onValueChange={(value) =>
                          setForm((f) => ({
                            ...f,
                            executed_at: value + f.executed_at.slice(10),
                          }))
                        }
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="portfolio-time">
                        Execution time (SGT)
                      </FieldLabel>
                      <Input
                        id="portfolio-time"
                        type="time"
                        step="1"
                        required
                        value={form.executed_at.slice(11, 19)}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            executed_at:
                              f.executed_at.slice(0, 11) + e.target.value,
                          }))
                        }
                      />
                    </Field>
                    {field("book", "Portfolio name", "text", { maxLength: 80 })}
                    <Field>
                      <FieldLabel htmlFor="portfolio-note">
                        Trade note
                      </FieldLabel>
                      <Input
                        id="portfolio-note"
                        value={form.note}
                        maxLength={2000}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, note: e.target.value }))
                        }
                      />
                    </Field>
                  </FieldGroup>
                </fieldset>
                {saveError && (
                  <p role="alert" ref={saveErrorRef} tabIndex={-1}>
                    {saveError}
                  </p>
                )}
                <div className="portfolio-dialog__actions">
                  {uncertain ? (
                    <>
                      <Button
                        type="button"
                        disabled={busy}
                        onClick={() => void checkSaved()}
                      >
                        {busy ? "Checking…" : "Check transactions"}
                      </Button>
                      {retrySame && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void writeTransaction(uncertain)}
                        >
                          Retry same transaction
                        </Button>
                      )}
                      {savedConflict && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy}
                          onClick={() => startEdit(savedConflict, true)}
                        >
                          Use saved version
                        </Button>
                      )}
                    </>
                  ) : (
                    <Button type="submit" disabled={busy}>
                      {busy ? "Saving…" : "Save transaction"}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={close}
                  >
                    {uncertain ? "Keep draft" : "Cancel"}
                  </Button>
                </div>
              </form>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={ledger} onOpenChange={setLedger}>
        <Dialog.Portal>
          <Dialog.Backdrop className="signalgen-confirm__backdrop" />
          <Dialog.Viewport className="signalgen-confirm__viewport">
            <Dialog.Popup
              className="signalgen-confirm portfolio-dialog"
              finalFocus={trigger}
            >
              <Dialog.Title className="signalgen-confirm__title">
                Recorded transactions
              </Dialog.Title>
              <Dialog.Description className="signalgen-confirm__description">
                {currency} · current portfolio filters. Edit a transaction to
                correct its execution details.
              </Dialog.Description>
              <div className="portfolio-transactions">
                {filtered.length ? (
                  [...filtered]
                    .sort(
                      (a, b) =>
                        Date.parse(b.data.executed_at) -
                        Date.parse(a.data.executed_at),
                    )
                    .map((tx) => (
                      <article key={tx.id}>
                        <div>
                          <strong>
                            {tx.data.symbol.replace(/\.JK$/, "")} ·{" "}
                            {tx.data.side}
                          </strong>
                          <p>
                            {tx.data.quantity} shares ·{" "}
                            {money(Number(tx.data.price), tx.data.currency)}
                          </p>
                          <p>
                            {new Date(tx.data.executed_at).toLocaleString(
                              "en-GB",
                              { timeZone: "Asia/Singapore" },
                            )}{" "}
                            SGT · {tx.data.book}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => startEdit(tx)}
                        >
                          Edit {tx.data.symbol.replace(/\.JK$/, "")}{" "}
                          {tx.data.side}
                        </Button>
                      </article>
                    ))
                ) : (
                  <p>No recorded transactions in these filters.</p>
                )}
              </div>
              <Button variant="outline" onClick={() => setLedger(false)}>
                Close transactions
              </Button>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
