// A local API restart must not leave login disabled until the user reloads.
// Probe sequentially so slow requests cannot accumulate; disposal also guards
// React StrictMode/unmount against late state updates from an in-flight probe.
export type BackendConnection =
  "checking" | "online" | "offline" | "reconnecting";

export function monitorBackendStatus(
  probe: () => Promise<unknown>,
  onStatus: (online: boolean) => void,
  intervalMs = 5000,
  onConnection?: (state: BackendConnection) => void,
): () => void {
  let stopped = false;
  let failed = false;
  let first = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function check() {
    if (stopped) return;
    if (first || failed) onConnection?.(failed ? "reconnecting" : "checking");
    first = false;
    try {
      await probe();
      if (!stopped) {
        failed = false;
        onStatus(true);
        onConnection?.("online");
      }
    } catch {
      if (!stopped) {
        failed = true;
        onStatus(false);
        onConnection?.("offline");
      }
    } finally {
      if (!stopped) timer = setTimeout(check, intervalMs);
    }
  }
  void check();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
