// Browser-only UI fixture. Synthetic rows, no auth/API calls, not market data.
// This HTML is not an input of the production build.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { StockCatalogPicker } from "../../src/components/stock-catalog-picker";
import { universeSelectionLimit } from "../../src/lib/stock-catalog";
import type { StockInstrument } from "../../src/types";
import "../../src/styles.css";

const catalog: StockInstrument[] = [
  {
    symbol: "ASII.JK",
    name: "Astra International Tbk",
    exchange: "XIDX",
    currency: "IDR",
  },
  {
    symbol: "BBCA.JK",
    name: "Bank Central Asia Tbk",
    exchange: "XIDX",
    currency: "IDR",
  },
  {
    symbol: "BBRI.JK",
    name: "Bank Rakyat Indonesia Tbk",
    exchange: "XIDX",
    currency: "IDR",
  },
  ...Array.from({ length: 959 }, (_, i) => ({
    symbol: `FIXTURE${i}.JK`,
    name: `Perusahaan uji ${i} · ini data sintetis, bukan emiten`,
    exchange: "XIDX" as const,
    currency: "IDR" as const,
  })),
];

function Fixture() {
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [light, setLight] = useState(false);
  return (
    <main
      data-theme={light ? "light" : "dark"}
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--text)",
        padding: "24px",
        overflowWrap: "anywhere",
      }}
    >
      <div
        style={{
          maxWidth: "720px",
          margin: "0 auto",
          display: "grid",
          gap: "16px",
        }}
      >
        <h1>Katalog · UI fixture</h1>
        <p>
          962 baris sintetis untuk pengujian UI. Bukan akun atau data saham
          nyata.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px" }}>
          <button
            onClick={() => {
              document.documentElement.dataset.theme = light ? "dark" : "light";
              setLight(!light);
            }}
          >
            Ganti tema
          </button>
          <button onClick={() => setLoading(!loading)}>Toggle loading</button>
          <button onClick={() => setEmpty(!empty)}>Toggle empty</button>
        </div>
        <StockCatalogPicker
          catalog={empty ? [] : catalog}
          selected={selected}
          loading={loading}
          disabled={false}
          onToggle={(symbol) =>
            setSelected((current) =>
              current.includes(symbol)
                ? current.filter((item) => item !== symbol)
                : current.length < universeSelectionLimit
                  ? [...current, symbol]
                  : current,
            )
          }
        />
        <output aria-label="Pilihan fixture">
          {selected.join(", ") || "Belum dipilih"}
        </output>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
