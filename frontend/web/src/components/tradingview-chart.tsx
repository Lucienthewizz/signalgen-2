import { useEffect, useRef, useState } from "react";
import { CircleAlert, ExternalLink } from "lucide-react";

type WidgetState = "loading" | "ready" | "error";

export function TradingViewChart({
  symbol,
  label,
}: {
  symbol: string;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [widgetState, setWidgetState] = useState<WidgetState>("loading");
  const tradingViewUrl = `https://www.tradingview.com/symbols/${symbol.replace(":", "-")}/`;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let mounted = true;
    let activeFrame: HTMLIFrameElement | null = null;
    let readinessTimer: number | null = null;
    setWidgetState("loading");
    container.replaceChildren();

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
      readinessTimer = window.setTimeout(() => {
        if (mounted) setWidgetState("error");
      }, 8000);
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
      interval: "15",
      timezone: "Asia/Jakarta",
      theme: "dark",
      backgroundColor: "rgba(4, 8, 6, 1)",
      gridColor: "rgba(54, 73, 62, 0.24)",
      style: "1",
      locale: "id",
      allow_symbol_change: true,
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
  }, [label, symbol]);

  return (
    <div className="tradingview-chart">
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
              <strong>Chart belum dapat dimuat</strong>
              <span>
                Periksa koneksi internet atau buka simbol langsung di
                TradingView.
              </span>
              <a href={tradingViewUrl} target="_blank" rel="noreferrer">
                Buka {label}
                <ExternalLink aria-hidden="true" />
              </a>
            </>
          ) : (
            <>
              <i aria-hidden="true" />
              <strong>Memuat feed TradingView</strong>
              <span>Menyiapkan {label} · interval 15 menit</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
