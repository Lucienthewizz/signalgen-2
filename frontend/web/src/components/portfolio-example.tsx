import { JournalPnlChart } from "@/components/journal-pnl-chart";
import {
  portfolioClosedTrades,
  type PortfolioTransaction,
} from "@/lib/portfolio";

// Local, read-only examples. These records never enter the API or account ledger.
const transactions: PortfolioTransaction[] = [
  ["BBRI.JK", "BUY", "4000", "2026-11-02"],
  ["BBRI.JK", "SELL", "4400", "2026-11-03"],
  ["BBCA.JK", "BUY", "9000", "2026-11-04"],
  ["BBCA.JK", "SELL", "9300", "2026-11-05"],
  ["TLKM.JK", "BUY", "3000", "2026-11-06"],
  ["TLKM.JK", "SELL", "2900", "2026-11-09"],
].map(([symbol, side, price, date], index) => ({
  id: `chart-example-${index}`,
  version: 1,
  data: {
    symbol,
    side: side as "BUY" | "SELL",
    price,
    market: "IDX",
    currency: "IDR",
    quantity: "100",
    fee: "0",
    executed_at: `${date}T02:00:00Z`,
    book: "Chart example",
    note: "Example only; not an executed trade.",
  },
}));
const trades = portfolioClosedTrades(transactions);
const money = (value: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
export function PortfolioExample() {
  return (
    <div className="portfolio-example" aria-label="Portfolio chart example">
      <p className="portfolio-example__notice">
        <strong>Test data · not saved to your account</strong>
        <br />
        Three completed trades show two gains and one loss. Prices and dates are
        illustrative; fees are zero.
      </p>
      <strong className="journal-portfolio__value">
        {money(trades.reduce((sum, trade) => sum + trade.pnl, 0))}
      </strong>
      <JournalPnlChart records={trades} currency="IDR" />
      <dl className="portfolio-example__outcomes">
        {trades.map((trade) => (
          <div key={trade.id}>
            <dt>{trade.symbol.replace(".JK", "")} · 1 lot</dt>
            <dd data-negative={trade.pnl < 0 || undefined}>
              {money(trade.pnl)}
            </dd>
          </div>
        ))}
      </dl>
      <p>
        Select a chart point to inspect that trade. Choose “Show my portfolio”
        to return to your records.
      </p>
    </div>
  );
}
