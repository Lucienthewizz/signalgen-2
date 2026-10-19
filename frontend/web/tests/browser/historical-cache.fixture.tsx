// Isolated synthetic fixture; all API calls MUST be intercepted by the CLI test.
// This file is not an entry point of the production build.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { session } from "../../src/api/client";
import { HistoricalCachePanel } from "../../src/components/historical-cache-panel";
import { startHistoricalCacheLifecycle } from "../../src/data/historical-lifecycle";
import { loadScreenerDataset } from "../../src/analysis/screener-dataset";
import { extractDatasetFeatures } from "../../src/analysis/screener-engine";
import type { DatasetManifest } from "../../src/types";
import "../../src/styles.css";

startHistoricalCacheLifecycle();
if (!session.getToken()) session.setToken("synthetic-browser-fixture");

function Fixture() {
  const [status, setStatus] = useState("Belum dijalankan");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  async function run(count: number) {
    setBusy(true);
    try {
      // An authorized manifest is supplied by the isolated test's fake API.
      const response = await fetch(`/fixture-manifest-${count}`);
      const manifest: DatasetManifest = await response.json();
      const controller = new AbortController();
      const data = await loadScreenerDataset(manifest, controller.signal);
      const result = await extractDatasetFeatures(
        data.series,
        controller.signal,
      );
      setStatus(
        `${data.series.length} saham · ${result.reduce((sum, item) => sum + item.candidates.length, 0)} kandidat · client Go/WASM`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Gagal");
    } finally {
      setBusy(false);
      setRevision((value) => value + 1);
    }
  }
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "24px",
        background: "var(--bg)",
        color: "var(--text)",
      }}
    >
      <div
        style={{
          maxWidth: "850px",
          margin: "0 auto",
          display: "grid",
          gap: "24px",
        }}
      >
        <h1>Cache historis · pengujian</h1>
        <p>
          Data sintetis, bukan akun atau harga saham nyata. IndexedDB, AES-GCM
          dan Go/WASM asli.
        </p>
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
          <button disabled={busy} onClick={() => void run(3)}>
            Run 3
          </button>
          <button disabled={busy} onClick={() => void run(10)}>
            Run 10
          </button>
          <button
            disabled={busy}
            onClick={() => {
              session.clear();
              setStatus("Logged out");
              setRevision((v) => v + 1);
            }}
          >
            Logout fixture
          </button>
          <button
            onClick={() => {
              session.setToken("synthetic-browser-fixture");
              setRevision((v) => v + 1);
            }}
          >
            Login fixture
          </button>
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
        </div>
        <output aria-label="Hasil fixture">
          {busy ? "Menghitung…" : status}
        </output>
        <HistoricalCachePanel
          key={revision}
          authenticated={Boolean(session.getToken())}
        />
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
