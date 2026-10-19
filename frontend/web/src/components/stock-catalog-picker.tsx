import { useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { catalogPage, universeSelectionLimit } from "@/lib/stock-catalog";
import type { StockInstrument } from "@/types";
import "./stock-catalog-picker.css";

type Props = {
  catalog: StockInstrument[];
  selected: string[];
  loading: boolean;
  disabled: boolean;
  onToggle: (symbol: string) => void;
};

export function StockCatalogPicker({
  catalog,
  selected,
  loading,
  disabled,
  onToggle,
}: Props) {
  const [query, setQuery] = useState("");
  const [requestedPage, setRequestedPage] = useState(0);
  const result = useMemo(
    () => catalogPage(catalog, query, requestedPage),
    [catalog, query, requestedPage],
  );
  const full = selected.length >= universeSelectionLimit;
  return (
    <div className="stock-catalog-picker" aria-busy={loading}>
      <label htmlFor="catalog-search">Cari kode atau nama perusahaan</label>
      <Input
        id="catalog-search"
        type="search"
        placeholder="Contoh: ASII, AAPL atau nama perusahaan"
        value={query}
        maxLength={80}
        disabled={loading || disabled}
        onChange={(event) => {
          setQuery(event.target.value);
          setRequestedPage(0);
        }}
      />
      <p
        id="catalog-selection-help"
        className="stock-catalog-picker__summary"
        role="status"
      >
        {loading
          ? "Memuat katalog saham…"
          : `${catalog.length.toLocaleString("id-ID")} saham tersedia · ${selected.length}/${universeSelectionLimit} dipilih`}
        {full &&
          " · Batas pilihan tercapai. Hapus satu saham untuk menggantinya."}
      </p>
      {selected.length > 0 && (
        <div
          className="stock-catalog-picker__selected"
          aria-label="Saham yang dipilih"
        >
          {selected.map((symbol) => (
            <Button
              key={symbol}
              variant="outline"
              size="sm"
              disabled={disabled || loading}
              aria-label={`Hapus ${symbol.replace(/\.JK$/, "")} dari pilihan`}
              onClick={() => onToggle(symbol)}
            >
              {symbol.replace(/\.JK$/, "")}
              <X data-icon="inline-end" aria-hidden="true" />
            </Button>
          ))}
        </div>
      )}
      {loading ? (
        <p role="status">
          <LoaderCircle className="is-spinning" aria-hidden="true" /> Memuat
          pilihan saham
        </p>
      ) : catalog.length === 0 ? (
        <p>Katalog belum tersedia. Gunakan Muat ulang untuk mencoba kembali.</p>
      ) : result.totalMatches === 0 ? (
        <p role="status">
          Tidak ada saham untuk “{query}”. Coba kode atau nama lain.
        </p>
      ) : (
        <>
          <div
            className="instrument-choices"
            aria-label="Hasil pencarian katalog"
            aria-describedby="catalog-selection-help"
          >
            {result.items.map((stock) => {
              const active = selected.includes(stock.symbol);
              return (
                <button
                  key={stock.symbol}
                  type="button"
                  className={active ? "is-selected" : ""}
                  aria-pressed={active}
                  disabled={disabled || (full && !active)}
                  onClick={() => onToggle(stock.symbol)}
                >
                  <span>{stock.symbol.replace(/\.JK$/, "")}</span>
                  <small>{stock.name}</small>
                  <i aria-hidden="true">{active ? <Check /> : <Plus />}</i>
                </button>
              );
            })}
          </div>
          <nav
            className="stock-catalog-picker__pagination"
            aria-label="Halaman katalog saham"
          >
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || result.page === 0}
              aria-label="Halaman saham sebelumnya"
              onClick={() => setRequestedPage(result.page - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <span>
              {result.totalMatches.toLocaleString("id-ID")} hasil · Halaman{" "}
              {result.page + 1}/{result.pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || result.page + 1 === result.pageCount}
              aria-label="Halaman saham berikutnya"
              onClick={() => setRequestedPage(result.page + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        </>
      )}
    </div>
  );
}
