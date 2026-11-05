/** Presentation-only clock: no hidden-tab ticks and no burst of catch-up work. */
export function visibleInterval(callback: () => void, periodMs: number) {
  let timer: number | undefined;
  const sync = () => {
    window.clearInterval(timer);
    timer = undefined;
    if (document.visibilityState === "visible") {
      callback();
      timer = window.setInterval(callback, periodMs);
    }
  };
  sync();
  document.addEventListener("visibilitychange", sync);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", sync);
  };
}
