import { useEffect, useState } from "react";
import { api, session } from "@/api/client";
import { Button } from "@/components/ui/button";
import type { PortfolioSummary } from "@/lib/portfolio";

export function PortfolioOverview({ userId }: { userId: string }) {
  const [result, setResult] = useState<{
    owner: string;
    summary: PortfolioSummary;
  } | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController(),
      revision = session.getIdentityRevision();
    let active = true;
    setError(false);
    void api
      .portfolio(controller.signal)
      .then((summary) => {
        if (!Array.isArray(summary.totals))
          throw Error("Portfolio unavailable");
        if (active && session.getIdentityRevision() === revision)
          setResult({ owner: userId, summary });
      })
      .catch(() => {
        if (active && !controller.signal.aborted) setError(true);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [userId, reload]);
  const summary = result?.owner === userId ? result.summary : null;
  return (
    <section className="overview-portfolio" aria-label="Realized portfolio P&L">
      <header>
        <div>
          <h2>Realized P&amp;L</h2>
          <p>Recorded sales after fees · all portfolios</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setReload((v) => v + 1)}
        >
          Refresh P&amp;L
        </Button>
      </header>
      {error ? (
        <p role="status">
          Portfolio could not be loaded. Refresh to try again.
        </p>
      ) : !summary ? (
        <p role="status">Loading portfolio…</p>
      ) : (
        <div className="overview-portfolio__totals">
          {(["IDR", "USD"] as const).map((currency) => {
            const value = summary.totals
              .filter((t) => t.currency === currency)
              .reduce((sum, t) => sum + Number(t.realized_pnl), 0);
            return (
              <div key={currency}>
                <span>{currency}</span>
                <strong data-negative={value < 0 || undefined}>
                  {new Intl.NumberFormat("en-GB", {
                    style: "currency",
                    currency,
                    maximumFractionDigits: 2,
                  }).format(value)}
                </strong>
              </div>
            );
          })}
        </div>
      )}
      <a href="#app/journal">Open portfolio in journal</a>
    </section>
  );
}
