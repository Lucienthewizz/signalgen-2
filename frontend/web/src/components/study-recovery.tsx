import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, session } from "@/api/client";
import type { StudyContext } from "@/analysis/signal-study-types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function useStudyRecovery(
  userId: string | undefined,
  purpose: "screen" | "backtest",
  online: boolean,
  localRunId?: string,
) {
  const [previous, setPrevious] = useState<StudyContext | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const refresh = useCallback(
    async (capacityConflict = false) => {
      const ticket = ++generation.current;
      const revision = session.getIdentityRevision();
      const current = () =>
        ticket === generation.current &&
        revision === session.getIdentityRevision();
      setChecking(true);
      setError("");
      try {
        await api.ensureAppSession();
        if (!current()) return;
        const result = await api.activeStudies(purpose);
        if (current()) {
          setPrevious(result.items[0] ?? null);
          if (capacityConflict && !result.items.length)
            setError(
              "The server is busy with other runs. Wait a moment, then check again.",
            );
        }
      } catch {
        if (current())
          setError(
            "Could not check the previous run. Retry before starting a new one.",
          );
      } finally {
        if (current()) setChecking(false);
      }
    },
    [userId, purpose],
  );
  useEffect(() => {
    setPrevious(null);
    if (userId && online) void refresh();
    else setChecking(false);
    return () => {
      generation.current++;
    };
  }, [userId, online, refresh]);
  const otherRun = previous?.id === localRunId ? null : previous;
  async function cancel() {
    if (!otherRun || checking) return;
    const ticket = ++generation.current;
    const revision = session.getIdentityRevision();
    setChecking(true);
    setError("");
    try {
      await api.cancelStudy(otherRun.id, false, purpose).catch((e) => {
        if (!(e instanceof ApiError) || e.status !== 404) throw e;
      });
      if (
        ticket === generation.current &&
        revision === session.getIdentityRevision()
      )
        setPrevious(null);
    } catch {
      if (
        ticket === generation.current &&
        revision === session.getIdentityRevision()
      )
        setError("Could not cancel the previous run. Retry when connected.");
    } finally {
      if (
        ticket === generation.current &&
        revision === session.getIdentityRevision()
      )
        setChecking(false);
    }
  }
  return {
    previous: otherRun,
    checking,
    error,
    refresh,
    cancel,
    blocked: checking || !!otherRun || !!error,
  };
}

export function StudyRecovery({
  recovery,
}: {
  recovery: ReturnType<typeof useStudyRecovery>;
}) {
  if (!recovery.previous && !recovery.error)
    return recovery.checking ? (
      <p role="status">Checking for a previous run…</p>
    ) : null;
  return (
    <Alert>
      <AlertTitle>
        {recovery.previous ? "Previous run found" : "Run status unavailable"}
      </AlertTitle>
      <AlertDescription>
        {recovery.previous && (
          <p>
            The server still reserves a run for this session (
            {recovery.previous.market}, {recovery.previous.config.from}–
            {recovery.previous.config.to}). It may be open in another tab.
            Cancel it here before starting a new run.
          </p>
        )}
        {recovery.error && <p>{recovery.error}</p>}
        {recovery.previous ? (
          <Button
            type="button"
            variant="outline"
            disabled={recovery.checking}
            onClick={() => void recovery.cancel()}
          >
            Cancel previous run
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={recovery.checking}
            onClick={() => void recovery.refresh()}
          >
            Check again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
