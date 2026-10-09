import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  CircleCheck,
  CircleAlert,
  Database,
  ListChecks,
  LoaderCircle,
  Plus,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import {
  runLiveScreener,
  type LiveScreenerRun,
  type ScreenerStage,
} from "@/analysis/screener";
import { api, ApiError } from "@/api/client";
import { TradingViewChart } from "@/components/tradingview-chart";
import { candleDate } from "@/lib/data-freshness";
import { conditionEvidence, screeningFailure } from "@/lib/workspace-feedback";
import {
  recordMonitorRun,
  monitorRuns,
  type MonitorRun,
} from "@/lib/market-monitor";
import {
  filteredRows,
  readScreenerPreferences,
  saveScreenerPreferences,
  type ScreenerPreferences,
} from "@/lib/screener-preferences";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AccountState, RuleResource, StockUniverse } from "@/types";

type Props = {
  authenticated: boolean;
  backendOnline: boolean;
  userId?: string;
  onDraft: (symbol: string) => void;
};

type RunState = "idle" | "loading" | "completed" | "failed";

const stages: Record<ScreenerStage, [string, number]> = {
  validating_access: ["Memeriksa akses akun", 15],
  preparing_data: ["Menyiapkan data harian", 40],
  loading_engine: ["Menghitung indikator", 68],
  private_scoring: ["Memeriksa kondisi rule", 88],
};

function ruleSummary(rule?: RuleResource) {
  if (!rule?.definition?.conditions.length) return [];
  return rule.definition.conditions.map(
    (condition) => `${condition.left} ${condition.op} ${condition.right}`,
  );
}

function decisionReasons(reasons: string[]) {
  if (!reasons.length) return "Server tidak menyertakan alasan.";
  return reasons
    .map((reason) =>
      reason === "RULE_MATCHED"
        ? "Semua kondisi terpenuhi."
        : reason === "CONDITIONS_NOT_MET"
          ? "Ada kondisi yang belum terpenuhi."
          : reason.toLowerCase().replaceAll("_", " "),
    )
    .join(", ");
}

export function WorkspaceScreenerPanel({
  authenticated,
  backendOnline,
  userId,
  onDraft,
}: Props) {
  const [account, setAccount] = useState<AccountState | null>(null);
  const [rules, setRules] = useState<RuleResource[]>([]);
  const [universes, setUniverses] = useState<StockUniverse[]>([]);
  const [ruleId, setRuleId] = useState("");
  const [universeId, setUniverseId] = useState("");
  const [loadingResources, setLoadingResources] = useState(true);
  const [state, setState] = useState<RunState>("idle");
  const [stage, setStage] = useState("Ready to screen");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<LiveScreenerRun | null>(null);
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);
  const detailRow = run?.rows.find(
    (row) => row.decision.symbol === detailSymbol,
  );
  const controller = useRef<AbortController | null>(null);
  const running = useRef(false);
  const mounted = useRef(false);
  const resourceVersion = useRef(0);
  const [failure, setFailure] = useState<ReturnType<
    typeof screeningFailure
  > | null>(null);
  const [resultFilter, setResultFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ScreenerPreferences["sort"]>("symbol");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [history, setHistory] = useState<MonitorRun[]>([]);
  const [historicalRun, setHistoricalRun] = useState<MonitorRun | null>(null);
  const restoredUser = useRef<string | null>(null);
  const [runContext, setRunContext] = useState<{
    rule: RuleResource;
    universe: string;
    count: number;
  } | null>(null);

  async function loadResources() {
    if (!authenticated || !backendOnline) return;
    const version = ++resourceVersion.current;
    setLoadingResources(true);
    setError(null);
    try {
      const [accountResponse, ruleResponse, universeResponse] =
        await Promise.all([
          api.account(),
          api.listRules(),
          api.listStockUniverses(),
        ]);
      if (!mounted.current || version !== resourceVersion.current) return;
      setAccount(accountResponse);
      setRules(ruleResponse.items);
      setUniverses(universeResponse.items);
      const saved = readScreenerPreferences(accountResponse.user.id);
      setRuleId((current) =>
        ruleResponse.items.some((item) => item.id === (current || saved.ruleId))
          ? current || saved.ruleId
          : (ruleResponse.items[0]?.id ?? ""),
      );
      setUniverseId((current) =>
        universeResponse.items.some(
          (item) => item.id === (current || saved.universeId),
        )
          ? current || saved.universeId
          : (universeResponse.items[0]?.id ?? ""),
      );
      if (restoredUser.current !== accountResponse.user.id) {
        const recent = monitorRuns(accountResponse.user.id);
        restoredUser.current = accountResponse.user.id;
        setResultFilter(saved.filter);
        setSearch(saved.search);
        setSort(saved.sort);
        setHistory(recent);
        if (recent[0]) {
          setRun(recent[0].run);
          setHistoricalRun(recent[0]);
          setState("completed");
        }
      }
      setPreferencesReady(true);
    } catch (caught) {
      if (!mounted.current || version !== resourceVersion.current) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Resource screener belum dapat dimuat.",
      );
    } finally {
      if (mounted.current && version === resourceVersion.current)
        setLoadingResources(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    setAccount(null);
    setRun(null);
    setRunContext(null);
    setHistoricalRun(null);
    setHistory([]);
    setRuleId("");
    setUniverseId("");
    setPreferencesReady(false);
    setState("idle");
    restoredUser.current = null;
    void loadResources();
    return () => {
      mounted.current = false;
      ++resourceVersion.current;
      controller.current?.abort();
    };
  }, [authenticated, backendOnline, userId]);

  useEffect(() => {
    if (!preferencesReady || !account) return;
    setStorageUnavailable(
      !saveScreenerPreferences(account.user.id, {
        ruleId,
        universeId,
        filter: resultFilter as ScreenerPreferences["filter"],
        search,
        sort,
      }),
    );
  }, [
    account,
    preferencesReady,
    ruleId,
    universeId,
    resultFilter,
    search,
    sort,
  ]);

  const visibleRows = useMemo(
    () => filteredRows(run?.rows ?? [], resultFilter, search, sort),
    [run, resultFilter, search, sort],
  );

  const selectedRule = rules.find((rule) => rule.id === ruleId);
  const selectedUniverse = universes.find(
    (universe) => universe.id === universeId,
  );
  const conditions = useMemo(() => ruleSummary(selectedRule), [selectedRule]);
  const canScreen = account?.features.includes("screener") ?? false;

  function updateStage(next: ScreenerStage) {
    setStage(stages[next][0]);
    setProgress(stages[next][1]);
  }

  async function execute() {
    if (!selectedRule || !selectedUniverse || !canScreen || running.current)
      return;
    running.current = true;
    controller.current?.abort();
    controller.current = new AbortController();
    const activeController = controller.current;
    setFailure(null);
    setState("loading");
    setProgress(5);
    setStage("Starting screen");
    setError(null);
    try {
      const result = await runLiveScreener(
        selectedRule.id,
        selectedUniverse.id,
        activeController.signal,
        (next) => {
          if (mounted.current && !activeController.signal.aborted)
            updateStage(next);
        },
      );
      if (!mounted.current || activeController.signal.aborted) return;
      setRun(result);
      setDetailSymbol(null);
      setRunContext({
        rule: selectedRule,
        universe: selectedUniverse.name,
        count: selectedUniverse.symbols.length,
      });
      setHistoricalRun(null);
      if (account) {
        recordMonitorRun(account.user.id, selectedRule.name, result, {
          ruleId: selectedRule.id,
          universeId: selectedUniverse.id,
          universeName: selectedUniverse.name,
        });
        setHistory(monitorRuns(account.user.id));
      }
      setProgress(100);
      setStage("Screen complete");
      setState("completed");
    } catch (caught) {
      if (!mounted.current || activeController.signal.aborted) return;
      setFailure(
        screeningFailure(
          caught instanceof ApiError
            ? caught
            : { message: caught instanceof Error ? caught.message : undefined },
        ),
      );
      setError(
        caught instanceof Error
          ? caught.message
          : "Screening tidak dapat diselesaikan.",
      );
      setProgress(0);
      setStage("Screen failed");
      setState("failed");
    } finally {
      if (controller.current === activeController) running.current = false;
    }
  }

  function cancel() {
    controller.current?.abort();
    running.current = false;
    setState(run ? "completed" : "idle");
    setProgress(0);
    setStage("Screen cancelled");
  }

  if (!authenticated || !backendOnline) {
    return (
      <Empty className="workspace-empty-state">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldCheck />
          </EmptyMedia>
          <EmptyTitle>Screener belum terhubung</EmptyTitle>
          <EmptyDescription>
            {!backendOnline
              ? "Jalankan Go API untuk memakai private scoring."
              : "Masuk agar Signalgen dapat memverifikasi akses screener."}
          </EmptyDescription>
        </EmptyHeader>
        {backendOnline && (
          <EmptyContent>
            <Button nativeButton={false} render={<a href="#login" />}>
              Sign in
            </Button>
          </EmptyContent>
        )}
      </Empty>
    );
  }

  return (
    <div className="screener-workspace">
      <section
        className="screener-console"
        aria-labelledby="screener-console-title"
      >
        <header className="screener-console__header">
          <div className="resource-title-lockup">
            <span aria-hidden="true">
              <SearchCheck />
            </span>
            <div>
              <h3 id="screener-console-title">Pilih saham, jalankan rule</h3>
              <p>Dua pilihan untuk memulai. Hasil screening tampil di bawah.</p>
            </div>
          </div>
          <Badge variant="outline">Daily data · Yahoo Finance</Badge>
        </header>

        {loadingResources ? (
          <div
            className="screener-resource-loading"
            role="status"
            aria-label="Memuat rules dan stock universes"
            aria-busy="true"
          >
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ) : !account ? (
          <Empty className="screener-access-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleAlert />
              </EmptyMedia>
              <EmptyTitle>Screening resources could not be loaded</EmptyTitle>
              <EmptyDescription>
                Retry to load your access, rules, and stock universes.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : !canScreen ? (
          <Empty className="screener-access-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ShieldCheck />
              </EmptyMedia>
              <EmptyTitle>Screener access is not active</EmptyTitle>
              <EmptyDescription>
                Buka Plan & access untuk melihat paket, atau minta operator
                memberikan grant screener.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                nativeButton={false}
                render={<a href="#app/subscription" />}
              >
                View access
              </Button>
            </EmptyContent>
          </Empty>
        ) : !rules.length || !universes.length ? (
          <div className="screener-prerequisites">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  {!rules.length ? <ListChecks /> : <Database />}
                </EmptyMedia>
                <EmptyTitle>
                  {!rules.length
                    ? "Create a rule first"
                    : "Create a stock universe first"}
                </EmptyTitle>
                <EmptyDescription>
                  {!rules.length
                    ? "Screener membutuhkan minimal satu rule aktif."
                    : "Pilih satu sampai tiga saham yang ingin dianalisis bersama."}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  nativeButton={false}
                  render={
                    <a href={!rules.length ? "#app/rules" : "#app/universes"} />
                  }
                >
                  <Plus data-icon="inline-start" />{" "}
                  {!rules.length ? "Create rule" : "Create universe"}
                </Button>
              </EmptyContent>
            </Empty>
          </div>
        ) : (
          <div className="screener-console__body">
            <FieldGroup className="screener-pickers">
              <Field>
                <FieldLabel htmlFor="screen-rule">Screening rule</FieldLabel>
                <Select
                  items={rules.map((rule) => ({
                    value: rule.id,
                    label: rule.name,
                  }))}
                  value={ruleId}
                  disabled={state === "loading"}
                  onValueChange={(value) => setRuleId(value ?? "")}
                >
                  <SelectTrigger id="screen-rule">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {rules.map((rule) => (
                        <SelectItem key={rule.id} value={rule.id}>
                          {rule.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {selectedRule?.owner_type === "system"
                    ? "Rule sistem, dikelola Signalgen."
                    : "Rule yang Anda simpan."}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="screen-universe">
                  Stock universe
                </FieldLabel>
                <Select
                  items={universes.map((universe) => ({
                    value: universe.id,
                    label: universe.name,
                  }))}
                  value={universeId}
                  disabled={state === "loading"}
                  onValueChange={(value) => setUniverseId(value ?? "")}
                >
                  <SelectTrigger id="screen-universe">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {universes.map((universe) => (
                        <SelectItem key={universe.id} value={universe.id}>
                          {universe.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {selectedUniverse?.symbols.join(" · ")}
                </FieldDescription>
              </Field>
            </FieldGroup>

            <div className="screener-run-summary">
              <div>
                <strong>{selectedRule?.name}</strong>
                {!conditions.length && (
                  <p>Kondisi rule sistem diperiksa oleh server.</p>
                )}
                <div>
                  {conditions.map((condition) => (
                    <Badge key={condition} variant="outline">
                      {condition}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="screener-run-summary__action">
                <small>
                  {selectedUniverse?.symbols.length ?? 0} saham · Harian
                </small>
                <Button
                  size="lg"
                  onClick={() => void execute()}
                  disabled={
                    state === "loading" || !selectedRule || !selectedUniverse
                  }
                >
                  {state === "loading" ? (
                    <LoaderCircle
                      className="is-spinning"
                      data-icon="inline-start"
                    />
                  ) : (
                    <BarChart3 data-icon="inline-start" />
                  )}
                  {state === "loading"
                    ? "Memeriksa saham…"
                    : "Jalankan screening"}
                </Button>
                {state === "loading" && (
                  <Button variant="ghost" onClick={cancel}>
                    <XCircle data-icon="inline-start" /> Batalkan
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {state === "loading" && (
          <div className="screener-progress" role="status">
            <span>
              {stage}
              <strong>{progress}%</strong>
            </span>
            <Progress value={progress} />
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>
              {failure?.title || "Resources could not be loaded"}
            </AlertTitle>
            <AlertDescription>{failure?.detail || error}</AlertDescription>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (failure?.action === "login") location.hash = "login";
                else if (failure?.action === "subscription")
                  location.hash = "app/subscription";
                else
                  void (state === "failed" && failure?.action !== "resources"
                    ? execute()
                    : loadResources());
              }}
            >
              <RefreshCw data-icon="inline-start" />{" "}
              {failure?.action === "login"
                ? "Sign in"
                : failure?.action === "subscription"
                  ? "Check access"
                  : failure?.action === "resources"
                    ? "Reload selections"
                    : "Try again"}
            </Button>
          </Alert>
        )}
      </section>

      {storageUnavailable && (
        <Alert>
          <CircleAlert />
          <AlertTitle>Preferensi belum tersimpan</AlertTitle>
          <AlertDescription>
            Penyimpanan browser tidak tersedia. Pilihan dan hasil tetap dapat
            digunakan selama halaman ini terbuka.
          </AlertDescription>
        </Alert>
      )}

      {history.length > 0 && (
        <details className="screener-history">
          <summary>Riwayat screening ({history.length})</summary>
          <ul>
            {history.slice(0, 5).map((item) => (
              <li key={item.recordedAt}>
                <div>
                  <strong>{item.rule}</strong>
                  <time dateTime={item.recordedAt}>
                    {new Date(item.recordedAt).toLocaleString("id-ID")}
                  </time>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={state === "loading"}
                  onClick={() => {
                    setRun(item.run);
                    setRunContext(null);
                    setHistoricalRun(item);
                    setState("completed");
                    setFailure(null);
                    setError(null);
                  }}
                >
                  Tinjau hasil
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <section
        className="screener-results"
        aria-labelledby="screener-results-title"
      >
        <header className="screener-results__header">
          <div className="resource-title-lockup">
            <span aria-hidden="true">
              <BarChart3 />
            </span>
            <div>
              <h3 id="screener-results-title">Hasil screening</h3>
              <p>
                Saham yang cocok, harga harian, dan alasan setiap keputusan.
              </p>
            </div>
          </div>
          <Badge variant="outline">
            {run
              ? `${run.rows.filter((row) => row.decision.matched).length} memenuhi · ${run.rows.filter((row) => !row.decision.matched).length} tidak memenuhi`
              : "Belum dijalankan"}
          </Badge>
        </header>
        {state === "loading" && !run ? (
          <div
            className="screener-result-loading"
            role="status"
            aria-label="Menyiapkan hasil screening"
            aria-busy="true"
          >
            <Skeleton />
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </div>
        ) : !run ? (
          <Empty className="screener-results-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BarChart3 />
              </EmptyMedia>
              <EmptyTitle>Mulai dari rule dan stock universe</EmptyTitle>
              <EmptyDescription>
                Jalankan screening di atas. Setiap saham akan ditampilkan dengan
                keputusan dan alasannya.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="screener-result-toolbar">
              <div>
                <strong>{historicalRun?.rule ?? runContext?.rule.name}</strong>
                <p>
                  {historicalRun?.context?.universeName ??
                    runContext?.universe ??
                    "Riwayat tersimpan"}{" "}
                  · {run.rows.length} saham diperiksa.
                </p>
                <p>
                  {state === "loading"
                    ? "Screening baru sedang berjalan. Hasil terakhir tetap ditampilkan."
                    : historicalRun
                      ? `Hasil tersimpan ${new Date(historicalRun.recordedAt).toLocaleString("id-ID")}. Bukan harga live.`
                      : "Harga buka dan tutup harian · IDR · bukan harga live."}
                </p>
                <p>
                  Snapshot harian · candle terakhir{" "}
                  {candleDate(run.latestDecision.timestamp)} · bukan harga
                  real-time.
                </p>
              </div>
            </div>
            {detailRow && (
              <section
                className="stock-detail"
                aria-label={`Detail ${detailRow.decision.symbol}`}
              >
                <header className="stock-detail__heading">
                  <div>
                    <h3>{detailRow.decision.symbol.replace(".JK", "")}</h3>
                    <p>
                      Candle {candleDate(detailRow.decision.timestamp)} ·{" "}
                      {detailRow.decision.matched
                        ? "Memenuhi rule"
                        : "Tidak memenuhi rule"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDetailSymbol(null)}
                  >
                    Tutup detail
                  </Button>
                </header>
                <dl className="stock-detail__values">
                  {[
                    ["Harga buka", detailRow.latestOpen],
                    ["Harga tutup", detailRow.latestClose],
                    ["EMA 9", detailRow.features.ema9],
                    ["EMA 20", detailRow.features.ema20],
                    ["RSI 14", detailRow.features.rsi14],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>
                        {typeof value === "number"
                          ? new Intl.NumberFormat("id-ID", {
                              maximumFractionDigits: 2,
                            }).format(value)
                          : "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p>{decisionReasons(detailRow.decision.reason_codes)}</p>
                <div className="stock-detail__chart">
                  <TradingViewChart
                    symbol={`IDX:${detailRow.decision.symbol.replace(".JK", "")}`}
                    label={detailRow.decision.symbol.replace(".JK", "")}
                  />
                </div>
                <p className="stock-detail__note">
                  Chart dari penyedia dapat diperbarui terpisah. Angka dan
                  keputusan di atas berasal dari snapshot screening, bukan harga
                  pada chart.
                </p>
              </section>
            )}
            <FieldGroup className="screener-result-filters">
              <Field>
                <FieldLabel htmlFor="screen-search">Cari saham</FieldLabel>
                <Input
                  id="screen-search"
                  placeholder="Misalnya BBCA"
                  value={search}
                  maxLength={80}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="screen-filter">Tampilkan</FieldLabel>
                <Select
                  value={resultFilter}
                  items={[
                    { value: "all", label: "Semua saham" },
                    { value: "matched", label: "Memenuhi" },
                    { value: "rejected", label: "Tidak memenuhi" },
                  ]}
                  onValueChange={(value) => setResultFilter(value || "all")}
                >
                  <SelectTrigger id="screen-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">Semua saham</SelectItem>
                      <SelectItem value="matched">Memenuhi</SelectItem>
                      <SelectItem value="rejected">Tidak memenuhi</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="screen-sort">Urutkan</FieldLabel>
                <Select
                  value={sort}
                  items={[
                    { value: "symbol", label: "Nama saham" },
                    { value: "matched", label: "Memenuhi terlebih dahulu" },
                    { value: "close", label: "Harga tutup tertinggi" },
                    { value: "rsi", label: "RSI tertinggi" },
                  ]}
                  onValueChange={(v) =>
                    setSort((v ?? "symbol") as ScreenerPreferences["sort"])
                  }
                >
                  <SelectTrigger id="screen-sort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="symbol">Nama saham</SelectItem>
                      <SelectItem value="matched">
                        Memenuhi terlebih dahulu
                      </SelectItem>
                      <SelectItem value="close">
                        Harga tutup tertinggi
                      </SelectItem>
                      <SelectItem value="rsi">RSI tertinggi</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
            <p className="screener-result-count" role="status">
              {visibleRows.length} dari {run.rows.length} saham ditampilkan
            </p>
            <div className="screener-result-ledger">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Saham</TableHead>
                    <TableHead>Keputusan</TableHead>
                    <TableHead>Harga buka (IDR)</TableHead>
                    <TableHead>Harga tutup (IDR)</TableHead>
                    <TableHead>RSI14</TableHead>
                    <TableHead>EMA20</TableHead>
                    <TableHead>Alasan</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => (
                    <TableRow key={row.decision.symbol}>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-expanded={detailSymbol === row.decision.symbol}
                          onClick={() => setDetailSymbol(row.decision.symbol)}
                        >
                          {row.decision.symbol.replace(".JK", "")}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.decision.matched ? "success" : "destructive"
                          }
                        >
                          {row.decision.matched ? (
                            <CircleCheck
                              data-icon="inline-start"
                              aria-hidden="true"
                            />
                          ) : (
                            <XCircle
                              data-icon="inline-start"
                              aria-hidden="true"
                            />
                          )}
                          {row.decision.matched ? "Memenuhi" : "Tidak memenuhi"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {row.latestOpen != null &&
                        Number.isFinite(row.latestOpen)
                          ? new Intl.NumberFormat("id-ID").format(
                              row.latestOpen,
                            )
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {new Intl.NumberFormat("id-ID").format(row.latestClose)}
                      </TableCell>
                      <TableCell>{row.features.rsi14.toFixed(2)}</TableCell>
                      <TableCell>{row.features.ema20.toFixed(2)}</TableCell>
                      <TableCell>
                        {decisionReasons(row.decision.reason_codes)}
                        <details className="screener-evidence">
                          <summary>Lihat bukti kondisi</summary>
                          <p>Candle {candleDate(row.decision.timestamp)}</p>
                          {runContext?.rule.definition ? (
                            <ul>
                              {runContext.rule.definition.conditions.map(
                                (condition, index) => {
                                  const evidence = conditionEvidence(
                                    condition,
                                    row.features,
                                  );
                                  return (
                                    <li key={index}>
                                      {evidence
                                        ? `${evidence.passed ? "Terpenuhi" : "Belum terpenuhi"}: ${evidence.label} (${evidence.left.toFixed(2)} dibanding ${evidence.right.toFixed(2)})`
                                        : "Nilai kondisi belum tersedia."}
                                    </li>
                                  );
                                },
                              )}
                            </ul>
                          ) : (
                            <p>
                              {historicalRun
                                ? "Hasil tersimpan dari keputusan server. Kondisi versi rule saat run ini tidak disimpan, sehingga tidak dibandingkan dengan versi rule terbaru."
                                : "Rule sistem tidak menampilkan bukti per kondisi. Hasil ini merupakan keputusan server."}
                            </p>
                          )}
                          <p>
                            Perbandingan kondisi dihitung di browser. Keputusan
                            akhir tetap berasal dari server.
                          </p>
                        </details>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            onDraft(row.decision.symbol.replace(".JK", ""))
                          }
                        >
                          Catat jurnal
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!visibleRows.length && (
                    <TableRow>
                      <TableCell colSpan={8}>
                        Tidak ada saham untuk filter ini.{" "}
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setSearch("");
                            setResultFilter("all");
                          }}
                        >
                          Reset filter
                        </Button>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <details className="screener-evidence">
              <summary>Informasi teknis data</summary>
              <footer className="dataset-provenance">
                <div>
                  <span>Provider</span>
                  <strong>Yahoo Finance</strong>
                </div>
                <div>
                  <span>Dataset</span>
                  <strong>{run.manifest.schema_version}</strong>
                </div>
                <div>
                  <span>Range</span>
                  <strong>
                    {run.manifest.available_range.from} —{" "}
                    {run.manifest.available_range.to}
                  </strong>
                </div>
                <div>
                  <span>Quality</span>
                  <strong>{run.manifest.quality.status}</strong>
                </div>
                <div>
                  <span>Checksum</span>
                  <code>{run.manifest.checksum.slice(0, 12)}…</code>
                </div>
              </footer>
            </details>
          </>
        )}
      </section>
    </div>
  );
}
