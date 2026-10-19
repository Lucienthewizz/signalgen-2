// Production components with explicitly mocked API/account/scoring in the CLI test.
// Not part of the production build; no real credentials or account writes.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { session } from "../../src/api/client";
import { startHistoricalCacheLifecycle } from "../../src/data/historical-lifecycle";
import { StockUniversesPanel } from "../../src/pages/workspace-resource-panels";
import { WorkspaceScreenerPanel } from "../../src/pages/workspace-screener-panel";
import { MarketMonitorPanel } from "../../src/pages/market-monitor-panel";
import "../../src/styles.css";
startHistoricalCacheLifecycle();
if (!session.getToken()) session.setToken("synthetic-us-token");
session.setAppSession("synthetic-us-session");
function Fixture() {
  const [view, setView] = useState("universes");
  return (
    <main
      style={{
        padding: 24,
        background: "var(--bg)",
        color: "var(--text)",
        minHeight: "100vh",
      }}
    >
      <div
        style={{ maxWidth: 1300, margin: "0 auto", display: "grid", gap: 24 }}
      >
        <h1>AS / USD · pengujian sintetis</h1>
        <p>
          Bukan akun atau harga nyata. Go/WASM dan komponen produksi asli;
          HTTP/private scoring dimock.
        </p>
        <nav style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {["universes", "screener", "monitor"].map((item) => (
            <button key={item} onClick={() => setView(item)}>
              {item}
            </button>
          ))}
          <button
            onClick={() => {
              document.documentElement.dataset.theme =
                document.documentElement.dataset.theme === "light"
                  ? "dark"
                  : "light";
            }}
          >
            Ganti tema
          </button>
        </nav>
        {view === "universes" && (
          <StockUniversesPanel authenticated backendOnline />
        )}
        {view === "screener" && (
          <WorkspaceScreenerPanel
            authenticated
            backendOnline
            userId="synthetic-us-user"
            onDraft={() => {}}
          />
        )}
        {view === "monitor" && (
          <MarketMonitorPanel userId="synthetic-us-user" />
        )}
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
