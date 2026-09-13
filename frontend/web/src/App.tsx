import { FormEvent, useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Download,
  Gauge,
  History,
  LineChart,
  ListFilter,
  LockKeyhole,
  LogOut,
  Menu,
  Radio,
  ScanSearch,
  ShieldCheck,
  Target,
  TrendingUp,
  X,
} from "lucide-react";
import { api, ApiError, session } from "./api/client";
import type { ApiStatus, User } from "./types";

type Page = "home" | "auth" | "account";
type AuthMode = "login" | "register";

const marketItems = [
  ["IHSG", "7,842.31", "+1.28%"],
  ["BBCA", "9,425", "+1.34%"],
  ["BMRI", "6,125", "+0.82%"],
  ["TLKM", "3,180", "−0.31%"],
  ["ASII", "5,325", "+0.47%"],
];

function pageFromPath(): Page {
  if (window.location.pathname.startsWith("/auth")) return "auth";
  if (window.location.pathname.startsWith("/account")) return "account";
  return "home";
}

function App() {
  const [page, setPage] = useState<Page>(pageFromPath);
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [backend, setBackend] = useState<ApiStatus | null>(null);
  const [backendError, setBackendError] = useState(false);

  useEffect(() => {
    api.status()
      .then((value) => {
        setBackend(value);
        setBackendError(false);
      })
      .catch(() => setBackendError(true));

    const token = session.getToken();
    if (!token) {
      setCheckingSession(false);
      return;
    }
    api.me()
      .then(setUser)
      .catch(() => session.clear())
      .finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => {
    const onPopState = () => setPage(pageFromPath());
    const onUnauthorized = () => {
      setUser(null);
      navigate("auth");
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("signalgen:unauthorized", onUnauthorized);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("signalgen:unauthorized", onUnauthorized);
    };
  }, []);

  function navigate(next: Page, mode?: AuthMode) {
    const path = next === "home" ? "/" : next === "auth" ? `/auth${mode ? `?mode=${mode}` : ""}` : "/account";
    window.history.pushState({}, "", path);
    setPage(next);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }

  function logout() {
    session.clear();
    setUser(null);
    navigate("home");
  }

  const backendOnline = Boolean(backend) && !backendError;

  if (checkingSession) return <Splash />;
  if (page === "auth") {
    return <AuthPage backendOnline={backendOnline} onBack={() => navigate("home")} onAuthenticated={(nextUser) => { setUser(nextUser); navigate("account"); }} />;
  }
  if (page === "account") {
    if (!user) return <AuthPage backendOnline={backendOnline} onBack={() => navigate("home")} onAuthenticated={(nextUser) => { setUser(nextUser); navigate("account"); }} />;
    return <AccountPage user={user} backendOnline={backendOnline} onHome={() => navigate("home")} onLogout={logout} />;
  }

  return <Landing user={user} backendOnline={backendOnline} onNavigate={navigate} />;
}

function Splash() {
  return (
    <div className="splash" aria-live="polite">
      <Brand />
      <span className="splash__line" />
      <p>Menyiapkan SignalGen…</p>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand ${compact ? "brand--compact" : ""}`}>
      <span className="brand__mark"><TrendingUp aria-hidden="true" /></span>
      <span>SignalGen <b>2.0</b></span>
    </span>
  );
}

function Landing({ user, backendOnline, onNavigate }: { user: User | null; backendOnline: boolean; onNavigate: (page: Page, mode?: AuthMode) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="brand-link" href="#top" aria-label="SignalGen beranda"><Brand compact /></a>
        <nav className={menuOpen ? "is-open" : ""} aria-label="Navigasi utama">
          <a href="#cara-kerja" onClick={() => setMenuOpen(false)}>Cara kerja</a>
          <a href="#fitur" onClick={() => setMenuOpen(false)}>Fitur</a>
          <a href="#akses" onClick={() => setMenuOpen(false)}>Akses</a>
          <div className="mobile-nav-actions">
            {user ? (
              <button onClick={() => onNavigate("account")}><CircleUserRound /> Akun saya</button>
            ) : (
              <><button onClick={() => onNavigate("auth", "login")}>Masuk</button><button className="is-primary" onClick={() => onNavigate("auth", "register")}>Buat akun <ArrowRight /></button></>
            )}
          </div>
        </nav>
        <div className="header-actions">
          {user ? (
            <button className="account-link" onClick={() => onNavigate("account")}><CircleUserRound /> Akun saya</button>
          ) : (
            <>
              <button className="text-button" onClick={() => onNavigate("auth", "login")}>Masuk</button>
              <button className="header-cta" onClick={() => onNavigate("auth", "register")}>Buat akun <ArrowUpRight /></button>
            </>
          )}
        </div>
        <button className="menu-toggle" aria-expanded={menuOpen} aria-label={menuOpen ? "Tutup navigasi" : "Buka navigasi"} onClick={() => setMenuOpen((value) => !value)}>
          {menuOpen ? <X /> : <Menu />}
        </button>
      </header>

      <main id="top">
        <MarketTape backendOnline={backendOnline} />
        <section className="hero section-frame">
          <div className="hero__copy">
            <h1>Temukan signal.<br /><em>Pahami alasannya.</em></h1>
            <p>SignalGen menyatukan rule teknikal, screening saham IDX, dan backtest dalam satu alur yang dapat ditelusuri—sebelum keputusan diambil.</p>
            <div className="mobile-signal-proof" aria-label="Rule EMA dipakai untuk screening BBCA dan menghasilkan signal yang dapat dijelaskan">
              <span><b>RULE</b> EMA 20 &gt; EMA 50</span><i /><span><b>SCREEN</b> BBCA</span><i /><span><b>RESULT</b> Explained</span>
            </div>
            <div className="hero__actions">
              <button className="primary-button" onClick={() => onNavigate(user ? "account" : "auth", user ? undefined : "register")}>Mulai dengan akun yang sama <ArrowRight /></button>
              <a className="secondary-button" href="#cara-kerja">Lihat cara kerja <ChevronRight /></a>
            </div>
            <div className="hero__footnote">
              <ShieldCheck />
              <span><b>Satu identitas untuk web dan desktop.</b> Akun diproses oleh backend SignalGen melalui Supabase Auth.</span>
            </div>
          </div>
          <TerminalPreview />
        </section>

        <section className="proof-strip" aria-label="Kemampuan utama SignalGen">
          <div><ListFilter /><span><b>Rule tanpa kode</b><small>Kondisi yang dapat dibaca ulang</small></span></div>
          <div><ScanSearch /><span><b>Screening IDX</b><small>Saring kandidat secara konsisten</small></span></div>
          <div><History /><span><b>Backtest terukur</b><small>Uji sebelum dipakai</small></span></div>
          <div><Radio /><span><b>Signal realtime</b><small>Ikuti kondisi yang terpenuhi</small></span></div>
        </section>

        <section className="process section-frame" id="cara-kerja">
          <div className="section-intro">
            <h2>Dari hipotesis menjadi signal yang dapat diperiksa.</h2>
            <p>Alur kerja tetap ringkas: tetapkan logika, uji pada data, lalu pantau ketika kondisi benar-benar terpenuhi.</p>
          </div>
          <div className="process-flow">
            <article>
              <span className="process-icon"><ListFilter /></span>
              <div><strong>Susun rule</strong><p>Gabungkan indikator, operator, dan nilai tanpa menulis kode strategi.</p></div>
              <code>EMA(20) cross_up EMA(50)</code>
            </article>
            <span className="process-connector" aria-hidden="true" />
            <article>
              <span className="process-icon"><BarChart3 /></span>
              <div><strong>Validasi konteks</strong><p>Screening dan backtest membantu melihat kapan rule bekerja dan kapan tidak.</p></div>
              <code>volume &gt; SMA(volume, 20)</code>
            </article>
            <span className="process-connector" aria-hidden="true" />
            <article>
              <span className="process-icon"><Radio /></span>
              <div><strong>Pantau signal</strong><p>Setiap hasil membawa alasan, bukan sekadar label BUY atau SELL.</p></div>
              <code>3 dari 3 kondisi terpenuhi</code>
            </article>
          </div>
        </section>

        <section className="feature-story section-frame" id="fitur">
          <div className="feature-story__visual"><StrategyCanvas /></div>
          <div className="feature-story__copy">
            <h2>Satu workspace untuk menjaga analisis tetap utuh.</h2>
            <p>Berpindah dari rule ke hasil screening tanpa kehilangan konteks. SignalGen Desktop dirancang untuk pekerjaan analisis yang panjang, dengan data, status, dan alasan signal berada dalam satu permukaan.</p>
            <ul>
              <li><CheckCircle2 /><span><b>Rule builder yang terbaca</b><small>Kondisi disusun sebagai logika yang dapat diperiksa tim.</small></span></li>
              <li><CheckCircle2 /><span><b>Watchlist dan screening terarah</b><small>Fokus pada universe saham yang memang sedang dipantau.</small></span></li>
              <li><CheckCircle2 /><span><b>Riwayat untuk evaluasi</b><small>Signal dan hasil backtest tidak berhenti sebagai notifikasi sesaat.</small></span></li>
            </ul>
          </div>
        </section>

        <section className="access section-frame" id="akses">
          <div className="access__copy">
            <h2>Akun Anda ikut berpindah. Strategi tetap di tempatnya.</h2>
            <p>Daftar dari website, lalu gunakan email dan password yang sama saat membuka aplikasi desktop. SignalGen memakai satu backend autentikasi untuk kedua aplikasi.</p>
            <button className="primary-button" onClick={() => onNavigate(user ? "account" : "auth", user ? undefined : "register")}>
              {user ? "Buka akun saya" : "Buat akun SignalGen"} <ArrowRight />
            </button>
          </div>
          <div className="access-ledger">
            <div><span>Web account</span><b className="is-ready"><Check /> Tersedia</b></div>
            <div><span>Login desktop</span><b className="is-ready"><Check /> Akun yang sama</b></div>
            <div><span>Pricing dan payment</span><b>Menunggu kontrak backend</b></div>
            <div><span>Desktop distribution</span><b>Dalam pengembangan</b></div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div><Brand compact /><p>Analisis rule-based untuk pasar saham Indonesia.</p></div>
        <p>SignalGen membantu proses analisis dan bukan broker, jaminan profit, atau rekomendasi investasi personal.</p>
        <span>© 2026 SignalGen</span>
      </footer>
    </div>
  );
}

function MarketTape({ backendOnline }: { backendOnline: boolean }) {
  const items = [...marketItems, ...marketItems];
  return (
    <div className="market-tape" aria-label="Contoh snapshot pasar">
      <div className="market-tape__status"><i className={backendOnline ? "is-online" : ""} /> Backend {backendOnline ? "connected" : "offline"}</div>
      <div className="market-tape__viewport">
        <div className="market-tape__track">
          {items.map(([ticker, price, move], index) => <span key={`${ticker}-${index}`} aria-hidden={index >= marketItems.length}><b>{ticker}</b><strong>{price}</strong><em className={move.startsWith("−") ? "is-down" : ""}>{move}</em></span>)}
        </div>
      </div>
      <small>Data ilustratif</small>
    </div>
  );
}

function TerminalPreview() {
  return (
    <div className="terminal-preview" aria-label="Preview workspace SignalGen dengan data ilustratif">
      <div className="terminal-preview__bar"><span><i /><i /><i /></span><b>SCREENING / BBCA</b><em>LIVE RULE · DATA ILUSTRATIF</em></div>
      <div className="terminal-preview__body">
        <div className="terminal-summary">
          <span>Bank Central Asia</span>
          <strong>BBCA</strong>
          <div><b>9,425</b><em>+1.34%</em></div>
        </div>
        <div className="terminal-chart">
          <svg viewBox="0 0 640 260" role="img" aria-label="Grafik harga ilustratif yang bergerak naik">
            <g className="chart-grid"><path d="M0 48H640M0 104H640M0 160H640M0 216H640" /></g>
            <path className="chart-area" d="M0 215 C55 194 79 204 125 181 S194 186 230 148 S303 169 345 126 S410 137 450 98 S518 119 555 70 S606 78 640 38 L640 260 L0 260Z" />
            <path className="chart-path" pathLength="1" d="M0 215 C55 194 79 204 125 181 S194 186 230 148 S303 169 345 126 S410 137 450 98 S518 119 555 70 S606 78 640 38" />
            <circle className="chart-point" cx="640" cy="38" r="5" />
          </svg>
          <span className="chart-tag">EMA momentum confirmed</span>
        </div>
        <div className="rule-scan">
          <div><span><Check /> Trend</span><code>EMA 20 &gt; EMA 50</code></div>
          <div><span><Check /> Momentum</span><code>RSI 58.4</code></div>
          <div><span><Check /> Volume</span><code>1.7× average</code></div>
          <strong><i /> SIGNAL EXPLAINED</strong>
        </div>
      </div>
    </div>
  );
}

function StrategyCanvas() {
  return (
    <div className="strategy-canvas" aria-label="Contoh rule builder SignalGen">
      <div className="strategy-canvas__head"><span>RULE BUILDER</span><b>EMA Momentum</b><em>Active</em></div>
      <div className="logic-row"><span>WHEN</span><b>EMA</b><code>20</code><b>crosses above</b><b>EMA</b><code>50</code></div>
      <div className="logic-join"><i /> AND <i /></div>
      <div className="logic-row"><span>WITH</span><b>Volume</b><b>greater than</b><b>SMA Volume</b><code>20</code></div>
      <div className="strategy-canvas__result"><Gauge /><span><b>Rule tervalidasi</b><small>Siap digunakan untuk screening</small></span><CheckCircle2 /></div>
    </div>
  );
}

function AuthPage({ backendOnline, onBack, onAuthenticated }: { backendOnline: boolean; onBack: () => void; onAuthenticated: (user: User) => void }) {
  const params = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState<AuthMode>(params.get("mode") === "register" ? "register" : "login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setMessage("");
    window.history.replaceState({}, "", `/auth?mode=${nextMode}`);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    setLoading(true);
    setMessage("");
    try {
      if (mode === "register") {
        if (password !== String(data.get("confirmation") ?? "")) throw new ApiError("Konfirmasi password belum sama. Periksa kedua kolom password.", 400);
        const result = await api.register(String(data.get("fullName") ?? "").trim(), email, password);
        if (result.access_token) {
          session.setToken(result.access_token);
          onAuthenticated(result.user);
          return;
        }
        changeMode("login");
        setMessage("Akun berhasil dibuat. Konfirmasi email Anda, lalu masuk dengan akun yang sama di web atau desktop.");
        setIsError(false);
      } else {
        const result = await api.login(email, password);
        session.setToken(result.access_token);
        onAuthenticated(result.user);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Terjadi kesalahan yang tidak dikenal.");
      setIsError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-context">
        <button className="back-button" onClick={onBack}><ArrowLeft /> Kembali ke beranda</button>
        <Brand />
        <div className="auth-context__copy">
          <h1>Satu akun.<br /><em>Dua permukaan kerja.</em></h1>
          <p>Daftar di web dan masuk ke aplikasi desktop dengan identitas yang sama. Strategi, token, dan proses analisis tetap melewati backend SignalGen.</p>
        </div>
        <div className="identity-route" aria-label="Alur identitas SignalGen">
          <span><CircleUserRound /> Web</span><i /><span><LockKeyhole /> Supabase Auth</span><i /><span><LineChart /> Desktop</span>
        </div>
        <div className="backend-state"><i className={backendOnline ? "is-online" : ""} /> Backend {backendOnline ? "terhubung" : "belum terhubung"}</div>
      </section>
      <section className="auth-form-panel">
        <div className="mobile-auth-brand"><Brand compact /><button onClick={onBack}><X /></button></div>
        <div className="auth-box">
          <div className="auth-switch" aria-label="Pilihan autentikasi">
            <button className={mode === "login" ? "active" : ""} onClick={() => changeMode("login")}>Masuk</button>
            <button className={mode === "register" ? "active" : ""} onClick={() => changeMode("register")}>Daftar</button>
          </div>
          <div className="auth-heading">
            <h2>{mode === "login" ? "Lanjutkan analisis Anda." : "Mulai dari satu identitas."}</h2>
            <p>{mode === "login" ? "Gunakan akun SignalGen yang sudah terdaftar di web atau desktop." : "Akun baru ini langsung menjadi akun login untuk aplikasi desktop."}</p>
          </div>
          <form onSubmit={submit} className="auth-form">
            {mode === "register" && <Field label="Nama lengkap" name="fullName" type="text" placeholder="Nama Anda" minLength={2} autoComplete="name" />}
            <Field label="Email" name="email" type="email" placeholder="nama@email.com" autoComplete="email" />
            <Field label="Password" name="password" type="password" placeholder={mode === "register" ? "Minimal 6 karakter" : "Masukkan password"} minLength={mode === "register" ? 6 : 1} autoComplete={mode === "register" ? "new-password" : "current-password"} />
            {mode === "register" && <Field label="Konfirmasi password" name="confirmation" type="password" placeholder="Ulangi password" minLength={6} autoComplete="new-password" />}
            {message && <div role="status" className={`form-message ${isError ? "is-error" : "is-success"}`}>{isError ? <X /> : <Check />}<span>{message}</span></div>}
            <button className="primary-button auth-submit" type="submit" disabled={loading || !backendOnline}>
              {loading ? "Memproses…" : mode === "login" ? "Masuk ke akun" : "Buat akun SignalGen"}<ArrowRight />
            </button>
          </form>
          {!backendOnline && <p className="offline-note">Tombol dinonaktifkan sampai backend SignalGen tersambung.</p>}
          <p className="legal-note">Dengan melanjutkan, Anda memahami bahwa SignalGen adalah alat bantu analisis dan bukan jaminan hasil investasi.</p>
        </div>
      </section>
    </main>
  );
}

function Field({ label, ...props }: { label: string; name: string; type: string; placeholder: string; minLength?: number; autoComplete: string }) {
  return <label className="field"><span>{label}</span><input required {...props} /></label>;
}

function AccountPage({ user, backendOnline, onHome, onLogout }: { user: User; backendOnline: boolean; onHome: () => void; onLogout: () => void }) {
  return (
    <main className="account-page">
      <header className="account-header"><button className="brand-link" onClick={onHome}><Brand compact /></button><button className="logout-button" onClick={onLogout}><LogOut /> Keluar</button></header>
      <section className="account-shell">
        <div className="account-title"><span className="account-avatar">{(user.full_name || user.email).charAt(0).toUpperCase()}</span><div><h1>{user.full_name || "Akun SignalGen"}</h1><p>{user.email}</p></div></div>
        <div className="account-layout">
          <div className="account-main">
            <h2>Akun siap digunakan di desktop.</h2>
            <p>Identitas ini sudah tercatat melalui backend yang sama. Buka SignalGen Desktop, pilih “Masuk”, lalu gunakan email dan password akun ini.</p>
            <div className="desktop-route"><span><CheckCircle2 /> Web account aktif</span><i /><span><Download /> SignalGen Desktop</span><i /><span><LockKeyhole /> Login dengan akun ini</span></div>
          </div>
          <aside className="account-status">
            <div><span>Status backend</span><b className={backendOnline ? "is-online" : ""}><i /> {backendOnline ? "Connected" : "Offline"}</b></div>
            <div><span>Identitas</span><b>Supabase Auth</b></div>
            <div><span>Subscription</span><b>Belum tersedia</b></div>
            <div><span>Desktop build</span><b>Development</b></div>
          </aside>
        </div>
        <div className="account-note"><ShieldCheck /><p><b>Batas keamanan saat ini</b>Autentikasi akun sudah aktif. Isolasi seluruh data strategi per pengguna masih menunggu penyelesaian authorization backend.</p></div>
        <button className="secondary-button account-home" onClick={onHome}><ArrowLeft /> Kembali ke beranda</button>
      </section>
    </main>
  );
}

export default App;
