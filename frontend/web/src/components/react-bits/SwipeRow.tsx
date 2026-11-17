// React Bits SwipeRow, adapted from the supplied source. See LICENSE.md.
// Action disclosure only: destructive actions retain the application's confirmation.
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import "./SwipeRow.css";

export type SwipeAction = {
  id: string;
  label: string;
  accessibleLabel?: string;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
};
type Props = {
  children: ReactNode;
  actions: SwipeAction[];
  label: string;
  height?: number;
  radius?: number;
  actionWidth?: number;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onAction: (action: SwipeAction, event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  style?: CSSProperties;
};
const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));
const rubber = (value: number, width: number) =>
  (value * width * 0.55) / (width + 0.55 * Math.abs(value));
const project = (velocity: number) => ((velocity / 1000) * 0.998) / (1 - 0.998);

export default function SwipeRow({
  children,
  actions,
  label,
  height = 88,
  radius = 10,
  actionWidth = 64,
  disabled = false,
  open: openProp,
  onOpenChange,
  onAction,
  className = "",
  style,
}: Props) {
  const uid = useId();
  const reduce = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [openState, setOpenState] = useState(false);
  const [say, setSay] = useState("");
  const [width, setWidth] = useState(360);
  const open = !disabled && (openProp ?? openState);
  const drawer = Math.min(
    actions.length * actionWidth,
    Math.max(0, width - 48),
  );
  const buttonWidth = actions.length ? drawer / actions.length : actionWidth;
  const x = useMotionValue(0);
  const railX = useTransform(x, (value) => Math.max(0, drawer + value));
  const animation = useRef<ReturnType<typeof animate> | null>(null);
  const grip = useRef<{
    id: number;
    x: number;
    y: number;
    start: number;
    axis: "horizontal" | "vertical" | null;
    history: [number, number][];
  } | null>(null);
  const unwatch = useRef<(() => void) | null>(null);
  const moved = useRef(false);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function settle(target: number, velocity = 0) {
    animation.current?.stop();
    if (reduce) {
      x.set(-target);
      return;
    }
    animation.current = animate(x, -target, {
      type: "spring",
      duration: 0.3,
      bounce: Math.abs(velocity) >= 110 ? 0.12 : 0,
      velocity: -clamp(velocity, -1500, 1500),
    });
  }
  function setOpen(next: boolean) {
    setOpenState(next);
    onOpenChange?.(next);
    setSay(next ? `${actions.length} actions revealed` : "Actions closed");
  }
  useEffect(() => {
    if (!grip.current) settle(open ? drawer : 0);
    // MotionValue identity is stable; each open/size/preference change retargets it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, drawer, reduce]);
  useEffect(
    () => () => {
      unwatch.current?.();
      animation.current?.stop();
    },
    [],
  );
  useEffect(() => {
    if (!open) return;
    const outside = (event: globalThis.PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function down(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as Element).closest("button, a, input, select, textarea"))
      return;
    if (
      disabled ||
      !actions.length ||
      event.button !== 0 ||
      grip.current ||
      (event.target as Element).closest("button,a,input,select,textarea")
    )
      return;
    animation.current?.stop();
    moved.current = false;
    grip.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: -x.get(),
      axis: null,
      history: [],
    };
    const move = (e: globalThis.PointerEvent) => {
      const g = grip.current;
      if (!g || e.pointerId !== g.id || g.axis === "vertical") return;
      const dx = e.clientX - g.x,
        dy = e.clientY - g.y;
      if (g.axis === null) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          g.axis = "vertical";
          return;
        }
        g.axis = "horizontal";
        moved.current = true;
        surface.current?.setPointerCapture(e.pointerId);
        root.current?.setAttribute("data-dragging", "");
      }
      const raw = g.start - dx;
      const exposed =
        raw < 0
          ? rubber(raw, width)
          : raw > drawer
            ? drawer + rubber(raw - drawer, width)
            : raw;
      x.set(-exposed);
      g.history.push([performance.now(), exposed]);
      if (g.history.length > 4) g.history.shift();
    };
    const up = (e: globalThis.PointerEvent) => {
      const g = grip.current;
      if (!g || e.pointerId !== g.id) return;
      grip.current = null;
      unwatch.current?.();
      unwatch.current = null;
      root.current?.removeAttribute("data-dragging");
      if (surface.current?.hasPointerCapture(e.pointerId))
        surface.current.releasePointerCapture(e.pointerId);
      if (e.type === "pointercancel" || g.axis !== "horizontal") {
        settle(open ? drawer : 0);
        return;
      }
      const first = g.history[0],
        last = g.history.at(-1);
      const velocity =
        first && last && performance.now() - last[0] < 100
          ? ((last[1] - first[1]) / Math.max(1, last[0] - first[0])) * 1000
          : 0;
      const target =
        Math.abs(velocity) >= 110
          ? velocity > 0
          : -x.get() + project(velocity) > drawer / 2;
      setOpen(target);
      settle(target ? drawer : 0, velocity);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    unwatch.current?.();
    unwatch.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }
  const railId = `${uid}-actions`;
  return (
    <div
      ref={root}
      role="group"
      aria-label={label}
      className={`swipe-row ${className}`.trim()}
      data-open={open || undefined}
      data-disabled={disabled || undefined}
      style={
        {
          "--sr-h": `${height}px`,
          "--sr-r": `${radius}px`,
          "--sr-a": `${buttonWidth}px`,
          ...style,
        } as CSSProperties
      }
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      <div className="swipe-row__clip">
        <motion.div
          ref={surface}
          className="swipe-row__surface"
          style={{ x }}
          onPointerDown={down}
          onClickCapture={(event) => {
            if (moved.current && event.detail !== 0) {
              event.preventDefault();
              event.stopPropagation();
              moved.current = false;
            }
          }}
        >
          {children}
          <button
            ref={toggle}
            type="button"
            className="swipe-row__toggle"
            disabled={disabled || !actions.length}
            aria-expanded={open}
            aria-controls={railId}
            aria-label={`Actions for ${label}`}
            aria-keyshortcuts="ArrowLeft ArrowRight"
            onClick={() => {
              setOpen(!open);
              settle(open ? 0 : drawer);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                const next = event.key === "ArrowLeft";
                setOpen(next);
                settle(next ? drawer : 0);
              }
            }}
          >
            Actions
          </button>
        </motion.div>
        <motion.div
          id={railId}
          className="swipe-row__rail"
          aria-hidden={!open}
          style={{ width: drawer, x: railX }}
        >
          {[...actions].reverse().map((action, index) => (
            <button
              key={action.id}
              type="button"
              className="swipe-row__action rule-library-action"
              data-destructive={action.destructive || undefined}
              style={{
                right:
                  (actions.length - 1 - index) * buttonWidth +
                  (buttonWidth - 48) / 2,
              }}
              disabled={disabled || action.disabled}
              aria-label={action.accessibleLabel ?? action.label}
              tabIndex={open ? 0 : -1}
              onClick={(event) => {
                onAction(action, event);
                setOpen(false);
                settle(0);
              }}
            >
              {action.icon}
              <span>{action.label}</span>
            </button>
          ))}
        </motion.div>
      </div>
      <span className="swipe-row__sr" aria-live="polite">
        {say}
      </span>
    </div>
  );
}
