export type StudySample = { at: number; completed: number };

// Use recent completed work, not a fabricated per-stock duration. Slow or stalled
// batches must not leave a countdown claiming that completion is imminent.
export function estimateStudyRemaining(
  samples: StudySample[],
  remaining: number,
  now: number,
): number | null {
  if (remaining <= 0) return 0;
  const first = samples[0],
    last = samples[samples.length - 1];
  if (!first || !last || first === last || now - last.at > 90_000) return null;
  const work = last.completed - first.completed,
    elapsed = last.at - first.at;
  if (work <= 0 || elapsed < 1000) return null;
  const estimate = (elapsed / work) * remaining - Math.max(0, now - last.at);
  return estimate > 0 ? Math.ceil(estimate) : null;
}

export function studyDuration(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return minutes < 60
    ? `about ${minutes} min`
    : `about ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
