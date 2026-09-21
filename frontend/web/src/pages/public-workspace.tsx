import { useEffect, useState } from "react";
import { ArrowRight, Check, ShieldCheck, Star } from "lucide-react";
import { Brand } from "@/components/brand";
import { FeatureFigure } from "@/components/feature-figure";
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
import type { User } from "@/types";
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

const capabilityViews = [
  {
    id: "analysis",
    title: "Screening & backtest",
    description:
      "Konfigurasi, progress, cancel, result metrics, dan alasan per signal.",
  },
  {
    id: "rules",
    title: "Rule management",
    description:
      "System rule read-only dan CRUD rule privat untuk menguji builder.",
  },
  {
    id: "journal",
    title: "Journal & position",
    description:
      "Draft dari hasil, transaksi manual, posisi, dan ringkasan P&L.",
  },
  {
    id: "access",
    title: "Entitlement & devices",
    description: "Status akses, sesi perangkat, revoke, dan clear cache.",
  },
] as const;

export function PublicWorkspace({
  backendOnline,
  user,
}: {
  backendOnline: boolean;
  user: User | null;
}) {
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
      <section className="workspace landing-workspace">
        <header className="landing-header">
          <div className="landing-header__inner">
            <a
              className="landing-header__brand"
              href="#home"
              aria-label="Signalgen home"
            >
              <Brand compact />
            </a>
            <nav className="landing-header__nav" aria-label="Navigasi utama">
              <a href="#capabilities">Fitur</a>
              <a href="#product-tour">Preview</a>
              <a href="#reviews">Rating</a>
              <a href="#faq">FAQ</a>
              <a href="#app/overview">Demo</a>
            </nav>
            <a
              className="landing-header__session"
              href={user ? "#app/overview" : "#login"}
            >
              {user ? "Dashboard" : "Masuk"}
            </a>
          </div>
        </header>
        <div className="workspace__content landing-content">
          <section className="market-hero">
            <div className="market-hero__chart" aria-hidden="true">
              <MarketTrace />
            </div>
            <div className="market-hero__copy">
              <span
                className={`hero-data-note ${backendOnline ? "is-online" : ""}`}
              >
                <i /> Preview fixture lokal · Data tidak live
              </span>
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
            <div className="feature-gallery">
              {capabilityViews.map((feature) => (
                <a
                  className="feature-gallery__item"
                  href={`#app/${feature.id}`}
                  key={feature.id}
                >
                  <div className="feature-gallery__figure">
                    <FeatureFigure kind={feature.id} />
                  </div>
                  <div className="feature-gallery__copy">
                    <strong>{feature.title}</strong>
                    <p>{feature.description}</p>
                    <span>
                      Buka fitur <ArrowRight />
                    </span>
                  </div>
                </a>
              ))}
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
