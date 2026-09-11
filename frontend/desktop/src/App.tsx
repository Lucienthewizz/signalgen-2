import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  ArrowRight,
  BarChart3,
  Bell,
  BookOpen,
  CandlestickChart,
  Check,
  ChevronRight,
  CircleDot,
  Gauge,
  History,
  LayoutDashboard,
  ListFilter,
  LogOut,
  Menu,
  Radio,
  Search,
  Settings,
  ShieldCheck,
  Target,
  TrendingUp,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import { api, ApiError, session } from "./api/client";
import type { ApiStatus, User } from "./types";

type AuthMode = "login" | "register";
type View = "dashboard" | "rules" | "watchlists" | "screening" | "backtest" | "realtime" | "settings";

const navigation: Array<{ id: View; label: string; icon: typeof Gauge; group: string }> = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard, group: "Workspace" },
  { id: "rules", label: "Rule Builder", icon: ListFilter, group: "Workspace" },
  { id: "watchlists", label: "Watchlist", icon: Target, group: "Workspace" },
  { id: "screening", label: "Stock Screening", icon: Search, group: "Analysis" },
  { id: "backtest", label: "Backtesting", icon: History, group: "Analysis" },
  { id: "realtime", label: "Realtime Signal", icon: Radio, group: "Live market" },
  { id: "settings", label: "Settings", icon: Settings, group: "System" },
];

const marketRows = [
  { ticker: "BBCA", name: "Bank Central Asia", price: "9,425", move: "+1.34%", signal: "BUY", tone: "positive" },
  { ticker: "BMRI", name: "Bank Mandiri", price: "6,125", move: "+0.82%", signal: "WATCH", tone: "neutral" },
  { ticker: "TLKM", name: "Telkom Indonesia", price: "3,180", move: "−0.31%", signal: "HOLD", tone: "negative" },
  { ticker: "ASII", name: "Astra International", price: "5,325", move: "+0.47%", signal: "BUY", tone: "positive" },
];

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [preview, setPreview] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [backend, setBackend] = useState<ApiStatus | null>(null);
  const [backendError, setBackendError] = useState(false);

  useEffect(() => {
    api.status().then((value) => {
      setBackend(value);
      setBackendError(false);
    }).catch(() => setBackendError(true));

    const token = session.getToken();
    if (!token) {
      setCheckingSession(false);
      return;
    }
    api.me().then(setUser).catch(() => session.clear()).finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => {
    const reset = () => {
      setUser(null);
      setPreview(false);
    };
    window.addEventListener("signalgen:unauthorized", reset);
    return () => window.removeEventListener("signalgen:unauthorized", reset);
  }, []);

  if (checkingSession) return <Splash />;
  if (!user && !preview) {
    return <AuthScreen backendOnline={Boolean(backend) && !backendError} onAuthenticated={setUser} onPreview={() => setPreview(true)} />;
  }

  return (
    <Workbench
      user={user}
      preview={preview}
      backendOnline={Boolean(backend) && !backendError}
      onExit={() => {
        session.clear();
        setUser(null);
        setPreview(false);
      }}
    />
  );
}

function Splash() {
  return <div className="splash"><Logo /><div className="loader" /><p>Menyiapkan workspace…</p></div>;
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand--compact" : ""}`}>
      <span className="brand__mark"><TrendingUp size={compact ? 18 : 22} /></span>
      <span>SignalGen <b>2.0</b></span>
    </div>
  );
}

function AuthScreen({ backendOnline, onAuthenticated, onPreview }: { backendOnline: boolean; onAuthenticated: (user: User) => void; onPreview: () => void }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    setLoading(true);
    setMessage("");
    try {
      if (mode === "register") {
        const confirmation = String(data.get("confirmation") ?? "");
        if (password !== confirmation) throw new ApiError("Konfirmasi password belum sama.", 400);
        const result = await api.register(String(data.get("fullName") ?? "").trim(), email, password);
        if (result.access_token) {
          session.setToken(result.access_token);
          onAuthenticated(result.user);
          return;
        }
        setMode("login");
        setMessage("Akun dibuat. Konfirmasi email Anda, lalu masuk.");
        setIsError(false);
      } else {
        const result = await api.login(email, password);
        session.setToken(result.access_token);
        onAuthenticated(result.user);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Terjadi kesalahan.");
      setIsError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <Logo />
        <div className="auth-story__content">
          <h1>Pasar bergerak cepat.<br /><em>Keputusan Anda tidak harus.</em></h1>
          <p>Screening, strategi teknikal, dan trading signal dalam satu desktop workspace yang tenang dan terukur.</p>
          <div className="auth-proof">
            <div><ShieldCheck /><span><b>Data terisolasi</b><small>Strategi tetap milik Anda</small></span></div>
            <div><Activity /><span><b>Rule-based signal</b><small>Hasil transparan dan teruji</small></span></div>
          </div>
        </div>
        <footer><span className={`status-dot ${backendOnline ? "is-online" : ""}`} /> Backend {backendOnline ? "terhubung" : "belum terhubung"}</footer>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-card__top">
            <span className="mobile-logo"><Logo compact /></span>
            <div className="auth-switch" aria-label="Pilihan autentikasi">
              <button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setMessage(""); }}>Masuk</button>
              <button className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setMessage(""); }}>Daftar</button>
            </div>
          </div>
          <div className="auth-heading">
            <h2>{mode === "login" ? "Masuk ke SignalGen" : "Buat akun SignalGen"}</h2>
            <p>{mode === "login" ? "Gunakan akun yang sudah terdaftar untuk melanjutkan." : "Satu akun untuk desktop, web, dan seluruh strategi Anda."}</p>
          </div>
          <form className="auth-form" onSubmit={submit}>
            {mode === "register" && <Field label="Nama lengkap" name="fullName" type="text" placeholder="Nama Anda" minLength={2} />}
            <Field label="Email" name="email" type="email" placeholder="nama@email.com" />
            <Field label="Password" name="password" type="password" placeholder="Minimal 6 karakter" minLength={mode === "register" ? 6 : 1} />
            {mode === "register" && <Field label="Konfirmasi password" name="confirmation" type="password" placeholder="Ulangi password" minLength={6} />}
            {message && <div className={`form-message ${isError ? "is-error" : "is-success"}`}>{isError ? <X size={16} /> : <Check size={16} />}{message}</div>}
            <button className="primary-button" disabled={loading || !backendOnline} type="submit">
              {loading ? "Memproses…" : mode === "login" ? "Masuk ke workspace" : "Buat akun"}<ArrowRight size={18} />
            </button>
          </form>
          <button className="preview-button" type="button" onClick={onPreview}>Lihat preview dashboard <ChevronRight size={16} /></button>
          <p className="auth-note">SignalGen membantu analisis rule teknikal dan bukan rekomendasi investasi personal.</p>
        </div>
      </section>
    </main>
  );
}

function Field({ label, ...props }: { label: string; name: string; type: string; placeholder: string; minLength?: number }) {
  return <label className="field"><span>{label}</span><input required {...props} /></label>;
}

function Workbench({ user, preview, backendOnline, onExit }: { user: User | null; preview: boolean; backendOnline: boolean; onExit: () => void }) {
  const [view, setView] = useState<View>("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const grouped = useMemo(() => navigation.reduce<Record<string, typeof navigation>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {}), []);
  const current = navigation.find((item) => item.id === view)!;

  return (
    <main className="workbench">
      <aside className={`sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <div className="sidebar__brand"><Logo compact /><button onClick={() => setSidebarOpen(false)}><X /></button></div>
        <nav>
          {Object.entries(grouped).map(([group, items]) => <div className="nav-group" key={group}><span>{group}</span>{items.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => { setView(item.id); setSidebarOpen(false); }}><Icon size={18} /><span>{item.label}</span>{view === item.id && <i />}</button>;
          })}</div>)}
        </nav>
        <div className="sidebar__footer"><div className="live-card"><span><Zap size={16} /> System status</span><b><i className={backendOnline ? "online" : ""} />{backendOnline ? "Operational" : "Offline"}</b></div><small>SignalGen Desktop · v0.1.0</small></div>
      </aside>
      {sidebarOpen && <button className="backdrop" aria-label="Tutup menu" onClick={() => setSidebarOpen(false)} />}

      <section className="workspace">
        <header className="topbar">
          <div><button className="menu-button" onClick={() => setSidebarOpen(true)}><Menu /></button><div><span className="breadcrumb">SignalGen / {current.label}</span><h1>{current.label}</h1></div></div>
          <div className="topbar__actions"><div className="market-session"><i /> IDX market <b>Open</b></div><button className="icon-button" aria-label="Notifikasi"><Bell size={18} /><i /></button><div className="user-chip"><span>{(user?.full_name || user?.email || "P").charAt(0).toUpperCase()}</span><div><b>{preview ? "Preview Mode" : user?.full_name || "SignalGen User"}</b><small>{preview ? "UI demonstration" : user?.email}</small></div></div><button className="icon-button" aria-label="Keluar" onClick={onExit}><LogOut size={18} /></button></div>
        </header>
        <div className="workspace__content">
          {preview && <div className="preview-banner"><CircleDot size={16} /> Anda melihat data contoh. Masuk dengan akun Supabase untuk memakai data sebenarnya.<button onClick={onExit}>Kembali ke login</button></div>}
          {view === "dashboard" ? <Dashboard backendOnline={backendOnline} onNavigate={setView} /> : <FeaturePlaceholder view={current.label} icon={current.icon} />}
        </div>
      </section>
    </main>
  );
}

function Dashboard({ backendOnline, onNavigate }: { backendOnline: boolean; onNavigate: (view: View) => void }) {
  return <div className="dashboard-shell">
    <div className="market-tape"><span><i /> IDX OPEN</span><b>BBCA <em>+1.34%</em></b><b>BMRI <em>+0.82%</em></b><b>TLKM <em className="down">−0.31%</em></b><b>ASII <em>+0.47%</em></b><small>Snapshot interface</small></div>
    <section className="market-hero">
      <div className="market-hero__copy">
        <h2>Keputusan dimulai dari sinyal yang bisa dijelaskan.</h2>
        <p>Screening pasar, susun rule, dan telusuri alasan di balik setiap signal dalam satu alur kerja yang terukur.</p>
        <div className="hero-actions"><button className="primary-button compact" onClick={() => onNavigate("screening")}><Search size={17} /> Mulai screening <ArrowUpRight size={15} /></button><button className="hero-secondary" onClick={() => onNavigate("rules")}><CandlestickChart size={17} /> Susun strategi</button></div>
      </div>
      <div className="market-hero__chart">
        <div className="index-summary"><span>IDX Composite · contoh</span><strong>7,842.31</strong><small><TrendingUp size={14} /> +1.28% hari ini</small></div>
        <MarketTrace />
      </div>
    </section>
    <section className="metrics-grid">
      <Metric label="Backend" value={backendOnline ? "Connected" : "Offline"} detail="FastAPI · port 3456" icon={ShieldCheck} accent="green" />
      <Metric label="Rule aktif" value="EMA Momentum" detail="4 kondisi · AND" icon={ListFilter} accent="blue" />
      <Metric label="Watchlist" value="12 ticker" detail="IDX Core Picks" icon={Target} accent="amber" />
      <Metric label="Signal hari ini" value="8 signal" detail="5 buy · 3 watch" icon={Activity} accent="violet" />
    </section>
    <section className="dashboard-grid">
      <div className="panel market-panel"><PanelTitle title="Market watch" caption="Snapshot ticker dalam watchlist aktif" action="Buka watchlist" onAction={() => onNavigate("watchlists")} />
        <div className="market-table"><div className="market-table__head"><span>Emiten</span><span>Harga</span><span>Perubahan</span><span>Signal</span></div>{marketRows.map((row) => <div className="market-row" key={row.ticker}><div><b>{row.ticker}</b><small>{row.name}</small></div><strong>{row.price}</strong><span className={row.tone}>{row.move}</span><em className={row.signal.toLowerCase()}>{row.signal}</em></div>)}</div>
      </div>
      <div className="panel signal-panel"><PanelTitle title="Signal overview" caption="Distribusi hasil engine hari ini" /><div className="signal-total"><strong>8</strong><span>signal terdeteksi</span></div><div className="signal-bars"><div><span>Buy <b>5</b></span><i><b style={{ width: "62.5%" }} /></i></div><div><span>Watch <b>2</b></span><i><b style={{ width: "25%" }} /></i></div><div><span>Sell <b>1</b></span><i><b style={{ width: "12.5%" }} /></i></div></div><button className="soft-button" onClick={() => onNavigate("realtime")}>Buka realtime monitor <ArrowRight size={16} /></button></div>
    </section>
    <section className="workflow-panel"><div className="workflow-heading"><h3>Dari ide menjadi signal.</h3><p>Tiga langkah yang menjaga strategi tetap bisa diuji dan dijelaskan.</p></div><div className="workflow-grid"><Workflow icon={ListFilter} title="Susun strategi" text="Bangun rule indikator tanpa menulis kode." onClick={() => onNavigate("rules")} /><Workflow icon={BarChart3} title="Uji historis" text="Evaluasi rule pada candle sebelumnya." onClick={() => onNavigate("backtest")} /><Workflow icon={Radio} title="Monitor realtime" text="Pantau signal saat engine aktif." onClick={() => onNavigate("realtime")} /></div></section>
  </div>;
}

function MarketTrace() {
  return <svg className="market-trace" viewBox="0 0 640 230" role="img" aria-label="Grafik contoh pergerakan IDX Composite">
    <g className="chart-guides"><path d="M0 45H640M0 115H640M0 185H640" /><path d="M96 0V230M272 0V230M448 0V230" /></g>
    <path className="chart-area" d="M0 178 C52 170 74 196 122 157 S196 136 230 151 S304 117 342 127 S408 73 454 98 S518 64 552 76 S602 40 640 51 V230 H0 Z" />
    <path className="chart-line" d="M0 178 C52 170 74 196 122 157 S196 136 230 151 S304 117 342 127 S408 73 454 98 S518 64 552 76 S602 40 640 51" />
    <circle cx="640" cy="51" r="5" />
  </svg>;
}

function Metric({ label, value, detail, icon: Icon, accent }: { label: string; value: string; detail: string; icon: typeof Gauge; accent: string }) {
  return <article className={`metric metric--${accent}`}><span className={`metric__icon ${accent}`}><Icon size={16} /></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}

function PanelTitle({ title, caption, action, onAction }: { title: string; caption: string; action?: string; onAction?: () => void }) {
  return <div className="panel-title"><div><h3>{title}</h3><p>{caption}</p></div>{action && <button onClick={onAction}>{action}<ChevronRight size={15} /></button>}</div>;
}

function Workflow({ icon: Icon, title, text, onClick }: { icon: typeof Gauge; title: string; text: string; onClick: () => void }) {
  return <button className="workflow" onClick={onClick}><span><Icon /></span><div><b>{title}</b><p>{text}</p></div><ArrowUpRight /></button>;
}

function FeaturePlaceholder({ view, icon: Icon }: { view: string; icon: typeof Gauge }) {
  return <section className="feature-placeholder"><span><Icon /></span><h2>{view}</h2><p>Shell, routing, API client, dan auth guard sudah siap. Fitur ini akan dimigrasikan sebagai vertical slice berikutnya menggunakan kontrak OpenAPI backend.</p><div><BookOpen size={17} /> Endpoint tidak akan dibuat berdasarkan asumsi frontend.</div></section>;
}

export default App;
