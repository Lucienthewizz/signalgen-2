import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { BacktestMode } from "@/lib/backtest-route";
import "@/styles/backtest-result-page.css";

export function BacktestResultPage({
  mode,
  children,
}: {
  mode: BacktestMode;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);
  return (
    <div className="backtest-results-page">
      <header className="backtest-results-page__heading">
        <div>
          <h2 ref={heading} tabIndex={-1}>
            {mode === "study"
              ? "Historical study results"
              : "Portfolio simulation results"}
          </h2>
          <p>
            {mode === "study"
              ? "Independent signal study"
              : "Portfolio simulation"}
          </p>
        </div>
        <a
          href="#app/backtest"
          data-slot="button"
          className={buttonVariants({ variant: "outline" })}
        >
          <ArrowLeft data-icon="inline-start" /> Back to setup
        </a>
      </header>
      {children}
    </div>
  );
}

export function BacktestResultUnavailable({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <section className="backtest-panel" role="status">
      <h3>Result unavailable</h3>
      <p>{children}</p>
      <a href="#app/backtest" data-slot="button" className={buttonVariants()}>
        Return to Backtesting
      </a>
    </section>
  );
}
