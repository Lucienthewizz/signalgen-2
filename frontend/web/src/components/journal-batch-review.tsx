import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, session } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/date-input";
import {
  checkJournalScreening,
  type JournalScreeningDraft,
} from "@/lib/journal-screening";
import { localJournalDate } from "@/lib/journal";
import { saveJournalBatch, type JournalBatchRow } from "@/lib/journal-batch";

export function JournalBatchReview({
  drafts,
  userId,
  onClose,
  onSaved,
}: {
  drafts: JournalScreeningDraft[];
  userId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<JournalBatchRow[]>(() =>
    drafts
      .map((d): JournalBatchRow | null => {
        const check = checkJournalScreening(d, userId);
        if (!check.ok) return null;
        const currency = d.run.manifest.currency,
          market = d.run.manifest.market;
        if (
          (currency !== "IDR" && currency !== "USD") ||
          (market !== "IDX" && market !== "US") ||
          (check.row.decision.signal_type !== "BUY" &&
            check.row.decision.signal_type !== "SELL")
        )
          return null;
        return {
          id: crypto.randomUUID(),
          status: "draft" as const,
          input: {
            symbol: d.symbol,
            market,
            currency,
            side:
              check.row.decision.signal_type === "SELL"
                ? ("SELL" as const)
                : ("BUY" as const),
            quantity: 0,
            entry_price: check.row.latestClose,
            exit_price: null,
            entry_fee: 0,
            exit_fee: 0,
            entry_date: localJournalDate(),
            exit_date: "",
            book: "Trading journal",
            note: `User-confirmed draft from screening ${d.ruleName}; candle ${check.row.decision.timestamp}. Snapshot is not an executed trade.`,
          },
        };
      })
      .filter((r): r is JournalBatchRow => r !== null),
  );
  const [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState("");
  const operation = useRef<AbortController | null>(null),
    owner = useRef(userId);
  owner.current = userId;
  useEffect(() => {
    const stop = () => operation.current?.abort();
    const unsub = session.onIdentityChange(stop);
    return () => {
      stop();
      unsub();
    };
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (operation.current || !userId || !confirmed) return;
    if (drafts.some((d) => !checkJournalScreening(d, userId).ok)) {
      setError(
        "A screening snapshot no longer belongs to this account. Run screening again.",
      );
      return;
    }
    const controller = new AbortController();
    operation.current = controller;
    const id = userId,
      revision = session.getIdentityRevision();
    setBusy(true);
    setError("");
    const active = () =>
      !controller.signal.aborted &&
      owner.current === id &&
      session.getIdentityRevision() === revision;
    try {
      await api.ensureAppSession();
      if (!active()) return;
      await saveJournalBatch(
        rows,
        (r) => api.saveRecord("journal", r.id, 0, r.input, controller.signal),
        controller.signal,
        (row) => {
          if (active()) {
            setRows((old) => old.map((r) => (r.id === row.id ? row : r)));
            if (row.status === "saved") onSaved();
          }
        },
      );
    } catch (e) {
      if (active())
        setError(e instanceof Error ? e.message : "Batch save failed.");
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  if (!userId || drafts.some((d) => d.ownerId !== userId))
    return <p role="alert">Journal review unavailable for this account.</p>;
  const edit = (
    id: string,
    key: keyof JournalBatchRow["input"],
    value: string | number,
  ) => {
    setConfirmed(false);
    setRows((old) =>
      old.map((r) =>
        r.id === id
          ? {
              ...r,
              input: { ...r.input, [key]: value },
              status: "draft",
              error: undefined,
            }
          : r,
      ),
    );
  };
  return (
    <section
      className="journal-batch-review"
      aria-labelledby="batch-journal-heading"
    >
      <h3 id="batch-journal-heading">Review selected screening drafts</h3>
      <p>
        A match is not a transaction. Confirm your actual price, date, quantity,
        fee and journal before saving. Each row is saved separately; successful
        rows will not be retried.
      </p>
      {rows.length !== drafts.length && (
        <p role="alert">
          Some snapshots were invalid and were not added. Return to screening to
          review them.
        </p>
      )}
      <form onSubmit={save}>
        <div className="study-table-scroll">
          <table>
            <caption>
              {rows.filter((r) => r.status === "saved").length}/{rows.length}{" "}
              saved to this account
            </caption>
            <thead>
              <tr>
                <th>Stock</th>
                <th>Direction</th>
                <th>Quantity (shares)</th>
                <th>Actual entry price</th>
                <th>Trade date</th>
                <th>Entry fee</th>
                <th>Journal name</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.input.symbol}
                    <small>{r.input.currency}</small>
                  </td>
                  <td>{r.input.side}</td>
                  <td>
                    <Input
                      aria-label={`Quantity ${r.input.symbol}`}
                      type="number"
                      required
                      min={r.input.market === "IDX" ? 100 : 0.000001}
                      step={r.input.market === "IDX" ? 100 : "any"}
                      disabled={busy || r.status === "saved"}
                      value={r.input.quantity || ""}
                      onChange={(e) =>
                        edit(r.id, "quantity", Number(e.target.value))
                      }
                    />
                  </td>
                  <td>
                    <Input
                      aria-label={`Entry price ${r.input.symbol}`}
                      type="number"
                      required
                      min="0.000001"
                      step="any"
                      disabled={busy || r.status === "saved"}
                      value={r.input.entry_price}
                      onChange={(e) =>
                        edit(r.id, "entry_price", Number(e.target.value))
                      }
                    />
                  </td>
                  <td>
                    <DateInput
                      aria-label={`Trade date ${r.input.symbol}`}
                      required
                      type="date"
                      disabled={busy || r.status === "saved"}
                      value={r.input.entry_date}
                      onValueChange={(value) => edit(r.id, "entry_date", value)}
                    />
                  </td>
                  <td>
                    <Input
                      aria-label={`Entry fee ${r.input.symbol}`}
                      type="number"
                      min="0"
                      step="any"
                      required
                      disabled={busy || r.status === "saved"}
                      value={r.input.entry_fee}
                      onChange={(e) =>
                        edit(r.id, "entry_fee", Number(e.target.value))
                      }
                    />
                  </td>
                  <td>
                    <Input
                      aria-label={`Journal name ${r.input.symbol}`}
                      required
                      maxLength={80}
                      disabled={busy || r.status === "saved"}
                      value={r.input.book}
                      onChange={(e) => edit(r.id, "book", e.target.value)}
                    />
                  </td>
                  <td role="status">
                    {r.status}
                    {r.error && <p>{r.error}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label className="study-confirm">
          <input
            type="checkbox"
            required
            disabled={busy}
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I confirm these are user-recorded trades, not orders executed by
          SignalGen.
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="study-actions">
          <Button
            type="submit"
            disabled={
              busy || !confirmed || rows.every((r) => r.status === "saved")
            }
          >
            {busy
              ? "Saving reviewed trades…"
              : "Save unsaved / retry failed trades"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            Close review
          </Button>
        </div>
      </form>
    </section>
  );
}
