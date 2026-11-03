import type { TradeInput } from "./server-records";
export type JournalBatchRow = {
  id: string;
  input: TradeInput;
  status: "draft" | "saved" | "failed";
  error?: string;
};

export function validateJournalDraft(input: TradeInput): string | null {
  if (
    !input.symbol ||
    !["BUY", "SELL"].includes(input.side) ||
    !input.book.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.entry_date)
  )
    return "Confirm symbol, direction, trade date and journal name.";
  if (
    ![input.quantity, input.entry_price, input.entry_fee].every(
      Number.isFinite,
    ) ||
    input.quantity <= 0 ||
    input.entry_price <= 0 ||
    input.entry_fee < 0
  )
    return "Enter a positive quantity/price and a non-negative fee.";
  if (
    input.market === "IDX" &&
    (input.currency !== "IDR" ||
      !Number.isInteger(input.quantity) ||
      input.quantity % 100 !== 0)
  )
    return "IDX quantity must be whole lots of 100 shares.";
  if (input.market === "US" && input.currency !== "USD")
    return "US trades must use USD.";
  return null;
}

// Reuse the same UUID and payload after an uncertain response; the API's create
// operation is idempotent for identical data. Never retry rows already saved.
export async function saveJournalBatch(
  rows: JournalBatchRow[],
  save: (row: JournalBatchRow) => Promise<unknown>,
  signal: AbortSignal,
  update: (row: JournalBatchRow) => void,
) {
  const pending = rows.filter((r) => r.status !== "saved");
  for (const row of pending) {
    const error = validateJournalDraft(row.input);
    if (error) throw Error(`${row.input.symbol}: ${error}`);
  }
  for (const row of pending) {
    signal.throwIfAborted();
    try {
      await save(row);
      signal.throwIfAborted();
      update({ ...row, status: "saved", error: undefined });
    } catch (e) {
      if (signal.aborted) throw e;
      update({
        ...row,
        status: "failed",
        error: e instanceof Error ? e.message : "Save failed. Retry this row.",
      });
      if (
        e &&
        typeof e === "object" &&
        "status" in e &&
        [401, 403].includes(Number(e.status))
      )
        throw e;
    }
  }
}
