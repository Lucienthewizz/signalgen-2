import { useEffect, useRef, useState } from "react";
import { Clock3 } from "lucide-react";
import type { StudyProgress } from "@/analysis/signal-study";
import {
  estimateStudyRemaining,
  studyDuration,
  type StudySample,
} from "@/lib/study-estimate";
import { SINGAPORE_TIME_ZONE } from "@/lib/calendar";

export function StudyEstimate({
  progress,
}: {
  progress: StudyProgress | null;
}) {
  const [now, setNow] = useState(Date.now);
  const samples = useRef<StudySample[]>([]);
  const context = useRef<string>();
  const waiting = Boolean(
    progress?.waitingUntil && progress.waitingUntil > now,
  );
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const at = Date.now(),
      completed = progress?.completed ?? 0;
    if (context.current !== progress?.context.id) {
      context.current = progress?.context.id;
      samples.current = [];
    }
    // A rate-limit pause invalidates the previous speed measurement.
    if (waiting) samples.current = [];
    else if (
      !samples.current.length ||
      completed > samples.current.at(-1)!.completed
    ) {
      samples.current = [...samples.current, { at, completed }].slice(-12);
    }
    setNow(at);
  }, [progress?.completed, progress?.context.id, waiting]);
  const remaining = estimateStudyRemaining(
    samples.current,
    progress?.remaining ?? 1,
    now,
  );
  const finish =
    remaining == null
      ? ""
      : new Intl.DateTimeFormat("en-GB", {
          timeZone: SINGAPORE_TIME_ZONE,
          hour: "2-digit",
          minute: "2-digit",
          day: "2-digit",
          month: "short",
        }).format(new Date(now + remaining));
  return (
    <div className="study-estimate" aria-label="Estimated study completion">
      <Clock3 aria-hidden="true" />
      <div>
        <strong>
          {waiting
            ? "Estimate paused · server rate limit"
            : remaining === 0
              ? "Finalizing results…"
              : remaining == null
                ? "Estimating completion…"
                : `Estimated finish · ${finish} SGT`}
        </strong>
        <span>
          {waiting
            ? "Recalculates when processing resumes."
            : remaining == null
              ? "Waiting for enough completed batches to measure processing speed."
              : remaining === 0
                ? "Saving the completed study."
                : `${studyDuration(remaining)} remaining · estimate updates with processing speed`}
        </span>
      </div>
    </div>
  );
}
