import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  BookOpenCheck,
  Braces,
  Check,
  ChevronRight,
  CircleAlert,
  Database,
  Gauge,
  KeyRound,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  demoRules,
  demoSessions,
  demoSignals,
  initialTransactions,
  type DemoRule,
  type DemoTransaction,
} from "@/data/demo";

export type DemoView = "overview" | "analysis" | "rules" | "journal" | "access";

type JobState = "idle" | "preparing" | "running" | "completed" | "cancelled";

const viewMeta: Record<DemoView, { title: string; description: string }> = {
  overview: {
    title: "Ringkasan workspace",
    description: "Peta fitur MVP dan status integrasi saat ini.",
  },
  analysis: {
    title: "Jalankan analisis",
    description:
      "Konfigurasikan screening atau backtest dan periksa alasannya.",
  },
  rules: {
    title: "Rule management",
    description: "Kelola rule sistem dan rule privat dalam scope MVP.",
  },
  journal: {
    title: "Jurnal transaksi",
    description: "Catat transaksi dan telaah posisi dari satu alur.",
  },
  access: {
    title: "Akses & perangkat",
    description: "Periksa entitlement, sesi, perangkat, dan cache pengguna.",
  },
};

const navItems: Array<{ view: DemoView; label: string; icon: typeof Gauge }> = [
  { view: "overview", label: "Overview", icon: Gauge },
  { view: "analysis", label: "Analisis", icon: BarChart3 },
  { view: "rules", label: "Rules", icon: Braces },
  { view: "journal", label: "Jurnal", icon: BookOpenCheck },
  { view: "access", label: "Akses", icon: ShieldCheck },
];

function DemoNotice() {
  return (
    <div className="demo-notice" role="note">
      <Database />
      <div>
        <strong>Data demonstrasi aktif</strong>
        <span>
          Semua fitur dapat dijelajahi; perubahan lokal tersimpan selama sesi
          ini.
        </span>
      </div>
      <Badge variant="outline">Data lokal</Badge>
    </div>
  );
}

function OverviewPanel({ go }: { go: (view: DemoView) => void }) {
  const features = [
    [
      "Analisis",
      "Screening, backtest, lifecycle run/cancel, dan hasil explainable.",
      "Siap diuji",
      "analysis",
    ],
    [
      "Rules",
      "Baseline rule serta builder CRUD subset dengan status privat/system.",
      "Siap diuji",
      "rules",
    ],
    [
      "Jurnal",
      "Transaksi manual, draft dari signal, posisi, dan P&L demonstrasi.",
      "Siap diuji",
      "journal",
    ],
    [
      "Akses",
      "Entitlement, sesi/perangkat, revoke, dan clear cache.",
      "Siap diuji",
      "access",
    ],
  ] as const;
  return (
    <>
      <section className="workspace-intro">
        <div>
          <h2>Satu jalur dari rule sampai catatan transaksi.</h2>
          <p>
            Preview ini mencakup seluruh surface P0 dan P1 pada PRD web. Gunakan
            datanya untuk mengecek urutan kerja, istilah, dan kepadatan
            informasi.
          </p>
        </div>
        <div className="scope-readout" aria-label="Status MVP">
          <span>Status workspace</span>
          <strong>Ready</strong>
          <small>Auth asli · fitur analisis demo</small>
        </div>
      </section>
      <section className="feature-ledger">
        {features.map(([name, description, status, view]) => (
          <button key={name} onClick={() => go(view)}>
            <div>
              <strong>{name}</strong>
              <small>{description}</small>
            </div>
            <em>
              <Check /> {status}
            </em>
            <ChevronRight />
          </button>
        ))}
      </section>
      <section className="integration-strip">
        <div>
          <Activity />
          <span>Authorization</span>
          <strong>Endpoint nyata</strong>
        </div>
        <div>
          <Database />
          <span>Dataset</span>
          <strong>Fixture lokal</strong>
        </div>
        <div>
          <Braces />
          <span>Compute engine</span>
          <strong>Simulasi UI</strong>
        </div>
        <div>
          <BookOpenCheck />
          <span>Jurnal API</span>
          <strong>State lokal</strong>
        </div>
      </section>
    </>
  );
}

function AnalysisSkeleton() {
  return (
    <div className="analysis-skeleton" aria-label="Menyiapkan hasil analisis">
      <div className="analysis-skeleton__metrics">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
      <div className="analysis-skeleton__table">
        <Skeleton />
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    </div>
  );
}

function AnalysisPanel({
  onDraft,
  rules,
}: {
  onDraft: (symbol: string) => void;
  rules: DemoRule[];
}) {
  const [job, setJob] = useState<JobState>("idle");
  const [progress, setProgress] = useState(0);
  const timer = useRef<number | null>(null);
  const prepareTimer = useRef<number | null>(null);
  const [config, setConfig] = useState({
    mode: "Screening",
    symbol: "BBCA, TLKM, ASII, BMRI",
    rule: "Momentum confirmation",
    timeframe: "1D",
    period: "1 tahun",
  });

  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current);
      if (prepareTimer.current) window.clearTimeout(prepareTimer.current);
    },
    [],
  );

  function run() {
    if (timer.current) window.clearInterval(timer.current);
    if (prepareTimer.current) window.clearTimeout(prepareTimer.current);
    setJob("preparing");
    setProgress(12);
    prepareTimer.current = window.setTimeout(() => {
      setJob("running");
      timer.current = window.setInterval(() => {
        setProgress((value) => {
          const next = Math.min(value + 18, 100);
          if (next === 100) {
            if (timer.current) window.clearInterval(timer.current);
            setJob("completed");
          }
          return next;
        });
      }, 240);
    }, 350);
  }

  function cancel() {
    if (timer.current) window.clearInterval(timer.current);
    if (prepareTimer.current) window.clearTimeout(prepareTimer.current);
    setJob("cancelled");
  }

  return (
    <div className="analysis-layout">
      <section className="panel configure-panel">
        <div className="panel-heading">
          <div>
            <h3>Konfigurasi</h3>
          </div>
          <Badge variant="outline">Demo</Badge>
        </div>
        <div className="control-grid">
          <label>
            Tujuan
            <select
              value={config.mode}
              onChange={(e) => setConfig({ ...config, mode: e.target.value })}
            >
              <option>Screening</option>
              <option>Backtest</option>
            </select>
          </label>
          <label>
            Timeframe
            <select
              value={config.timeframe}
              onChange={(e) =>
                setConfig({ ...config, timeframe: e.target.value })
              }
            >
              <option>1D</option>
              <option>4H</option>
            </select>
          </label>
          <label className="control-wide">
            Daftar saham
            <Input
              value={config.symbol}
              onChange={(e) => setConfig({ ...config, symbol: e.target.value })}
            />
          </label>
          <label>
            Rule
            <select
              value={config.rule}
              onChange={(e) => setConfig({ ...config, rule: e.target.value })}
            >
              {rules
                .filter((rule) => rule.enabled)
                .map((rule) => (
                  <option key={rule.id}>{rule.name}</option>
                ))}
            </select>
          </label>
          <label>
            Periode
            <select
              value={config.period}
              onChange={(e) => setConfig({ ...config, period: e.target.value })}
            >
              <option>6 bulan</option>
              <option>1 tahun</option>
              <option>3 tahun</option>
            </select>
          </label>
        </div>
        <div className="dataset-readout">
          <Database />
          <div>
            <strong>IDX daily fixture · 4 simbol</strong>
            <span>
              01 Sep 2025—01 Sep 2026 · checksum demo-8f21 · warmup 30 candle
            </span>
          </div>
        </div>
        <div className="run-controls">
          <Button
            className="ui-button ui-button--primary"
            onClick={run}
            disabled={job === "running" || job === "preparing"}
          >
            {job === "completed" ? <RefreshCw /> : <BarChart3 />}
            {job === "completed" ? "Jalankan ulang" : "Jalankan analisis"}
          </Button>
          {(job === "running" || job === "preparing") && (
            <Button className="ui-button" onClick={cancel}>
              <XCircle /> Batalkan
            </Button>
          )}
        </div>
        {job !== "idle" && (
          <div className={`job-status is-${job}`} role="status">
            <div>
              <span>
                {job === "preparing"
                  ? "Menyiapkan dataset"
                  : job === "running"
                    ? "Menjalankan fixture"
                    : job === "completed"
                      ? "Analisis selesai"
                      : "Analisis dibatalkan"}
              </span>
              <strong>
                {job === "cancelled"
                  ? "Konfigurasi tetap tersimpan"
                  : `${progress}%`}
              </strong>
            </div>
            <i
              style={{
                transform: `scaleX(${job === "cancelled" ? 0 : progress / 100})`,
              }}
            />
          </div>
        )}
      </section>
      <section className="panel results-panel">
        <div className="panel-heading">
          <div>
            <h3>Hasil & bukti</h3>
          </div>
          <span className="muted-meta">
            rule{" "}
            {rules.find((rule) => rule.name === config.rule)?.version ??
              "draft"}{" "}
            · synthetic
          </span>
        </div>
        {job === "preparing" || job === "running" ? (
          <AnalysisSkeleton />
        ) : job !== "completed" ? (
          <div className="results-empty">
            <BarChart3 />
            <strong>Hasil akan muncul di sini</strong>
            <p>
              Jalankan konfigurasi untuk melihat summary, alasan match, asumsi,
              dan tabel signal.
            </p>
          </div>
        ) : (
          <div className="results-loaded">
            <div className="result-metrics">
              <div>
                <span>Matches</span>
                <strong>2 / 4</strong>
              </div>
              <div>
                <span>Median score</span>
                <strong>71.0</strong>
              </div>
              <div>
                <span>Data quality</span>
                <strong>Complete</strong>
              </div>
            </div>
            <div className="result-table-wrap">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Close</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Alasan</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {demoSignals.map((signal) => (
                    <TableRow key={signal.symbol}>
                      <TableCell>
                        <strong>{signal.symbol}</strong>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`signal-state is-${signal.state.toLowerCase().replace(" ", "-")}`}
                        >
                          {signal.state}
                        </span>
                      </TableCell>
                      <TableCell>{signal.close}</TableCell>
                      <TableCell>{signal.score}</TableCell>
                      <TableCell>{signal.reason}</TableCell>
                      <TableCell>
                        <button
                          className="table-action"
                          onClick={() => onDraft(signal.symbol)}
                        >
                          Draft jurnal
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="assumption-line">
              <CircleAlert />
              <span>
                <strong>Asumsi:</strong> harga penutupan, tanpa slippage; hasil
                ini fixture UX dan bukan output engine investasi.
              </span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function RulesPanel({
  rules,
  setRules,
}: {
  rules: DemoRule[];
  setRules: Dispatch<SetStateAction<DemoRule[]>>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", logic: "Close > EMA20" });
  function openNew() {
    setDraft({ name: "", logic: "Close > EMA20" });
    setEditingId("new");
  }
  function openEdit(rule: DemoRule) {
    setDraft({ name: rule.name, logic: rule.logic });
    setEditingId(rule.id);
  }
  function saveRule(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.logic.trim()) return;
    if (editingId === "new") {
      setRules([
        ...rules,
        {
          id: crypto.randomUUID(),
          name: draft.name,
          logic: draft.logic,
          version: "draft 01",
          scope: "Milik Anda",
          enabled: true,
        },
      ]);
    } else {
      setRules(
        rules.map((rule) =>
          rule.id === editingId
            ? { ...rule, name: draft.name, logic: draft.logic }
            : rule,
        ),
      );
    }
    setDraft({ name: "", logic: "Close > EMA20" });
    setEditingId(null);
  }
  return (
    <div className="two-column-page">
      <section className="panel rule-list">
        <div className="panel-heading">
          <div>
            <span>RULE SET</span>
            <h3>{rules.length} rule tersedia</h3>
          </div>
          <Button className="ui-button ui-button--primary" onClick={openNew}>
            <Plus /> Rule baru
          </Button>
        </div>
        {rules.map((rule) => (
          <article key={rule.id}>
            <div className="rule-toggle">
              <Switch
                checked={rule.enabled}
                onCheckedChange={(checked) =>
                  setRules(
                    rules.map((item) =>
                      item.id === rule.id
                        ? { ...item, enabled: checked }
                        : item,
                    ),
                  )
                }
                aria-label={`Aktifkan ${rule.name}`}
              />
            </div>
            <div>
              <div className="rule-title">
                <strong>{rule.name}</strong>
                <Badge variant="outline">{rule.scope}</Badge>
              </div>
              <p>{rule.logic}</p>
              <small>
                {rule.version} ·{" "}
                {rule.scope === "System" ? "read-only" : "editable"}
              </small>
            </div>
            {rule.scope === "Milik Anda" && (
              <div className="rule-actions">
                <button
                  className="icon-action"
                  onClick={() => openEdit(rule)}
                  aria-label={`Edit ${rule.name}`}
                >
                  <Pencil />
                </button>
                <button
                  className="icon-action"
                  onClick={() =>
                    setRules(rules.filter((item) => item.id !== rule.id))
                  }
                  aria-label={`Hapus ${rule.name}`}
                >
                  <Trash2 />
                </button>
              </div>
            )}
          </article>
        ))}
      </section>
      <aside className="panel side-explainer">
        {editingId ? (
          <form onSubmit={saveRule}>
            <div className="panel-heading">
              <div>
                <span>BUILDER</span>
                <h3>
                  {editingId === "new"
                    ? "Rule privat baru"
                    : "Edit rule privat"}
                </h3>
              </div>
              <button
                type="button"
                className="icon-action"
                onClick={() => setEditingId(null)}
                aria-label="Tutup builder rule"
              >
                <X />
              </button>
            </div>
            <label>
              Nama rule
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Contoh: Trend pullback"
                required
              />
            </label>
            <label>
              Logika
              <Textarea
                value={draft.logic}
                onChange={(e) => setDraft({ ...draft, logic: e.target.value })}
              />
            </label>
            <p className="form-help">
              Builder MVP menyimpan kondisi sebagai draft lokal. Validasi
              operator akan mengikuti kontrak engine.
            </p>
            <Button className="ui-button ui-button--primary" type="submit">
              <Save />{" "}
              {editingId === "new" ? "Simpan rule" : "Simpan perubahan"}
            </Button>
          </form>
        ) : (
          <>
            <Braces />
            <h3>Rule tetap bisa diperiksa.</h3>
            <p>
              System rule diberi versi dan bersifat read-only. Rule milik Anda
              dapat diaktifkan, dibuat, diedit, atau dihapus di preview ini.
            </p>
            <button className="text-link" onClick={openNew}>
              Buka builder <ChevronRight />
            </button>
          </>
        )}
      </aside>
    </div>
  );
}

function JournalPanel({
  draftSymbol,
  clearDraft,
  transactions,
  setTransactions,
}: {
  draftSymbol: string | null;
  clearDraft: () => void;
  transactions: DemoTransaction[];
  setTransactions: Dispatch<SetStateAction<DemoTransaction[]>>;
}) {
  const [form, setForm] = useState({
    symbol: draftSymbol ?? "BBCA",
    side: "BUY" as "BUY" | "SELL",
    quantity: "10",
    price: "9675",
    fee: "145",
    date: "2026-09-16",
  });
  useEffect(() => {
    if (draftSymbol)
      setForm((current) => ({ ...current, symbol: draftSymbol }));
  }, [draftSymbol]);
  const invested = useMemo(
    () =>
      transactions.reduce(
        (sum, tx) =>
          sum +
          (tx.side === "BUY"
            ? tx.quantity * 100 * tx.price + tx.fee
            : -(tx.quantity * 100 * tx.price - tx.fee)),
        0,
      ),
    [transactions],
  );
  function addTransaction(event: FormEvent) {
    event.preventDefault();
    setTransactions([
      {
        id: crypto.randomUUID(),
        symbol: form.symbol.toUpperCase(),
        side: form.side,
        quantity: Number(form.quantity),
        price: Number(form.price),
        fee: Number(form.fee),
        date: form.date,
      },
      ...transactions,
    ]);
    clearDraft();
  }
  return (
    <div className="journal-layout">
      <section className="panel journal-form">
        <div className="panel-heading">
          <div>
            <span>INPUT</span>
            <h3>Transaksi manual</h3>
          </div>
          {draftSymbol && <Badge variant="outline">Draft dari analisis</Badge>}
        </div>
        <form onSubmit={addTransaction} className="control-grid">
          <label>
            Symbol
            <Input
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value })}
              required
            />
          </label>
          <label>
            Sisi
            <select
              value={form.side}
              onChange={(e) =>
                setForm({ ...form, side: e.target.value as "BUY" | "SELL" })
              }
            >
              <option>BUY</option>
              <option>SELL</option>
            </select>
          </label>
          <label>
            Lot
            <Input
              type="number"
              min="1"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              required
            />
          </label>
          <label>
            Harga
            <Input
              type="number"
              min="1"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              required
            />
          </label>
          <label>
            Fee
            <Input
              type="number"
              min="0"
              value={form.fee}
              onChange={(e) => setForm({ ...form, fee: e.target.value })}
            />
          </label>
          <label>
            Tanggal
            <Input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </label>
          <Button
            className="ui-button ui-button--primary control-wide"
            type="submit"
          >
            <Save /> Simpan transaksi lokal
          </Button>
        </form>
      </section>
      <section className="panel journal-book">
        <div className="journal-summary">
          <div>
            <span>Modal tercatat</span>
            <strong>Rp {invested.toLocaleString("id-ID")}</strong>
          </div>
          <div>
            <span>Valuasi contoh</span>
            <strong>Rp 16.825.000</strong>
          </div>
          <div>
            <span>P&amp;L belum direalisasi</span>
            <strong className="positive">+Rp 1.137.400</strong>
          </div>
        </div>
        <div className="panel-heading">
          <div>
            <span>LEDGER</span>
            <h3>Riwayat transaksi</h3>
          </div>
          <small className="muted-meta">Harga contoh · 16 Sep 2026</small>
        </div>
        <div className="transaction-list">
          {transactions.map((tx) => (
            <article key={tx.id}>
              <span className={`side-marker is-${tx.side.toLowerCase()}`}>
                {tx.side}
              </span>
              <div>
                <strong>{tx.symbol}</strong>
                <small>
                  {tx.date} · {tx.quantity} lot × Rp{" "}
                  {tx.price.toLocaleString("id-ID")}
                </small>
              </div>
              <b>Rp {(tx.quantity * 100 * tx.price).toLocaleString("id-ID")}</b>
              <button
                className="icon-action"
                onClick={() =>
                  setTransactions(
                    transactions.filter((item) => item.id !== tx.id),
                  )
                }
                aria-label={`Hapus transaksi ${tx.symbol}`}
              >
                <Trash2 />
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function AccessPanel({
  backendOnline,
  sessions,
  setSessions,
  cacheState,
  setCacheState,
}: {
  backendOnline: boolean;
  sessions: typeof demoSessions;
  setSessions: Dispatch<SetStateAction<typeof demoSessions>>;
  cacheState: string;
  setCacheState: Dispatch<SetStateAction<string>>;
}) {
  return (
    <div className="access-grid">
      <section className="panel entitlement-panel">
        <div className="panel-heading">
          <div>
            <span>ENTITLEMENT</span>
            <h3>Research access</h3>
          </div>
          <Badge variant="outline">Demo tier</Badge>
        </div>
        <div className="entitlement-row">
          <span>Screening</span>
          <strong>
            <Check /> Diizinkan
          </strong>
        </div>
        <div className="entitlement-row">
          <span>Backtest 3 tahun</span>
          <strong>
            <Check /> Diizinkan
          </strong>
        </div>
        <div className="entitlement-row">
          <span>Realtime feed</span>
          <em>
            <X /> Di luar MVP
          </em>
        </div>
        <div className="auth-contract">
          <KeyRound />
          <div>
            <strong>Backend API</strong>
            <span>
              {backendOnline
                ? "Base API terjangkau; kontrak login memakai /api/auth"
                : "Base API belum terjangkau; login akan menampilkan error nyata"}
            </span>
          </div>
        </div>
      </section>
      <section className="panel sessions-panel">
        <div className="panel-heading">
          <div>
            <span>SESSIONS</span>
            <h3>Perangkat aktif</h3>
          </div>
          <span className="muted-meta">{sessions.length} perangkat</span>
        </div>
        {sessions.map((session) => (
          <article key={session.id}>
            <div className="device-icon">
              <Activity />
            </div>
            <div>
              <strong>
                {session.device}
                {session.current && <Badge variant="outline">Saat ini</Badge>}
              </strong>
              <span>
                {session.place} · {session.active}
              </span>
            </div>
            {!session.current && (
              <button
                className="table-action"
                onClick={() =>
                  setSessions(sessions.filter((item) => item.id !== session.id))
                }
              >
                Revoke
              </button>
            )}
          </article>
        ))}
      </section>
      <section className="panel cache-panel">
        <div>
          <Database />
          <span>
            <strong>Cache pengguna</strong>
            <small>{cacheState}</small>
          </span>
        </div>
        <Button
          className="ui-button"
          onClick={() => setCacheState("Kosong · dibersihkan barusan")}
        >
          <Trash2 /> Bersihkan cache
        </Button>
      </section>
    </div>
  );
}

export function DemoWorkspace({
  view,
  backendOnline,
}: {
  view: DemoView;
  backendOnline: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [draftSymbol, setDraftSymbol] = useState<string | null>(null);
  const [rules, setRules] = useState<DemoRule[]>(demoRules);
  const [transactions, setTransactions] =
    useState<DemoTransaction[]>(initialTransactions);
  const [sessions, setSessions] = useState(demoSessions);
  const [cacheState, setCacheState] = useState(
    "14,8 MB · terenkripsi (contoh)",
  );
  const meta = viewMeta[view];
  function go(next: DemoView) {
    location.hash = `app/${next}`;
    setMenuOpen(false);
  }
  function draft(symbol: string) {
    setDraftSymbol(symbol);
    go("journal");
  }
  return (
    <main className="workbench demo-workbench">
      <aside className={`sidebar ${menuOpen ? "is-open" : ""}`}>
        <div className="sidebar__brand">
          <a href="#home">
            <Brand compact />
          </a>
          <button onClick={() => setMenuOpen(false)} aria-label="Tutup menu">
            <X />
          </button>
        </div>
        <div className="surface-label">
          <span>Demo workspace</span>
          <i className="status-dot is-online" />
        </div>
        <nav aria-label="Navigasi demo">
          {" "}
          <div className="nav-group">
            <span>MVP SURFACES</span>
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.view}
                  className={view === item.view ? "active" : ""}
                  onClick={() => go(item.view)}
                >
                  {view === item.view && <i />}
                  <Icon /> {item.label}
                </button>
              );
            })}
          </div>
          <div className="nav-group">
            <span>ACCOUNT</span>
            <a href="#account">
              <KeyRound /> Akun asli
            </a>
          </div>
        </nav>
        <div className="sidebar__footer">
          <a className="back-home" href="#home">
            <ArrowLeft /> Kembali ke landing
          </a>
          <small>Signalgen web · local UX fixture</small>
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
              aria-label="Buka menu demo"
            >
              <Menu />
            </button>
            <div>
              <span className="breadcrumb">Signalgen / Demo / {view}</span>
              <h1>{meta.title}</h1>
            </div>
          </div>
          <div className="topbar__actions">
            <span className="preview-chip">Data statik</span>
            <a className="ui-button" href="#login">
              Masuk
            </a>
          </div>
        </header>
        <div className="workspace__content demo-content">
          <DemoNotice />
          <div className="page-heading">
            <div>
              <h2>{meta.title}</h2>
              <p>{meta.description}</p>
            </div>
            <span>Last reset · reload halaman</span>
          </div>
          <div className="route-stage" key={view}>
            {view === "overview" && <OverviewPanel go={go} />}
            {view === "analysis" && (
              <AnalysisPanel onDraft={draft} rules={rules} />
            )}
            {view === "rules" && (
              <RulesPanel rules={rules} setRules={setRules} />
            )}
            {view === "journal" && (
              <JournalPanel
                draftSymbol={draftSymbol}
                clearDraft={() => setDraftSymbol(null)}
                transactions={transactions}
                setTransactions={setTransactions}
              />
            )}
            {view === "access" && (
              <AccessPanel
                backendOnline={backendOnline}
                sessions={sessions}
                setSessions={setSessions}
                cacheState={cacheState}
                setCacheState={setCacheState}
              />
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
