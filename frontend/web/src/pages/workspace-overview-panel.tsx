import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  BadgeCheck,
  Boxes,
  Clock3,
  ListChecks,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  Activity,
  Newspaper,
} from "lucide-react";
import { api } from "@/api/client";
import { monitorRuns, type MonitorRun } from "@/lib/market-monitor";
import {
  readScreenerPreferences,
  saveScreenerPreferences,
} from "@/lib/screener-preferences";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import type {
  AccountState,
  RuleResource,
  StockUniverse,
  Subscription,
} from "@/types";

type Props = {
  authenticated: boolean;
  backendOnline: boolean;
  userId?: string;
  go: (
    view:
      | "analysis"
      | "rules"
      | "universes"
      | "access"
      | "subscription"
      | "realtime"
      | "news",
  ) => void;
};

export function WorkspaceOverviewPanel({
  authenticated,
  backendOnline,
  userId,
  go,
}: Props) {
  const [account, setAccount] = useState<AccountState | null>(null);
  const [rules, setRules] = useState<RuleResource[]>([]);
  const [universes, setUniverses] = useState<StockUniverse[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [history, setHistory] = useState<MonitorRun[]>([]);
  useEffect(() => {
    const update = () => setHistory(monitorRuns(userId));
    update();
    window.addEventListener("signalgen:monitor-run", update);
    return () => window.removeEventListener("signalgen:monitor-run", update);
  }, [userId]);
  useEffect(() => {
    setAccount(null);
    setRules([]);
    setUniverses([]);
    setSubscription(null);
  }, [userId]);
  useEffect(() => {
    if (!authenticated || !backendOnline) return;
    let active = true;
    setLoading(true);
    setError(false);
    // One failed request must not hide the resources that are available.
    Promise.allSettled([
      api.account(),
      api.listRules(),
      api.listStockUniverses(),
      api.currentSubscription(),
    ]).then(([a, r, u, s]) => {
      if (!active) return;
      if (a.status === "fulfilled") setAccount(a.value);
      if (r.status === "fulfilled") setRules(r.value.items);
      if (u.status === "fulfilled") setUniverses(u.value.items);
      if (s.status === "fulfilled") setSubscription(s.value.subscription);
      setError([a, r, u, s].some((result) => result.status === "rejected"));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [authenticated, backendOnline, userId, reload]);
  const preferences = userId ? readScreenerPreferences(userId) : null;
  const activeRule =
    rules.find((rule) => rule.id === preferences?.ruleId) ?? rules[0];
  const activeUniverse =
    universes.find((universe) => universe.id === preferences?.universeId) ??
    universes[0];
  const ready =
    Boolean(account?.features.includes("screener")) &&
    rules.length > 0 &&
    universes.length > 0;
  const latest = history[0];
  const nextStep = !account?.features.includes("screener")
    ? "subscription"
    : !rules.length
      ? "rules"
      : "universes";
  function continueScreen(item?: MonitorRun) {
    if (userId && item?.context)
      saveScreenerPreferences(userId, {
        ...readScreenerPreferences(userId),
        ruleId: item.context.ruleId,
        universeId: item.context.universeId,
      });
    go("analysis");
  }
  if (!authenticated || !backendOnline)
    return (
      <Alert className="overview-notice">
        <ShieldCheck />
        <AlertTitle>
          {backendOnline
            ? "Masuk untuk membuka workspace"
            : "Backend belum terhubung"}
        </AlertTitle>
        <AlertDescription>
          {backendOnline
            ? "Rule, universe, dan riwayat terpisah untuk setiap akun."
            : "Hubungkan backend untuk memuat akun dan menjalankan screening."}
        </AlertDescription>
        {backendOnline && (
          <Button nativeButton={false} render={<a href="#login" />}>
            Sign in
          </Button>
        )}
      </Alert>
    );
  if (loading && !account)
    return (
      <div
        className="overview-board"
        role="status"
        aria-label="Memuat dashboard"
        aria-busy="true"
      >
        <section
          className="overview-next overview-placeholder"
          aria-hidden="true"
        >
          <Skeleton className="dashboard-skeleton__value" />
          <Skeleton className="dashboard-skeleton__line" />
          <Skeleton className="dashboard-skeleton__action" />
        </section>
        <div
          className="overview-counts overview-placeholder"
          aria-hidden="true"
        >
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="dashboard-skeleton__value" />
          ))}
        </div>
        <section className="overview-placeholder" aria-hidden="true">
          <Skeleton className="dashboard-skeleton__line" />
          <Skeleton className="overview-placeholder__rows" />
        </section>
      </div>
    );
  return (
    <div className="overview-board" aria-busy={loading}>
      {error && (
        <Alert className="overview-notice">
          <RefreshCw />
          <AlertTitle>Sebagian data belum dapat dimuat</AlertTitle>
          <AlertDescription>
            Data yang sudah tersedia tetap ditampilkan. Coba muat ulang untuk
            memperbarui dashboard.
          </AlertDescription>
          <Button
            variant="outline"
            onClick={() => setReload((v) => v + 1)}
            disabled={loading}
          >
            Muat ulang
          </Button>
        </Alert>
      )}
      <div className="overview-launch">
        <section
          className="overview-next"
          aria-labelledby="overview-next-title"
        >
          <div>
            <h3 id="overview-next-title">
              {ready
                ? latest
                  ? "Lanjutkan analisis Anda"
                  : "Siap untuk screening pertama"
                : "Lengkapi workspace Anda"}
            </h3>
            <p>
              {ready
                ? latest
                  ? "Lanjutkan dengan pilihan terakhir, atau ubah sebelum screening."
                  : "Pilih rule dan stock universe, lalu periksa hasil beserta alasannya."
                : "Akses screener, rule, dan stock universe diperlukan sebelum menjalankan analisis."}
            </p>
            <dl className="overview-selection">
              <div>
                <dt>
                  <ListChecks aria-hidden="true" />
                  Rule
                </dt>
                <dd>{activeRule?.name ?? "Belum dipilih"}</dd>
              </div>
              <div>
                <dt>
                  <Boxes aria-hidden="true" />
                  Stock universe
                </dt>
                <dd>{activeUniverse?.name ?? "Belum dibuat"}</dd>
                {activeUniverse && (
                  <span>{activeUniverse.symbols.length} saham</span>
                )}
              </div>
            </dl>
          </div>
          <Button
            size="lg"
            onClick={() => (ready ? continueScreen() : go(nextStep))}
          >
            <SearchCheck data-icon="inline-start" />
            {ready
              ? "Buka screener"
              : nextStep === "subscription"
                ? "Periksa akses"
                : nextStep === "rules"
                  ? "Buat rule"
                  : "Buat universe"}
          </Button>
        </section>
        <nav className="overview-shortcuts" aria-label="Akses cepat">
          <h3>Pantau pasar</h3>
          <button onClick={() => go("realtime")}>
            <Activity aria-hidden="true" />
            <span>
              <strong>Market monitor</strong>
              <small>Chart dan harga saham pantauan</small>
            </span>
            <ArrowUpRight aria-hidden="true" />
          </button>
          <button onClick={() => go("news")}>
            <Newspaper aria-hidden="true" />
            <span>
              <strong>Berita & video</strong>
              <small>Ikuti kabar emiten dan pasar</small>
            </span>
            <ArrowUpRight aria-hidden="true" />
          </button>
        </nav>
      </div>
      <section className="overview-counts" aria-label="Ringkasan workspace">
        <button onClick={() => go("rules")}>
          <ListChecks aria-hidden="true" />
          <span>Rules</span>
          <strong>{rules.length}</strong>
        </button>
        <button onClick={() => go("universes")}>
          <Boxes aria-hidden="true" />
          <span>Stock universes</span>
          <strong>{universes.length}</strong>
        </button>
        <button onClick={() => go("subscription")}>
          <BadgeCheck aria-hidden="true" />
          <span>Paket</span>
          <strong>{subscription?.plan_name ?? "—"}</strong>
        </button>
        <button onClick={() => go("access")}>
          <ShieldCheck aria-hidden="true" />
          <span>Akun</span>
          <strong>
            {account?.user.status === "active"
              ? "Aktif"
              : (account?.user.status ?? "—")}
          </strong>
        </button>
      </section>
      <section
        className="overview-activity"
        aria-labelledby="overview-activity-title"
      >
        <header>
          <h3 id="overview-activity-title">
            <Clock3 aria-hidden="true" />
            Screening terbaru
          </h3>
          <span className="overview-activity__caption">
            {history.length
              ? `${Math.min(history.length, 5)} aktivitas terakhir`
              : "Riwayat workspace"}
          </span>
        </header>
        {history.length ? (
          <ul>
            {history.slice(0, 5).map((item) => (
              <li key={item.recordedAt}>
                <div>
                  <strong>{item.rule}</strong>
                  <p>
                    {item.context?.universeName ??
                      item.run.rows
                        .map((row) => row.decision.symbol.replace(".JK", ""))
                        .join(", ")}
                  </p>
                </div>
                <time dateTime={item.recordedAt}>
                  {new Date(item.recordedAt).toLocaleString("id-ID", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                <Badge variant="secondary">
                  {item.run.rows.filter((row) => row.decision.matched).length} /{" "}
                  {item.run.rows.length} cocok
                </Badge>
                <Button variant="outline" onClick={() => continueScreen(item)}>
                  Gunakan pilihan
                  <ArrowUpRight data-icon="inline-end" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty className="overview-activity__empty">
            <EmptyHeader>
              <EmptyTitle>Belum ada screening yang selesai.</EmptyTitle>
              <EmptyDescription>
                Hasil pertama Anda akan tersimpan di sini setelah screening
                berhasil.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </div>
  );
}
