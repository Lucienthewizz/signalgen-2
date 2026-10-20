import type { ScreenerTimeframe } from "../types";

export const screenerIntervals: Array<{
  value: ScreenerTimeframe;
  label: string;
  periodMs: number;
  range: string;
}> = [
  {
    value: "1m",
    label: "1 minute",
    periodMs: 60000,
    range: "3 calendar days; extends to 7 if needed",
  },
  {
    value: "5m",
    label: "5 minutes",
    periodMs: 300000,
    range: "3 calendar days; extends to 7 / 30 if needed",
  },
  {
    value: "15m",
    label: "15 minutes",
    periodMs: 900000,
    range: "3 calendar days; extends to 7 / 30 if needed",
  },
  {
    value: "1h",
    label: "1 hour",
    periodMs: 900000,
    range: "3 calendar days; extends to 7 / 30 if needed",
  },
  { value: "1d", label: "Daily", periodMs: 900000, range: "6 months" },
];

export type MonitorState = {
  active: boolean;
  busy: boolean;
  retrying: boolean;
  lastCheckedAt: number | null;
  nextCheckAt: number | null;
};
export const stoppedMonitor: MonitorState = {
  active: false,
  busy: false,
  retrying: false,
  lastCheckedAt: null,
  nextCheckAt: null,
};
type Events<T> = {
  task: (signal: AbortSignal) => Promise<T>;
  result: (result: T) => void;
  error: (error: unknown, retrying: boolean) => void;
  state: (state: MonitorState) => void;
};
type Clock = {
  now: () => number;
  set: (fn: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clear: (timer: ReturnType<typeof setTimeout>) => void;
};
const browserClock: Clock = {
  now: () => Date.now(),
  set: (fn, delay) => setTimeout(fn, delay),
  clear: (timer) => clearTimeout(timer),
};

/** One page-owned monitor. Timers are scheduled AFTER completion, never setInterval.
 * Generation + AbortSignal prevent a stopped/old task from publishing a result.
 * This intentionally is not a background service and never catches up missed ticks.
 */
export class ScreenerMonitor<T> {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private events: Events<T> | null = null;
  private period = 0;
  private failures = 0;
  private state: MonitorState = { ...stoppedMonitor };
  constructor(private readonly clock: Clock = browserClock) {}
  private emit(patch: Partial<MonitorState>) {
    this.state = { ...this.state, ...patch };
    this.events?.state({ ...this.state });
  }
  start(period: number, events: Events<T>) {
    if (this.state.active) return false;
    this.events = events;
    this.period = period;
    this.failures = 0;
    this.emit({
      active: true,
      retrying: false,
      nextCheckAt: null,
      lastCheckedAt: null,
    });
    const generation = ++this.generation;
    void this.tick(generation);
    return true;
  }
  stop() {
    ++this.generation;
    if (this.timer !== null) this.clock.clear(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
    this.emit({
      active: false,
      busy: false,
      retrying: false,
      nextCheckAt: null,
    });
  }
  private async tick(generation: number) {
    if (generation !== this.generation || !this.state.active) return;
    this.timer = null;
    const controller = new AbortController();
    this.controller = controller;
    const events = this.events!;
    this.emit({ busy: true, nextCheckAt: null });
    let delay = this.period;
    try {
      const result = await events.task(controller.signal);
      if (generation !== this.generation || controller.signal.aborted) return;
      this.failures = 0;
      events.result(result);
      this.emit({ lastCheckedAt: this.clock.now(), retrying: false });
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return;
      const failure = error as {
        status?: number;
        code?: string;
        retryAfterMs?: number;
      };
      const retrying =
        failure.status === 0 ||
        [429, 502, 503, 504].includes(failure.status ?? -1);
      events.error(error, retrying);
      if (!retrying) {
        this.stop();
        return;
      }
      this.failures++;
      delay = Math.max(
        this.period,
        Math.min(300000, 30000 * 2 ** Math.min(this.failures - 1, 4)),
        failure.retryAfterMs ?? 0,
      );
      this.emit({ retrying: true });
    } finally {
      if (generation === this.generation && this.state.active) {
        this.controller = null;
        this.emit({ busy: false, nextCheckAt: this.clock.now() + delay });
        this.timer = this.clock.set(() => void this.tick(generation), delay);
      }
    }
  }
}
