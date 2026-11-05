const key = (owner: string) =>
  `signalgen.monitor-selection.v1.${encodeURIComponent(owner)}`;
export function readMonitorSelection(
  owner?: string,
): { universeId: string; ticker: string } | null {
  if (!owner) return null;
  try {
    const raw = localStorage.getItem(key(owner));
    if (!raw || raw.length > 1024) return null;
    const value = JSON.parse(raw);
    return typeof value?.universeId === "string" &&
      value.universeId.length <= 160 &&
      typeof value?.ticker === "string" &&
      /^[A-Z0-9.^=-]{1,40}$/.test(value.ticker)
      ? value
      : null;
  } catch {
    return null;
  }
}
export function saveMonitorSelection(
  owner: string,
  universeId: string,
  ticker: string,
) {
  try {
    localStorage.setItem(key(owner), JSON.stringify({ universeId, ticker }));
  } catch {
    /* Optional local preference; never blocks screening. */
  }
}
