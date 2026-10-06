import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowRight, ArrowUpRight, BarChart3, Bell, BookOpen,
  CandlestickChart, Check, ChevronRight, CircleDot, Command, Gauge,
  History, LayoutDashboard, ListFilter, LogOut, Menu, Radio, Search,
  Settings, ShieldCheck, Target, TrendingUp, UserRound, X, Zap,
} from "lucide-react";
import { AdminDashboard, adminNavigation, type AdminView } from "./admin/AdminDashboard";
import { api, ApiError, session } from "./api/client";
import { Badge, Button } from "./components/ui";
import type { ApiStatus, User } from "./types";

type AuthMode = "login" | "register";
type Surface = "user" | "admin";
type UserView = "dashboard" | "rules" | "watchlists" | "screening" | "backtest" | "realtime" | "settings";
type View = UserView | AdminView;

const userNavigation: Array<{ id: UserView; label: string; icon: typeof Gauge; group: string }> = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard, group: "Workspace" },
  { id: "rules", label: "Rule builder", icon: ListFilter, group: "Workspace" },
  { id: "watchlists", label: "Watchlist", icon: Target, group: "Workspace" },
  { id: "screening", label: "Stock screening", icon: Search, group: "Analysis" },
  { id: "backtest", label: "Backtesting", icon: History, group: "Analysis" },
  { id: "realtime", label: "Realtime signal", icon: Radio, group: "Live market" },
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
  const [previewMode, setPreviewMode] = useState<Surface | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [backend, setBackend] = useState<ApiStatus | null>(null);
  const [backendError, setBackendError] = useState(false);

  useEffect(() => {
    api.status().then((value) => { setBackend(value); setBackendError(false); }).catch(() => setBackendError(true));
    const token = session.getToken();
    if (!token) { setCheckingSession(false); return; }
    api.me().then(setUser).catch(() => session.clear()).finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => {
    const reset = () => { setUser(null); setPreviewMode(null); };
    window.addEventListener("signalgen:unauthorized", reset);
    return () => window.removeEventListener("signalgen:unauthorized", reset);
  }, []);

  if (checkingSession) return <Splash />;
  if (!user && !previewMode) return <AuthScreen backendOnline={Boolean(backend) && !backendError} onAuthenticated={setUser} onPreview={setPreviewMode} />;
  return <Workbench user={user} previewMode={previewMode} backendOnline={Boolean(backend) && !backendError} onExit={() => { session.clear(); setUser(null); setPreviewMode(null); }} />;
}

function Splash() {
  return <div className="splash"><Logo /><div className="loader" /><p>Preparing secure workspace…</p></div>;
}

function Logo({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? "brand--compact" : ""}`}><span className="brand__mark"><TrendingUp size={compact ? 17 : 21} /></span><span>SignalGen <b>2.0</b></span></div>;
}

function AuthScreen({ backendOnline, onAuthenticated, onPreview }: { backendOnline: boolean; onAuthenticated: (user: User) => void; onPreview: (surface: Surface) => void }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    setLoading(true); setMessage("");
    try {
      if (mode === "register") {
        const confirmation = String(data.get("confirmation") ?? "");
        if (password !== confirmation) throw new ApiError("Konfirmasi password belum sama.", 400);
        const result = await api.register(String(data.get("fullName") ?? "").trim(), email, password);
        if (result.access_token) { session.setToken(result.access_token); onAuthenticated(result.user); return; }
        setMode("login"); setMessage("Akun dibuat. Konfirmasi email Anda, lalu masuk."); setIsError(false);
      } else {
        const result = await api.login(email, password);
        session.setToken(result.access_token); onAuthenticated(result.user);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Terjadi kesalahan."); setIsError(true);
    } finally { setLoading(false); }
  }

  return <main className="auth-layout">
    <section className="auth-story">
      <Logo />
      <div className="auth-story__content"><h1>Read the market.<br /><span>Verify the signal.</span></h1><p>Workspace desktop untuk menyusun rule, menguji hipotesis, dan memahami alasan di balik setiap signal IDX.</p><div className="auth-proof"><div><ShieldCheck /><span><b>Private by account</b><small>Strategi tidak bercampur antar-user</small></span></div><div><Activity /><span><b>Explainable state</b><small>Setiap signal membawa konteks rule</small></span></div></div></div>
      <footer><span className={`status-dot ${backendOnline ? "is-online" : ""}`} /> Backend {backendOnline ? "verified" : "not connected"}</footer>
    </section>
    <section className="auth-panel"><div className="auth-card">
      <div className="auth-card__top"><span className="mobile-logo"><Logo compact /></span><div className="auth-switch" aria-label="Pilihan autentikasi"><button className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setMessage(""); }}>Masuk</button><button className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setMessage(""); }}>Daftar</button></div></div>
      <div className="auth-heading"><h2>{mode === "login" ? "Continue to SignalGen" : "Create your account"}</h2><p>{mode === "login" ? "Gunakan identitas yang sama untuk web dan desktop." : "Satu akun untuk portal web dan seluruh workspace desktop."}</p></div>
      <form className="auth-form" onSubmit={submit}>{mode === "register" && <Field label="Nama lengkap" name="fullName" type="text" placeholder="Nama Anda" minLength={2} />}<Field label="Email" name="email" type="email" placeholder="nama@email.com" /><Field label="Password" name="password" type="password" placeholder="Minimal 6 karakter" minLength={mode === "register" ? 6 : 1} />{mode === "register" && <Field label="Konfirmasi password" name="confirmation" type="password" placeholder="Ulangi password" minLength={6} />}{message && <div className={`form-message ${isError ? "is-error" : "is-success"}`}>{isError ? <X size={16} /> : <Check size={16} />}{message}</div>}<Button variant="primary" className="auth-submit" disabled={loading || !backendOnline} type="submit">{loading ? "Memproses…" : mode === "login" ? "Masuk ke workspace" : "Buat akun"}<ArrowRight size={17} /></Button></form>
      <div className="preview-options"><button onClick={() => onPreview("user")}><LayoutDashboard size={15} /> Preview user workspace</button><button onClick={() => onPreview("admin")}><ShieldCheck size={15} /> Preview admin control</button></div>
      <p className="auth-note">Preview memakai data ilustratif. SignalGen adalah alat analisis, bukan rekomendasi investasi personal.</p>
    </div></section>
  </main>;
}

function Field({ label, ...props }: { label: string; name: string; type: string; placeholder: string; minLength?: number }) {
  return <label className="field"><span>{label}</span><input required {...props} /></label>;
}

function Workbench({ user, previewMode, backendOnline, onExit }: { user: User | null; previewMode: Surface | null; backendOnline: boolean; onExit: () => void }) {
  const initialSurface: Surface = previewMode ?? (user?.role === "admin" ? "admin" : "user");
  const [surface, setSurface] = useState<Surface>(initialSurface);
  const [view, setView] = useState<View>(initialSurface === "admin" ? "admin-overview" : "dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const canAdmin = previewMode !== null || user?.role === "admin";
  const navigation: Array<{ id: View; label: string; icon: typeof Gauge; group: string }> = surface === "admin" ? adminNavigation : userNavigation;
  const grouped = useMemo(() => navigation.reduce<Record<string, typeof navigation>>((acc, item) => { (acc[item.group] ??= []).push(item); return acc; }, {}), [navigation]);
  const current = navigation.find((item) => item.id === view) ?? navigation[0];
  const changeSurface = (next: Surface) => { if (next === "admin" && !canAdmin) return; setSurface(next); setView(next === "admin" ? "admin-overview" : "dashboard"); };

  return <main className={`workbench workbench--${surface}`}>
    <aside className={`sidebar ${sidebarOpen ? "is-open" : ""}`}><div className="sidebar__brand"><Logo compact /><button onClick={() => setSidebarOpen(false)} aria-label="Tutup menu"><X /></button></div><div className="surface-label"><span>{surface === "admin" ? "Admin control" : "Market workspace"}</span>{surface === "admin" && <Badge tone="success">Restricted</Badge>}</div><nav>{Object.entries(grouped).map(([group, items]) => <div className="nav-group" key={group}><span>{group}</span>{items.map((item) => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => { setView(item.id); setSidebarOpen(false); }}><Icon size={17} /><span>{item.label}</span>{view === item.id && <i />}</button>; })}</div>)}</nav><div className="sidebar__footer"><div className="live-card"><span><Zap size={15} /> Core system</span><b><i className={backendOnline ? "online" : ""} />{backendOnline ? "Operational" : "Offline"}</b></div><small>SignalGen Desktop · v0.1.0</small></div></aside>
    {sidebarOpen && <button className="backdrop" aria-label="Tutup menu" onClick={() => setSidebarOpen(false)} />}
    <section className="workspace">
      <header className="topbar">
        <div className="topbar__title"><button className="menu-button" onClick={() => setSidebarOpen(true)} aria-label="Buka menu"><Menu /></button><div><span className="breadcrumb">SignalGen / {surface === "admin" ? "Admin" : "Workspace"}</span><h1>{current.label}</h1></div></div>
        <div className="topbar__actions">
          {canAdmin && <div className="surface-switch" role="group" aria-label="Switch workspace"><button className={surface === "user" ? "active" : ""} onClick={() => changeSurface("user")}><UserRound size={14} /> User</button><button className={surface === "admin" ? "active" : ""} onClick={() => changeSurface("admin")}><ShieldCheck size={14} /> Admin</button></div>}
          <button className="command-button" disabled><Command size={14} /><span>Quick search</span><kbd>⌘ K</kbd></button>
          <button className="icon-button" aria-label="Notifikasi" disabled><Bell size={17} /><i /></button>
          <div className="user-chip"><span>{(user?.full_name || user?.email || (surface === "admin" ? "A" : "P")).charAt(0).toUpperCase()}</span><div><b>{previewMode ? (surface === "admin" ? "Admin Preview" : "User Preview") : user?.full_name || "SignalGen User"}</b><small>{previewMode ? "Illustrative interface" : user?.email}</small></div></div>
          <button className="icon-button" aria-label="Keluar" onClick={onExit}><LogOut size={17} /></button>
        </div>
      </header>
      <div className={`workspace__content ${surface === "admin" ? "workspace__content--admin" : ""}`}>
        {(previewMode || surface === "admin") && <div className="preview-banner"><CircleDot size={15} /><span><b>{surface === "admin" ? "Admin interface preview." : "Preview mode."}</b> {surface === "admin" ? "Admin endpoints are not connected; totals, identities, and component checks are illustrative." : "Data di layar ini bersifat ilustratif sampai kontrak backend tersedia."}</span>{previewMode && <button onClick={onExit}>Exit preview</button>}</div>}
        {surface === "admin" ? <AdminDashboard view={view as AdminView} onNavigate={(next) => setView(next)} backendOnline={backendOnline} /> : view === "dashboard" ? <UserDashboard backendOnline={backendOnline} onNavigate={(next) => setView(next)} /> : <FeaturePlaceholder view={current.label} icon={current.icon} />}
      </div>
    </section>
  </main>;
}

function UserDashboard({ backendOnline, onNavigate }: { backendOnline: boolean; onNavigate: (view: UserView) => void }) {
  return <div className="dashboard-shell"><div className="market-tape"><span><i /> IDX OPEN</span><b>BBCA <em>+1.34%</em></b><b>BMRI <em>+0.82%</em></b><b>TLKM <em className="down">−0.31%</em></b><b>ASII <em>+0.47%</em></b><small>Illustrative snapshot</small></div><section className="market-hero"><div className="market-hero__copy"><h2>Every signal should explain itself.</h2><p>Screen the market, compose indicator rules, and trace the conditions behind each result in one measured workflow.</p><div className="hero-actions"><Button variant="primary" onClick={() => onNavigate("screening")}><Search size={16} /> Start screening <ArrowUpRight size={15} /></Button><Button onClick={() => onNavigate("rules")}><CandlestickChart size={16} /> Build a rule</Button></div></div><div className="market-hero__chart"><div className="index-summary"><span>IDX Composite · example</span><strong>7,842.31</strong><small><TrendingUp size={14} /> +1.28% today</small></div><MarketTrace /></div></section><section className="user-ledger"><UserMetric label="Backend" value={backendOnline ? "Verified" : "Offline"} detail="FastAPI · :3456" icon={ShieldCheck} live={backendOnline} /><UserMetric label="Active rule" value="EMA Momentum" detail="4 conditions · AND" icon={ListFilter} /><UserMetric label="Watchlist" value="12 tickers" detail="IDX Core Picks" icon={Target} /><UserMetric label="Signals today" value="8 signals" detail="5 buy · 3 watch" icon={Activity} /></section><section className="dashboard-grid"><div className="ledger-panel market-panel"><PanelTitle title="Market watch" caption="Active watchlist snapshot" action="Open watchlist" onAction={() => onNavigate("watchlists")} /><div className="market-table"><div className="market-table__head"><span>Issuer</span><span>Price</span><span>Move</span><span>Signal</span></div>{marketRows.map((row) => <div className="market-row" key={row.ticker}><div><b>{row.ticker}</b><small>{row.name}</small></div><strong>{row.price}</strong><span className={row.tone}>{row.move}</span><em className={row.signal.toLowerCase()}>{row.signal}</em></div>)}</div></div><div className="ledger-panel signal-panel"><PanelTitle title="Signal distribution" caption="Illustrative engine result" /><div className="signal-total"><strong>8</strong><span>signals detected</span></div><div className="signal-bars"><div><span>Buy <b>5</b></span><i><b style={{ width: "62.5%" }} /></i></div><div><span>Watch <b>2</b></span><i><b style={{ width: "25%" }} /></i></div><div><span>Hold <b>1</b></span><i><b style={{ width: "12.5%" }} /></i></div></div><Button className="panel-action" onClick={() => onNavigate("realtime")}>Open realtime monitor <ArrowRight size={15} /></Button></div></section><section className="workflow-panel"><div className="workflow-heading"><h3>From thesis to traceable signal.</h3><p>One operating loop keeps every market hypothesis testable and explainable.</p></div><div className="workflow-grid"><Workflow icon={ListFilter} title="Compose" text="Build readable indicator conditions." onClick={() => onNavigate("rules")} /><Workflow icon={BarChart3} title="Validate" text="Test the rule against historical candles." onClick={() => onNavigate("backtest")} /><Workflow icon={Radio} title="Monitor" text="Observe qualified signals in realtime." onClick={() => onNavigate("realtime")} /></div></section></div>;
}

function MarketTrace() {
  return <svg className="market-trace" viewBox="0 0 640 230" role="img" aria-label="Illustrative IDX Composite movement"><defs><linearGradient id="market-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#45e69f" stopOpacity=".25" /><stop offset="1" stopColor="#45e69f" stopOpacity="0" /></linearGradient><linearGradient id="market-line" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#168f5a" /><stop offset="1" stopColor="#7af5bd" /></linearGradient></defs><g className="chart-guides"><path d="M0 45H640M0 115H640M0 185H640" /><path d="M96 0V230M272 0V230M448 0V230" /></g><path className="chart-area" d="M0 178 C52 170 74 196 122 157 S196 136 230 151 S304 117 342 127 S408 73 454 98 S518 64 552 76 S602 40 640 51 V230 H0 Z" /><path className="chart-line" d="M0 178 C52 170 74 196 122 157 S196 136 230 151 S304 117 342 127 S408 73 454 98 S518 64 552 76 S602 40 640 51" /><circle cx="640" cy="51" r="5" /></svg>;
}

function UserMetric({ label, value, detail, icon: Icon, live = false }: { label: string; value: string; detail: string; icon: typeof Gauge; live?: boolean }) {
  return <article className="user-metric"><span className={live ? "is-live" : ""}><Icon size={15} /></span><div><small>{label}</small><strong>{value}</strong><p>{detail}</p></div></article>;
}

function PanelTitle({ title, caption, action, onAction }: { title: string; caption: string; action?: string; onAction?: () => void }) {
  return <div className="panel-title"><div><h3>{title}</h3><p>{caption}</p></div>{action && <Button variant="ghost" size="sm" onClick={onAction}>{action}<ChevronRight size={14} /></Button>}</div>;
}

function Workflow({ icon: Icon, title, text, onClick }: { icon: typeof Gauge; title: string; text: string; onClick: () => void }) {
  return <button className="workflow" onClick={onClick}><span><Icon /></span><div><b>{title}</b><p>{text}</p></div><ArrowUpRight /></button>;
}

function FeaturePlaceholder({ view, icon: Icon }: { view: string; icon: typeof Gauge }) {
  return <section className="feature-placeholder"><span><Icon /></span><h2>{view}</h2><p>Shell, authentication, navigation, and the shared desktop design system are ready. This feature will connect only after its backend contract is verified.</p><div><BookOpen size={16} /> No endpoint is invented by the frontend.</div></section>;
}

export default App;
