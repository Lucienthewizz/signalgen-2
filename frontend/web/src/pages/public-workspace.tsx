import { useEffect, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  Braces,
  Check,
  ChevronRight,
  CircleCheckBig,
  Gauge,
  Menu,
  ShieldCheck,
  Star,
  X,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { MarketTrace } from "@/components/market-trace";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import { faqItems, sampleRatings } from "@/data/demo";
import { cn } from "@/lib/utils";
import overviewImage from "@/assets/feature-overview.png";
import analysisImage from "@/assets/feature-analysis.png";
import rulesImage from "@/assets/feature-rules.png";
import journalImage from "@/assets/feature-journal.png";
import accessImage from "@/assets/feature-access.png";

const productViews = [
  {
    id: "overview",
    label: "Overview",
    image: overviewImage,
    description: "Status integrasi dan akses cepat ke seluruh workflow.",
  },
  {
    id: "analysis",
    label: "Analisis",
    image: analysisImage,
    description:
      "Konfigurasi screening atau backtest dengan hasil yang dapat ditelusuri.",
  },
  {
    id: "rules",
    label: "Rules",
    image: rulesImage,
    description: "Kelola rule sistem dan rule privat dari satu tempat.",
  },
  {
    id: "journal",
    label: "Jurnal",
    image: journalImage,
    description: "Catat transaksi dan lanjutkan signal menjadi draft jurnal.",
  },
  {
    id: "access",
    label: "Akses",
    image: accessImage,
    description: "Periksa entitlement, perangkat aktif, dan cache pengguna.",
  },
] as const;

export function PublicWorkspace({ backendOnline }: { backendOnline: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [ratingApi, setRatingApi] = useState<CarouselApi>();
  const [ratingIndex, setRatingIndex] = useState(0);
  const [selectedView, setSelectedView] = useState(0);

  useEffect(() => {
    if (!ratingApi) return;
    const updateIndex = () => setRatingIndex(ratingApi.selectedScrollSnap());
    updateIndex();
    ratingApi.on("select", updateIndex);
    return () => {
      ratingApi.off("select", updateIndex);
    };
  }, [ratingApi]);

  return (
    <main className="workbench landing-shell">
      <aside className={`sidebar landing-sidebar ${menuOpen ? "is-open" : ""}`}>
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
            <span>EXPLORE</span>
            <a className="active" href="#home">
              <i />
              <Gauge /> Overview
            </a>
            <a href="#capabilities">
              <Braces /> Fitur MVP
            </a>
            <a href="#reviews">
              <Star /> Rating preview
            </a>
            <a href="#faq">
              <BookOpenCheck /> FAQ
            </a>
          </div>
          <div className="nav-group">
            <span>WORKSPACE</span>
            <a href="#app/overview">
              <BarChart3 /> Buka demo interaktif
            </a>
          </div>
        </nav>
        <div className="sidebar__footer">
          <div className="live-card">
            <span>Backend API</span>
            <b>
              <i className={backendOnline ? "online" : ""} />
              {backendOnline ? "Reachable" : "Not connected"}
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
            <a className="topbar-link" href="#app/overview">
              Coba demo
            </a>
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
        <div className="workspace__content landing-content">
          <div
            className={`verification-rail ${backendOnline ? "" : "is-offline"}`}
          >
            <span>
              <i />{" "}
              {backendOnline
                ? "Backend base API terjangkau"
                : "Backend base API belum terjangkau"}
            </span>
            <b>Analisis pada preview memakai fixture lokal</b>
            <small>Tidak ada data live</small>
          </div>
          <section className="market-hero">
            <div className="market-hero__copy">
              <h2>
                Read the market.
                <br />
                <em>Verify the signal.</em>
              </h2>
              <p>
                Susun rule, jalankan screening, dan telusuri alasan di balik
                setiap signal IDX dalam workspace web yang ringan dan bisa
                diperiksa.
              </p>
              <div className="hero-actions">
                <Button
                  className="ui-button ui-button--primary"
                  onClick={() => {
                    location.hash = "app/overview";
                  }}
                >
                  Coba seluruh flow <ArrowRight />
                </Button>
                <a className="ui-button" href="#capabilities">
                  Lihat fiturnya
                </a>
              </div>
              <div className="hero-proof">
                <span>
                  <Check /> Rule transparan
                </span>
                <span>
                  <Check /> Hasil explainable
                </span>
                <span>
                  <Check /> Jurnal terhubung
                </span>
              </div>
            </div>
            <MarketTrace />
          </section>
          <section className="ledger-metrics" aria-label="Prinsip produk">
            {[
              ["Rule first", "Kondisi eksplisit"],
              ["State aware", "Konteks terbaca"],
              ["Signal trace", "Alasan tersimpan"],
              ["User boundary", "Data terisolasi"],
            ].map(([label, copy]) => (
              <div className="ledger-metric" key={label}>
                <strong>{label}</strong>
                <small>
                  <CircleCheckBig /> {copy}
                </small>
              </div>
            ))}
          </section>
          <section className="capability-section" id="capabilities">
            <div className="section-heading split-heading">
              <div>
                <h3>Semua fitur utama dalam satu workspace.</h3>
                <p>
                  Seluruh flow pada PRD dapat dijelajahi dengan data demonstrasi
                  yang konsisten.
                </p>
              </div>
              <a className="ui-button" href="#app/overview">
                Buka workspace <ArrowRight />
              </a>
            </div>
            <div className="capability-ledger">
              <a href="#app/analysis">
                <BarChart3 />
                <div>
                  <strong>Screening & backtest</strong>
                  <p>
                    Konfigurasi, progress, cancel, result metrics, dan alasan
                    per signal.
                  </p>
                </div>
                <ChevronRight />
              </a>
              <a href="#app/rules">
                <Braces />
                <div>
                  <strong>Rule management</strong>
                  <p>
                    System rule read-only dan CRUD rule privat untuk menguji
                    builder.
                  </p>
                </div>
                <ChevronRight />
              </a>
              <a href="#app/journal">
                <BookOpenCheck />
                <div>
                  <strong>Journal & position</strong>
                  <p>
                    Draft dari hasil, transaksi manual, posisi, dan ringkasan
                    P&amp;L.
                  </p>
                </div>
                <ChevronRight />
              </a>
              <a href="#app/access">
                <ShieldCheck />
                <div>
                  <strong>Entitlement & devices</strong>
                  <p>Status akses, sesi perangkat, revoke, dan clear cache.</p>
                </div>
                <ChevronRight />
              </a>
            </div>
          </section>
          <section className="product-tour" id="product-tour">
            <div className="product-tour__heading">
              <div>
                <h3>Lihat workspace sebelum mulai.</h3>
                <p>
                  Setiap gambar diambil langsung dari fitur web yang dapat Anda
                  buka sekarang.
                </p>
              </div>
              <a
                href={`#app/${productViews[selectedView].id}`}
                className="text-link"
              >
                Buka {productViews[selectedView].label} <ArrowRight />
              </a>
            </div>
            <div
              className="product-tour__tabs"
              role="tablist"
              aria-label="Preview fitur web"
            >
              {productViews.map((view, index) => (
                <button
                  key={view.id}
                  role="tab"
                  aria-selected={selectedView === index}
                  className={cn(
                    "product-tour__tab",
                    selectedView === index && "active",
                  )}
                  onClick={() => setSelectedView(index)}
                >
                  <strong>{view.label}</strong>
                  <span>{view.description}</span>
                </button>
              ))}
            </div>
            <figure className="product-tour__frame">
              <img
                key={productViews[selectedView].id}
                src={productViews[selectedView].image}
                alt={`Tampilan fitur ${productViews[selectedView].label} pada Signalgen web`}
                loading={selectedView === 0 ? "eager" : "lazy"}
              />
              <figcaption>
                <strong>{productViews[selectedView].label}</strong>
                <span>{productViews[selectedView].description}</span>
              </figcaption>
            </figure>
          </section>
          <section className="rating-section" id="reviews">
            <div className="rating-context">
              <h3>Format rating yang bisa digeser dan diklik.</h3>
              <p>
                Konten berikut adalah contoh copy untuk mengecek pengalaman
                carousel—bukan testimoni pelanggan terverifikasi.
              </p>
            </div>
            <Carousel
              setApi={setRatingApi}
              className="rating-carousel"
              opts={{ loop: true }}
            >
              <CarouselContent>
                {sampleRatings.map((rating, index) => (
                  <CarouselItem key={index}>
                    <article className="rating-card">
                      <div className="rating-score">
                        <Star />
                        <strong>{rating.score}</strong>
                        <span>/ 5</span>
                      </div>
                      <blockquote>“{rating.quote}”</blockquote>
                      <footer>
                        <span>Contoh profil</span>
                        <strong>{rating.role}</strong>
                      </footer>
                    </article>
                  </CarouselItem>
                ))}
              </CarouselContent>
              <div className="rating-controls">
                <CarouselPrevious className="rating-arrow" />
                <CarouselNext className="rating-arrow" />
              </div>
              <div className="rating-dots" aria-label="Pilih slide rating">
                {sampleRatings.map((_, index) => (
                  <button
                    key={index}
                    className={ratingIndex === index ? "active" : ""}
                    onClick={() => ratingApi?.scrollTo(index)}
                    aria-label={`Buka rating ${index + 1}`}
                  />
                ))}
              </div>
            </Carousel>
          </section>
          <section className="faq-section" id="faq">
            <div className="faq-intro">
              <h3>Jawaban sebelum Anda masuk.</h3>
              <p>
                Detail penting tentang batas produk, data demo, dan cara kerja
                web MVP.
              </p>
            </div>
            <Accordion className="faq-list" defaultValue={["faq-0"]}>
              {faqItems.map(([question, answer], index) => (
                <AccordionItem key={question} value={`faq-${index}`}>
                  <AccordionTrigger>{question}</AccordionTrigger>
                  <AccordionContent>
                    <p>{answer}</p>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
          <section className="boundary-panel landing-cta">
            <ShieldCheck />
            <div>
              <h3>Alat analisis, bukan pemberi keputusan.</h3>
              <p>
                Mulai dari demo, periksa seluruh flow, lalu gunakan akun saat
                backend siap.
              </p>
            </div>
            <a href="#app/overview">
              Masuk ke demo <ArrowRight />
            </a>
          </section>
        </div>
      </section>
    </main>
  );
}
