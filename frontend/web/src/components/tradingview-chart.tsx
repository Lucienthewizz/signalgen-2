import { useEffect, useRef, useState } from "react";
import { CircleAlert, ExternalLink } from "lucide-react";

type WidgetState = "loading" | "ready" | "error";
type Theme = "dark" | "light";

export function TradingViewChart({
  symbol,
  label,
  initialRange,
  deferUntilVisible = false,
}: {
  symbol: string;
  label: string;
  initialRange?: "12M";
  deferUntilVisible?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [activated, setActivated] = useState(!deferUntilVisible);
  const containerRef = useRef<HTMLDivElement>(null);
  const [widgetState, setWidgetState] = useState<WidgetState>("loading");
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  const tradingViewUrl = `https://www.tradingview.com/symbols/${symbol.replace(":", "-")}/`;

  useEffect(() => {
    const updateTheme = (event: Event) => {
      const nextTheme = (event as CustomEvent<{ theme: Theme }>).detail?.theme;
      if (nextTheme) setTheme(nextTheme);
    };
    window.addEventListener("signalgen:themechange", updateTheme);
    return () =>
      window.removeEventListener("signalgen:themechange", updateTheme);
  }, []);

  useEffect(() => {
    if (activated) return;
    const host = hostRef.current;
    if (!host || !("IntersectionObserver" in window)) {
      setActivated(true);
      return;
    }
    let near = false;
    const activate = () => {
      if (near && document.visibilityState === "visible") setActivated(true);
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        near = entry.isIntersecting && entry.intersectionRatio >= 0.1;
        activate();
      },
      { threshold: 0.1 },
    );
    observer.observe(host);
    document.addEventListener("visibilitychange", activate);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", activate);
    };
  }, [activated]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !activated) return;

    let mounted = true;
    let activeFrame: HTMLIFrameElement | null = null;
    let readinessTimer: number | null = null;
    setWidgetState("loading");
    container.replaceChildren();
    // Cover a blocked embedding script as well as an iframe that never loads.
    readinessTimer = window.setTimeout(() => {
      if (mounted) setWidgetState("error");
    }, 12000);

    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.width = "100%";
    widget.style.height = "100%";

    const attribution = document.createElement("div");
    attribution.className = "tradingview-widget-copyright";
    const attributionLink = document.createElement("a");
    attributionLink.href = `${tradingViewUrl}?utm_source=signalgen.local&utm_medium=widget&utm_campaign=advanced-chart`;
    attributionLink.rel = "noopener nofollow";
    attributionLink.target = "_blank";
    attributionLink.textContent = `${label} chart by TradingView`;
    attribution.append(attributionLink);

    const markReady = () => {
      if (!mounted) return;
      if (readinessTimer !== null) window.clearTimeout(readinessTimer);
      setWidgetState("ready");
    };

    const observer = new MutationObserver(() => {
      const iframe = container.querySelector<HTMLIFrameElement>("iframe");
      if (!mounted || !iframe || activeFrame === iframe) return;

      activeFrame = iframe;
      iframe.addEventListener("load", markReady, { once: true });
      observer.disconnect();
    });
    observer.observe(container, { childList: true, subtree: true });

    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.onerror = () => {
      if (mounted) setWidgetState("error");
      observer.disconnect();
    };
    script.textContent = JSON.stringify({
      autosize: true,
      symbol,
      interval: "D",
      // Initial horizontal zoom only; daily candle resolution stays unchanged.
      ...(initialRange ? { range: initialRange } : {}),
      timezone: "Asia/Jakarta",
      theme,
      backgroundColor:
        theme === "dark" ? "rgba(4, 8, 6, 1)" : "rgba(248, 251, 249, 1)",
      gridColor:
        theme === "dark" ? "rgba(54, 73, 62, 0.24)" : "rgba(57, 98, 73, 0.14)",
      style: "1",
      locale: "en",
      allow_symbol_change: false,
      calendar: false,
      details: false,
      hide_legend: false,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      hide_volume: false,
      hotlist: false,
      save_image: false,
      withdateranges: true,
      watchlist: [],
      support_host: "https://www.tradingview.com",
    });

    const appendTimer = window.setTimeout(() => {
      if (mounted) container.append(widget, attribution, script);
    }, 0);

    return () => {
      mounted = false;
      window.clearTimeout(appendTimer);
      if (readinessTimer !== null) window.clearTimeout(readinessTimer);
      activeFrame?.removeEventListener("load", markReady);
      observer.disconnect();
      container.replaceChildren();
    };
  }, [label, symbol, theme, initialRange, activated]);

  return (
    <div className="tradingview-chart" ref={hostRef}>
      <div
        className="tradingview-widget-container"
        ref={containerRef}
        aria-label={`TradingView chart for ${label}`}
      />
      {widgetState !== "ready" && (
        <div
          className={`tradingview-chart__status ${widgetState === "error" ? "is-error" : ""}`}
          role="status"
        >
          {widgetState === "error" ? (
            <>
              <CircleAlert />
              <strong>Chart unavailable</strong>
              <span>
                Check your connection or open this symbol directly on
                TradingView.
              </span>
              <a href={tradingViewUrl} target="_blank" rel="noreferrer">
                Open {label}
                <ExternalLink aria-hidden="true" />
              </a>
            </>
          ) : (
            <>
              {activated && <i aria-hidden="true" />}
              <strong>
                {activated ? "Loading TradingView" : "Chart ready to load"}
              </strong>
              <span>
                {activated
                  ? `Preparing ${label} · daily interval`
                  : "Scroll to the chart to load it."}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
