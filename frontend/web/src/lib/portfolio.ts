export type PortfolioData = {
  symbol: string;
  market: "IDX" | "US";
  currency: "IDR" | "USD";
  side: "BUY" | "SELL";
  quantity: string;
  price: string;
  fee: string;
  executed_at: string;
  book: string;
  note: string;
};
export type PortfolioTransaction = {
  id: string;
  version: number;
  data: PortfolioData;
};
export type PortfolioSummary = {
  transaction_count: number;
  totals: {
    book: string;
    market: string;
    currency: string;
    cost_basis: string;
    realized_pnl: string;
    fees: string;
  }[];
  positions: {
    book: string;
    symbol: string;
    market: string;
    currency: string;
    quantity: string;
    average_cost: string | null;
    cost_basis: string;
    realized_pnl: string;
  }[];
};
type Fraction = { n: bigint; d: bigint };
const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
};
const fraction = (n: bigint, d = 1n): Fraction => {
  if (d === 0n) throw Error("Invalid portfolio quantity");
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
};
const add = (a: Fraction, b: Fraction) =>
  fraction(a.n * b.d + b.n * a.d, a.d * b.d);
const negate = (a: Fraction) => ({ n: -a.n, d: a.d });
const multiply = (a: Fraction, b: Fraction) => fraction(a.n * b.n, a.d * b.d);
const divide = (a: Fraction, b: Fraction) => fraction(a.n * b.d, a.d * b.n);
const decimal = (s: string) => {
  if (!/^\d{1,16}(\.\d{1,6})?$/.test(s))
    throw Error("Invalid portfolio decimal");
  const [whole, part = ""] = s.split(".");
  return fraction(BigInt(whole + part), 10n ** BigInt(part.length));
};
const number = (a: Fraction) => {
  const scaled = a.n * 1000000n;
  return (
    Number((scaled + (scaled < 0n ? -a.d / 2n : a.d / 2n)) / a.d) / 1000000
  );
};

// Mirror the server's long-only weighted-average cost policy for chart points.
// Fractions keep entry fees and partial sales exact until display conversion.
export function portfolioClosedTrades(items: PortfolioTransaction[]) {
  const holdings = new Map<
    string,
    { quantity: Fraction; cost: Fraction; opened: string }
  >();
  const micros = (value: string) =>
    BigInt(Date.parse(value)) * 1000n +
    BigInt((value.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(3, 6));
  const ordered = [...items].sort((a, b) => {
    const delta = micros(a.data.executed_at) - micros(b.data.executed_at);
    return delta < 0n ? -1 : delta > 0n ? 1 : a.id.localeCompare(b.id);
  });
  const result = [];
  for (const tx of ordered) {
    const d = tx.data,
      key = JSON.stringify([d.book, d.market, d.symbol]);
    const h = holdings.get(key) ?? {
      quantity: fraction(0n),
      cost: fraction(0n),
      opened: d.executed_at,
    };
    const q = decimal(d.quantity),
      p = decimal(d.price),
      fee = decimal(d.fee);
    if (d.side === "BUY") {
      if (h.quantity.n === 0n) h.opened = d.executed_at;
      h.quantity = add(h.quantity, q);
      h.cost = add(h.cost, add(multiply(q, p), fee));
    } else {
      if (h.quantity.n === 0n || q.n * h.quantity.d > h.quantity.n * q.d)
        throw Error("Recorded sale exceeds holdings");
      const average = divide(h.cost, h.quantity),
        basis = multiply(average, q);
      const pnl = add(add(multiply(q, p), negate(fee)), negate(basis));
      result.push({
        id: tx.id,
        sequence: result.length,
        closedAt: d.executed_at,
        pnl: number(pnl),
        symbol: d.symbol,
        exit: number(p),
        openedAt: h.opened,
        entry: number(average),
        side: "BUY" as const,
        quantity: number(q),
        book: d.book,
        note: d.note,
      });
      h.quantity = add(h.quantity, negate(q));
      h.cost = add(h.cost, negate(basis));
    }
    holdings.set(key, h);
  }
  return result;
}
