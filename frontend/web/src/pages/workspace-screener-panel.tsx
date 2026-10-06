import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
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
import { api } from "@/api/client";
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
  onDraft: (symbol: string) => void;
};

type RunState = "idle" | "loading" | "completed" | "failed";

const stages: Record<ScreenerStage, [string, number]> = {
  validating_access: ["Checking account access", 15],
  preparing_data: ["Preparing Yahoo Finance daily data", 40],
  loading_engine: ["Calculating indicators in your browser", 68],
  private_scoring: ["Evaluating the private rule", 88],
};

function ruleSummary(rule?: RuleResource) {
  if (!rule?.definition?.conditions.length) return [];
  return rule.definition.conditions.map(
    (condition) => `${condition.left} ${condition.op} ${condition.right}`,
  );
}

function decisionReasons(reasons: string[]) {
  if (!reasons.length) return "No matching reason returned";
  return reasons
    .map((reason) => reason.toLowerCase().replaceAll("_", " "))
    .join(", ");
}

export function WorkspaceScreenerPanel({
  authenticated,
  backendOnline,
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
  const controller = useRef<AbortController | null>(null);

  async function loadResources() {
    if (!authenticated || !backendOnline) return;
    setLoadingResources(true);
    setError(null);
    try {
      const [accountResponse, ruleResponse, universeResponse] =
        await Promise.all([
          api.account(),
          api.listRules(),
          api.listStockUniverses(),
        ]);
      setAccount(accountResponse);
      setRules(ruleResponse.items);
      setUniverses(universeResponse.items);
      setRuleId((current) =>
        ruleResponse.items.some((item) => item.id === current)
          ? current
          : (ruleResponse.items[0]?.id ?? ""),
      );
      setUniverseId((current) =>
        universeResponse.items.some((item) => item.id === current)
          ? current
          : (universeResponse.items[0]?.id ?? ""),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Resource screener belum dapat dimuat.",
      );
    } finally {
      setLoadingResources(false);
    }
  }

  useEffect(() => {
    void loadResources();
    return () => controller.current?.abort();
  }, [authenticated, backendOnline]);

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
    if (!selectedRule || !selectedUniverse || !canScreen) return;
    controller.current?.abort();
    controller.current = new AbortController();
    setState("loading");
    setProgress(5);
    setStage("Starting screen");
    setError(null);
    setRun(null);
    try {
      const result = await runLiveScreener(
        selectedRule.id,
        selectedUniverse.id,
        controller.current.signal,
        updateStage,
      );
      setRun(result);
      setProgress(100);
      setStage("Screen complete");
      setState("completed");
    } catch (caught) {
      if (controller.current.signal.aborted) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Screening tidak dapat diselesaikan.",
      );
      setProgress(0);
      setStage("Screen failed");
      setState("failed");
    }
  }

  function cancel() {
    controller.current?.abort();
    setState("idle");
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
              <h3 id="screener-console-title">Screen an IDX stock universe</h3>
              <p>
                Pilih rule dan universe, lalu tinjau keputusan setiap saham.
              </p>
            </div>
          </div>
          <Badge variant="outline">Daily data · Yahoo Finance</Badge>
        </header>

        {loadingResources ? (
          <div className="screener-resource-loading">
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
            <div className="screener-pickers">
              <label>
                <span>Screening rule</span>
                <Select
                  value={ruleId}
                  onValueChange={(value) => setRuleId(value ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {rules.map((rule) => (
                      <SelectItem key={rule.id} value={rule.id}>
                        {rule.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <small>
                  {selectedRule?.owner_type === "system"
                    ? "System rule · read only"
                    : "Your saved rule"}
                </small>
              </label>
              <label>
                <span>Stock universe</span>
                <Select
                  value={universeId}
                  onValueChange={(value) => setUniverseId(value ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {universes.map((universe) => (
                      <SelectItem key={universe.id} value={universe.id}>
                        {universe.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <small>{selectedUniverse?.symbols.join(" · ")}</small>
              </label>
            </div>

            <div className="screener-run-summary">
              <div>
                <span>Checks in this run</span>
                <strong>{selectedRule?.name}</strong>
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
                  {selectedUniverse?.symbols.length ?? 0} instruments · 1D
                </small>
                <Button
                  size="lg"
                  onClick={() => void execute()}
                  disabled={state === "loading"}
                >
                  {state === "loading" ? (
                    <LoaderCircle
                      className="is-spinning"
                      data-icon="inline-start"
                    />
                  ) : (
                    <BarChart3 data-icon="inline-start" />
                  )}
                  {state === "completed" ? "Run again" : "Run screen"}
                </Button>
                {state === "loading" && (
                  <Button variant="ghost" onClick={cancel}>
                    <XCircle data-icon="inline-start" /> Cancel
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
              {state === "failed"
                ? "Screening did not complete"
                : "Screening resources could not be loaded"}
            </AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void (state === "failed" ? execute() : loadResources())
              }
            >
              <RefreshCw data-icon="inline-start" /> Try again
            </Button>
          </Alert>
        )}
      </section>

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
              <h3 id="screener-results-title">Results and evidence</h3>
              <p>
                Keputusan, indikator, dan provenance data dalam satu ledger.
              </p>
            </div>
          </div>
          <Badge variant="outline">
            {run ? `${run.rows.length} evaluated` : "Waiting to run"}
          </Badge>
        </header>
        {state === "loading" ? (
          <div className="screener-result-loading">
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
              <EmptyTitle>Your results will appear here</EmptyTitle>
              <EmptyDescription>
                Tidak ada data contoh. Jalankan rule untuk mendapatkan keputusan
                dari backend.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="screener-result-ledger">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead>Close</TableHead>
                    <TableHead>RSI14</TableHead>
                    <TableHead>EMA20</TableHead>
                    <TableHead>Evidence</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.rows.map((row) => (
                    <TableRow key={row.decision.symbol}>
                      <TableCell>
                        <strong>
                          {row.decision.symbol.replace(".JK", "")}
                        </strong>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.decision.matched ? "default" : "secondary"
                          }
                        >
                          {row.decision.matched ? "Match" : "No match"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Intl.NumberFormat("id-ID").format(row.latestClose)}
                      </TableCell>
                      <TableCell>{row.features.rsi14.toFixed(2)}</TableCell>
                      <TableCell>{row.features.ema20.toFixed(2)}</TableCell>
                      <TableCell>
                        {decisionReasons(row.decision.reason_codes)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            onDraft(row.decision.symbol.replace(".JK", ""))
                          }
                        >
                          Journal
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
          </>
        )}
      </section>
    </div>
  );
}
