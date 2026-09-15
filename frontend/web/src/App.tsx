import { FormEvent, useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Download,
  Menu,
  X,
  Star,
  Quote,
  ChartNoAxesCombined,
  ListFilter,
  CircleHelp,
  ShieldCheck,
} from "lucide-react";
import { api, session } from "./api/client";
import { ApiError } from "./api/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Skeleton as LoadingSkeleton } from "@/components/ui/skeleton";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { MagneticLiquidButton } from "@/components/ui/magnetic-liquid-button";
import InteractiveListPreview from "@/components/ui/interactive-list-preview";
import type { User } from "./types";

type Page = "home" | "account" | "download";
const pageFromHash = (): Page =>
  location.hash === "#account" || location.hash === "#register"
    ? "account"
    : location.hash === "#download"
      ? "download"
      : "home";
function Skeleton({ label = "Memuat halaman…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span>{label}</span>
      <LoadingSkeleton className="sk-title" />
      <LoadingSkeleton className="sk-copy" />
      <LoadingSkeleton className="sk-panel" />
    </div>
  );
}
function Brand() {
  return (
    <span className="brand">
      <span className="mark">
        <img src="/signalgen-mark.png" alt="" />
      </span>
      Signalgen
    </span>
  );
}
export default function App() {
  const [page, setPage] = useState<Page>(pageFromHash),
    [pending, setPending] = useState(true),
    [menu, setMenu] = useState(false);
  useEffect(() => {
    const change = () => {
      const next = pageFromHash();
      if (next !== page) {
        setPending(true);
        setPage(next);
      }
      setMenu(false);
    };
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, [page]);
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setPending(false));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [page]);
  return (
    <>
      <header className="site-header">
        <a href="#home" aria-label="Signalgen home">
          <Brand />
        </a>
        <button
          className="menu"
          onClick={() => setMenu(!menu)}
          aria-label={menu ? "Tutup menu" : "Buka menu"}
          aria-expanded={menu}
          aria-controls="site-navigation"
        >
          {menu ? <X /> : <Menu />}
        </button>
        <nav id="site-navigation" className={cn(menu && "open")}>
          <a href="#home" aria-current={page === "home" ? "page" : undefined}>
            Produk
          </a>
          <a href="#register">Daftar</a>
          <a
            href="#download"
            aria-current={page === "download" ? "page" : undefined}
          >
            Desktop
          </a>
          <a
            href="#account"
            aria-current={page === "account" ? "page" : undefined}
          >
            Masuk <ArrowUpRight size={14} />
          </a>
        </nav>
      </header>
      <main>
        {pending ? (
          <Skeleton />
        ) : page === "home" ? (
          <Landing />
        ) : page === "account" ? (
          <Account />
        ) : (
          <Downloads />
        )}
      </main>
      <footer>
        <Brand />
        <span>Alat analisis saham. Setiap keputusan tetap milik Anda.</span>
        <a href="#download">
          Signalgen Desktop <ArrowUpRight size={14} />
        </a>
      </footer>
    </>
  );
}
function Landing() {
  const [loaded, setLoaded] = useState(false),
    [failed, setFailed] = useState(false);
  return (
    <>
      <section className="hero opening-copy">
        <h1>
          Read the market.
          <br />
          Understand the signal.
        </h1>
        <div className="hero-bottom">
          <p>
            Ruang kerja untuk menyusun rule, menyaring saham IDX, dan menguji
            ide Anda. Semua dimulai dari kondisi yang bisa dijelaskan.
          </p>
          <div className="hero-actions">
            <MagneticLiquidButton
              onClick={() => {
                location.hash = "register";
              }}
              rightIcon={<ArrowRight />}
            >
              Buat akun Signalgen
            </MagneticLiquidButton>
            <a className="text-link" href="#download">
              Kenali aplikasi desktop <ArrowUpRight size={16} />
            </a>
          </div>
        </div>
      </section>
      <figure className="product-shot opening-preview">
        <div className="window-bar">
          <span>
            <i />
            <i />
            <i />
          </span>
          <span>Signalgen Desktop / Overview</span>
          <span>Preview</span>
        </div>
        <div className="image-area">
          {!loaded && !failed && (
            <LoadingSkeleton
              className="image-skeleton"
              role="status"
              aria-label="Memuat overview desktop"
            />
          )}
          {failed ? (
            <p role="alert">
              Preview belum dapat dimuat. Muat ulang halaman untuk mencoba
              kembali.
            </p>
          ) : (
            <img
              src="/desktop-overview.jpg"
              width="1271"
              height="715"
              alt="Overview Signalgen Desktop: grafik IDX Composite dan ringkasan workspace. Data preview bersifat ilustratif."
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
              className={loaded ? "loaded" : ""}
            />
          )}
        </div>
        <figcaption>
          Overview aplikasi desktop. Data pasar pada screenshot ini bersifat
          ilustratif.
        </figcaption>
      </figure>
      <section className="intro">
        <h2>
          Satu workspace.
          <br />
          Dari rule sampai alasan.
        </h2>
        <p>
          Analisis yang terstruktur membantu Anda melihat apa yang terjadi,
          kondisi mana yang terpenuhi, dan apa yang perlu diuji berikutnya.
        </p>
      </section>
      <section
        className="feature-explorer"
        aria-label="Fitur Signalgen Desktop"
      >
        <InteractiveListPreview
          items={[
            {
              client: "Susun rule",
              platform: "Rule builder",
              services: "Gabungkan indikator menjadi kondisi yang terbaca.",
              img: "/desktop-rules.png",
            },
            {
              client: "Saring saham",
              platform: "Stock screening",
              services: "Persempit daftar IDX dengan rule Anda sendiri.",
              img: "/desktop-screening.png",
            },
            {
              client: "Uji ide",
              platform: "Backtesting",
              services: "Periksa hipotesis pada data historis yang tersedia.",
              img: "/desktop-backtesting.png",
            },
            {
              client: "Pahami signal",
              platform: "Realtime monitoring",
              services: "Lihat kondisi mana yang terpenuhi dan alasannya.",
              img: "/desktop-signals.png",
            },
          ]}
        />
        <p className="explorer-note">
          Arahkan kursor atau pilih fitur untuk melihat tampilan desktop asli.
          Fitur masih dalam pengembangan; data preview bersifat ilustratif.
        </p>
      </section>
      <Testimonials />
      <FAQ />
      <section className="closing">
        <h2>
          Mulai dari pertanyaan.
          <br />
          Lanjutkan dengan bukti.
        </h2>
        <MagneticLiquidButton
          onClick={() => {
            location.hash = "register";
          }}
          rightIcon={<ArrowRight />}
        >
          Buka akun Signalgen
        </MagneticLiquidButton>
        <a className="text-link" href="#download">
          Lihat ketersediaan desktop <ArrowUpRight size={15} />
        </a>
      </section>
    </>
  );
}
function Account() {
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true),
    [register, setRegister] = useState(location.hash === "#register"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [errorMessage, setErrorMessage] = useState(false);
  useEffect(() => {
    const change = () => {
      setRegister(location.hash === "#register");
      setMessage("");
    };
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    let active = true;
    if (!session.getToken()) {
      setChecking(false);
      return;
    }
    api
      .me()
      .then((value) => {
        if (active) setUser(value);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) session.clear();
        else {
          setMessage(
            error instanceof Error ? error.message : "Akun belum dapat dimuat.",
          );
          setErrorMessage(true);
        }
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    const reset = () => setUser(null);
    addEventListener("signalgen:unauthorized", reset);
    return () => {
      active = false;
      removeEventListener("signalgen:unauthorized", reset);
    };
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setMessage("");
    setErrorMessage(false);
    try {
      const email = String(data.get("email")).trim(),
        password = String(data.get("password"));
      if (register && String(data.get("name")).trim().length < 2)
        throw new Error("Isi nama lengkap dengan minimal 2 karakter.");
      if (register && password !== data.get("confirmation"))
        throw new Error("Konfirmasi password belum sama.");
      const result = register
        ? await api.register(String(data.get("name")).trim(), email, password)
        : await api.login(email, password);
      if (result.access_token) {
        session.setToken(result.access_token);
        setUser(result.user);
      } else {
        setRegister(false);
        setMessage("Akun dibuat. Konfirmasi email Anda, lalu masuk.");
      }
    } catch (error) {
      setErrorMessage(true);
      setMessage(
        error instanceof Error
          ? error.message
          : "Permintaan gagal. Coba kembali.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (checking) return <Skeleton label="Memuat akun…" />;
  return (
    <section className="account">
      <div>
        <h1>
          {user
            ? "Akun Anda."
            : register
              ? "Mulai dengan akun Anda."
              : "Kembali ke workspace Anda."}
        </h1>
        <p>Satu identitas untuk web dan aplikasi desktop Signalgen.</p>
      </div>
      {user ? (
        <div className="account-panel">
          <h2>{user.full_name || "Pengguna Signalgen"}</h2>
          <p>{user.email}</p>
          <p>Informasi paket akun belum tersedia.</p>
          <a className="button primary" href="#download">
            Lihat desktop <ArrowRight size={16} />
          </a>
          <button
            className="button"
            onClick={() => {
              session.clear();
              setUser(null);
            }}
          >
            Keluar
          </button>
        </div>
      ) : (
        <form className="account-panel" onSubmit={submit}>
          <Tabs
            value={register ? "register" : "login"}
            onValueChange={(value) => {
              setRegister(value === "register");
              setMessage("");
              setErrorMessage(false);
            }}
          >
            <TabsList aria-label="Akses akun" variant="line">
              <TabsTrigger value="login" disabled={busy}>
                Masuk
              </TabsTrigger>
              <TabsTrigger value="register" disabled={busy}>
                Daftar
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <FieldGroup>
            {register && (
              <Field data-disabled={busy}>
                <FieldLabel htmlFor="full-name">Nama lengkap</FieldLabel>
                <Input
                  id="full-name"
                  name="name"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={100}
                  disabled={busy}
                />
              </Field>
            )}
            <Field data-disabled={busy}>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                disabled={busy}
              />
            </Field>
            <Field data-disabled={busy}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                required
                minLength={register ? 6 : 1}
                maxLength={1024}
                disabled={busy}
                aria-describedby={register ? "password-help" : undefined}
              />
              {register && (
                <FieldDescription id="password-help">
                  Gunakan minimal 6 karakter.
                </FieldDescription>
              )}
            </Field>
            {register && (
              <Field
                data-disabled={busy}
                data-invalid={
                  message === "Konfirmasi password belum sama." || undefined
                }
              >
                <FieldLabel htmlFor="confirmation">
                  Konfirmasi password
                </FieldLabel>
                <Input
                  id="confirmation"
                  name="confirmation"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  maxLength={1024}
                  disabled={busy}
                  aria-invalid={
                    message === "Konfirmasi password belum sama." || undefined
                  }
                  aria-describedby={message ? "auth-message" : undefined}
                />
              </Field>
            )}
          </FieldGroup>
          {message && (
            <Alert
              id="auth-message"
              variant={errorMessage ? "destructive" : "default"}
              role={errorMessage ? "alert" : "status"}
            >
              <AlertTitle>
                {errorMessage ? "Periksa kembali" : "Akun berhasil dibuat"}
              </AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={busy} size="lg" className="w-full">
            {busy ? "Memproses…" : register ? "Buat akun" : "Masuk"}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </form>
      )}
    </section>
  );
}
function Testimonials() {
  return (
    <section className="testimonials" aria-labelledby="testimonials-title">
      <div className="section-heading">
        <h2 id="testimonials-title">Analisis yang lebih tenang.</h2>
        <p>
          Contoh testimoni sementara untuk preview desain. Bukan ulasan pengguna
          nyata.
        </p>
      </div>
      <div className="quote-layout">
        <figure className="lead-quote">
          <div
            className="quote-rating"
            aria-label="Contoh rating 5 dari 5 bintang"
          >
            {Array.from({ length: 5 }, (_, i) => (
              <Star key={i} aria-hidden="true" />
            ))}
            <Quote className="quote-mark" aria-hidden="true" />
          </div>
          <blockquote>
            “Saya ingin tahu kenapa sebuah saham masuk daftar. Bukan hanya
            melihat label Buy.”
          </blockquote>
          <figcaption>
            <span className="quote-avatar" aria-hidden="true">
              R
            </span>
            <span>
              Raka <small>Contoh persona · swing trader</small>
            </span>
          </figcaption>
          <div className="quote-context">
            <ChartNoAxesCombined aria-hidden="true" /> Screening yang bisa
            dijelaskan
          </div>
        </figure>
        <figure className="support-quote">
          <div
            className="quote-rating"
            aria-label="Contoh rating 5 dari 5 bintang"
          >
            {Array.from({ length: 5 }, (_, i) => (
              <Star key={i} aria-hidden="true" />
            ))}
            <Quote className="quote-mark" aria-hidden="true" />
          </div>
          <blockquote>
            “Rule yang tersimpan membuat evaluasi saya lebih konsisten dari satu
            minggu ke minggu berikutnya.”
          </blockquote>
          <figcaption>
            <span className="quote-avatar" aria-hidden="true">
              N
            </span>
            <span>
              Nadia <small>Contoh persona · investor mandiri</small>
            </span>
          </figcaption>
          <div className="quote-context">
            <ListFilter aria-hidden="true" /> Rule sebagai dasar evaluasi
          </div>
        </figure>
      </div>
    </section>
  );
}

const questions = [
  {
    question: "Apa yang bisa saya lakukan dengan Signalgen?",
    answer:
      "Susun rule dari indikator teknikal, saring daftar saham IDX, uji ide pada data historis, dan pantau hasil evaluasi beserta kondisi yang terpenuhi. Workspace analisis utamanya berada di aplikasi desktop.",
  },
  {
    question: "Apakah saya harus bisa coding?",
    answer:
      "Tidak. Rule builder membantu Anda menyusun kondisi tanpa menulis kode. Anda tetap perlu memahami arti indikator dan memilih kondisi sesuai tujuan analisis Anda.",
  },
  {
    question: "Apakah akun web dan desktop berbeda?",
    answer:
      "Tidak. Gunakan email dan password yang sama di web dan desktop. Jika pendaftaran meminta konfirmasi email, buka tautan konfirmasinya sebelum masuk.",
  },
  {
    question: "Apakah label Buy berarti saya harus membeli?",
    answer:
      "Label tersebut menunjukkan kondisi rule yang terpenuhi. Signalgen tidak mengeksekusi transaksi; keputusan Anda tetap perlu mempertimbangkan konteks pasar dan risiko strategi.",
  },
  {
    question: "Apakah data pada halaman ini live?",
    answer:
      "Tidak. Screenshot, grafik, dan contoh signal pada landing page bersifat ilustratif. Pembaruan dalam aplikasi desktop mengikuti ketersediaan dan kualitas sumber data pasar.",
  },
  {
    question: "Kapan installer dan paket berlangganan tersedia?",
    answer:
      "Installer Windows/macOS, harga paket, dan pembayaran belum dipublikasikan. Halaman Desktop akan diperbarui saat release resmi tersedia.",
  },
];

function FAQ() {
  const [carousel, setCarousel] = useState<CarouselApi>();
  const [current, setCurrent] = useState(1);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!carousel) return;
    const update = () => setCurrent(carousel.selectedScrollSnap() + 1);
    update();
    carousel.on("select", update);
    return () => {
      carousel.off("select", update);
    };
  }, [carousel]);
  return (
    <section className="faq" aria-labelledby="faq-title">
      <div className="section-heading">
        <h2 id="faq-title">Sebelum Anda mulai.</h2>
        <p>
          Kenali workspace Anda. Geser kartu atau gunakan tombol kiri dan kanan.
        </p>
      </div>
      <Carousel
        setApi={setCarousel}
        opts={{ align: "start", loop: true, duration: reduced ? 0 : 25 }}
        aria-label="Pertanyaan tentang Signalgen"
        className="faq-carousel"
      >
        <CarouselContent>
          {questions.map(({ question, answer }, index) => (
            <CarouselItem
              key={question}
              className="md:basis-1/2"
              aria-label={`Pertanyaan ${index + 1} dari ${questions.length}`}
            >
              <Card className="faq-card h-full">
                <CardHeader>
                  <CircleHelp aria-hidden="true" className="faq-icon" />
                  <CardTitle>
                    <h3>{question}</h3>
                  </CardTitle>
                  <CardDescription>
                    {
                      [
                        "Tentang produk",
                        "Rule builder",
                        "Akun bersama",
                        "Memahami signal",
                        "Data preview",
                        "Ketersediaan desktop",
                      ][index]
                    }
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p>{answer}</p>
                </CardContent>
                <CardFooter>
                  <ShieldCheck aria-hidden="true" />
                  <span>Signalgen Desktop</span>
                </CardFooter>
              </Card>
            </CarouselItem>
          ))}
        </CarouselContent>
        <div className="carousel-controls">
          <span aria-live="polite">
            {current} / {questions.length}
          </span>
          <CarouselPrevious
            aria-label="Pertanyaan sebelumnya"
            className="static size-11"
          />
          <CarouselNext
            aria-label="Pertanyaan berikutnya"
            className="static size-11"
          />
        </div>
      </Carousel>
    </section>
  );
}
function Downloads() {
  return (
    <section className="download">
      <h1>
        Analisis Anda.
        <br />
        Di desktop Anda.
      </h1>
      <p>
        Signalgen Desktop adalah workspace utama untuk rule, screening,
        backtesting, dan realtime signal.
      </p>
      <div className="release">
        <Download size={24} />
        <div>
          <h2>Installer belum dipublikasikan.</h2>
          <p>
            Installer Windows dan macOS akan tersedia di sini setelah release
            resmi diterbitkan.
          </p>
        </div>
      </div>
      <a className="button" href="#home">
        Lihat overview desktop <ArrowRight size={16} />
      </a>
      <p className="release-note">
        Informasi paket dan pembayaran belum tersedia.
      </p>
    </section>
  );
}
