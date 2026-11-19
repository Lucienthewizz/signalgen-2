export type BacktestMode = "study" | "portfolio";
export type BacktestRoute =
  { page: "setup" } | { page: "results"; mode: BacktestMode; run: string };

export function readBacktestRoute(hash: string): BacktestRoute {
  const [path, ...query] = hash.replace(/^#/, "").split("&");
  if (path !== "app/backtest/results") return { page: "setup" };
  const params = new URLSearchParams(query.join("&"));
  const run = params.get("run") ?? "";
  return {
    page: "results",
    mode: params.get("mode") === "portfolio" ? "portfolio" : "study",
    run: /^[a-zA-Z0-9_-]{1,128}$/.test(run) ? run : "",
  };
}

export function backtestResultHash(mode: BacktestMode, run: string) {
  return `#app/backtest/results&mode=${mode}&run=${encodeURIComponent(run)}`;
}
