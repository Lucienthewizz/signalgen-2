// A local API restart must not leave login disabled until the user reloads.
// Probe sequentially so slow requests cannot accumulate; disposal also guards
// React StrictMode/unmount against late state updates from an in-flight probe.
export function monitorBackendStatus(
  probe: () => Promise<unknown>,
  onStatus: (online: boolean) => void,
  intervalMs = 5000,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function check() {
    try {
      await probe();
      if (!stopped) onStatus(true);
    } catch {
      if (!stopped) onStatus(false);
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
