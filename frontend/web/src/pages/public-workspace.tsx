import {
  ArrowRight,
  BookOpenCheck,
  Braces,
  ChartNoAxesCombined,
  CircleCheckBig,
  Gauge,
  Menu,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Brand } from "@/components/brand";
import { MarketTrace } from "@/components/market-trace";
import { useState } from "react";

export function PublicWorkspace({ backendOnline }: { backendOnline: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <main className="workbench">
      <aside className={`sidebar ${menuOpen ? "is-open" : ""}`}>
        <div className="sidebar__brand">
          <a href="#home" aria-label="Signalgen home">
            <Brand compact />
          </a>
          <button onClick={() => setMenuOpen(false)} aria-label="Tutup menu">
            <X />
          </button>
        </div>
        <div className="surface-label">
          <span>Web workspace</span>
          <i className="status-dot is-online" />
        </div>
        <nav aria-label="Navigasi utama">
          <div className="nav-group">
            <span>Workspace</span>
            <a className="active" href="#home">
              <i />
              <Gauge /> Overview
            </a>
            <a href="#workflow">
              <Braces /> Alur analisis
            </a>
            <a href="#principles">
              <ShieldCheck /> Batas produk
            </a>
          </div>
          <div className="nav-group">
            <span>Account</span>
            <a href="#login">
              <BookOpenCheck /> Masuk atau daftar
            </a>
          </div>
        </nav>
        <div className="sidebar__footer">
          <div className="live-card">
            <span>Authorization API</span>
            <b>
              <i className={backendOnline ? "online" : ""} />
              {backendOnline ? "Connected" : "Not connected"}
            </b>
          </div>
          <small>Signalgen web · MVP interface</small>
        </div>
      </aside>
      {menuOpen && (
        <button
          className="backdrop"
          onClick={() => setMenuOpen(false)}
          aria-label="Tutup menu"
        />
      )}
      <section className="workspace">
        <header className="topbar">
          <div className="topbar__title">
            <button
              className="menu-button"
              onClick={() => setMenuOpen(true)}
              aria-label="Buka menu"
            >
              <Menu />
            </button>
            <div>
              <span className="breadcrumb">Signalgen / Web</span>
              <h1>Market workspace</h1>
            </div>
          </div>
          <div className="topbar__actions">
            <span className="preview-chip">Interface preview</span>
            <Button
              className="ui-button ui-button--primary"
              onClick={() => {
                location.hash = "login";
              }}
            >
              Masuk <ArrowRight />
            </Button>
          </div>
        </header>
        <div className="workspace__content">
          <div
            className={`verification-rail ${backendOnline ? "" : "is-offline"}`}
          >
            <span>
              <i />{" "}
              {backendOnline ? "Backend verified" : "Backend belum terhubung"}
            </span>
            <b>Account boundary aktif di seluruh surface</b>
            <small>Supabase authorization</small>
          </div>
          <section className="market-hero">
            <div className="market-hero__copy">
              <span className="section-index">01 / Analysis workspace</span>
              <h2>
                Read the market.
                <br />
                <em>Verify the signal.</em>
              </h2>
              <p>
                Susun rule, jalankan screening, dan telusuri alasan di balik
                setiap signal IDX dalam satu workspace web yang ringan.
              </p>
              <div className="hero-actions">
                <Button
                  className="ui-button ui-button--primary"
                  onClick={() => {
                    location.hash = "register";
                  }}
                >
                  Buat akun <ArrowRight />
                </Button>
                <a className="ui-button" href="#workflow">
                  Lihat alurnya
                </a>
              </div>
            </div>
            <MarketTrace />
          </section>
          <section className="ledger-metrics" aria-label="Prinsip produk">
            <div className="ledger-metric">
              <span>Rule first</span>
              <strong>01</strong>
              <small>
                <CircleCheckBig /> Kondisi eksplisit
              </small>
            </div>
            <div className="ledger-metric">
              <span>State aware</span>
              <strong>02</strong>
              <small>
                <CircleCheckBig /> Konteks terbaca
              </small>
            </div>
            <div className="ledger-metric">
              <span>Signal trace</span>
              <strong>03</strong>
              <small>
                <CircleCheckBig /> Alasan tersimpan
              </small>
            </div>
            <div className="ledger-metric">
              <span>User boundary</span>
              <strong>04</strong>
              <small>
                <CircleCheckBig /> Data terisolasi
              </small>
            </div>
          </section>
          <section className="workflow-panel" id="workflow">
            <div className="section-heading">
              <div>
                <span className="section-index">02 / Workflow</span>
                <h3>Dari hipotesis ke signal yang bisa diperiksa</h3>
              </div>
              <span className="preview-chip">Data demonstrasi</span>
            </div>
            <div className="workflow-grid">
              <article>
                <span>01</span>
                <Braces />
                <h4>Build the rule</h4>
                <p>
                  Gabungkan indikator dan kondisi tanpa menyembunyikan
                  logikanya.
                </p>
              </article>
              <article>
                <span>02</span>
                <ChartNoAxesCombined />
                <h4>Run the screen</h4>
                <p>Uji rule pada watchlist dan timeframe yang Anda tentukan.</p>
              </article>
              <article>
                <span>03</span>
                <BookOpenCheck />
                <h4>Read the evidence</h4>
                <p>
                  Lihat condition state yang membuat signal muncul atau gagal.
                </p>
              </article>
            </div>
          </section>
          <section className="boundary-panel" id="principles">
            <ShieldCheck />
            <div>
              <span className="section-index">03 / Product boundary</span>
              <h3>Alat analisis, bukan pemberi keputusan.</h3>
              <p>
                Signalgen membantu menyusun dan mengevaluasi rule. Keputusan
                investasi tetap berada pada pengguna.
              </p>
            </div>
            <a href="#register">
              Mulai dengan akun Anda <ArrowRight />
            </a>
          </section>
        </div>
      </section>
    </main>
  );
}
