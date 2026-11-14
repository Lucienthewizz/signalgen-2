// React Bits Dock magnification/spring engine adapted to Signalgen's sidebar.
// Supplied source: David Haz; MIT + Commons Clause, see LICENSE.md.
// Existing buttons, labels, tooltips and navigation handlers remain in place.
import { useEffect, useRef, type ReactNode } from "react";
import "./Dock.css";
export default function Dock({
  children,
  disabled = false,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = root.current;
    if (!nav || disabled) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const items = Array.from(
      nav.querySelectorAll<HTMLButtonElement>(".nav-group button"),
    ).map((button) => ({
      button,
      icon: button.querySelector<SVGElement>("svg"),
      center: 0,
      size: 1,
      velocity: 0,
    }));
    let pointer: number | null = null,
      focused: HTMLElement | null = null,
      frame = 0,
      last = 0;
    const measure = () =>
      items.forEach((item) => {
        const rect = item.button.getBoundingClientRect();
        item.center = rect.top + rect.height / 2;
      });
    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      items.forEach((item) => {
        item.size = 1;
        item.velocity = 0;
        item.icon?.style.removeProperty("transform");
      });
    };
    const tick = (now: number) => {
      frame = 0;
      if (media.matches || !fine.matches) {
        reset();
        return;
      }
      const dt = last ? Math.min(0.032, (now - last) / 1000) : 1 / 60;
      last = now;
      const focus =
        pointer ??
        items.find((item) => item.button === focused)?.center ??
        null;
      const steps = Math.max(1, Math.ceil(dt * 240)),
        h = dt / steps,
        k = 180,
        damping = 24;
      let moving = false;
      items.forEach((item) => {
        const reach = focus === null ? 1 : Math.abs(focus - item.center) / 95;
        const target =
          1 + 0.42 * (reach < 1 ? Math.cos((reach * Math.PI) / 2) ** 2 : 0);
        for (let i = 0; i < steps; i++) {
          item.velocity =
            (item.velocity + h * k * (target - item.size)) /
            (1 + h * damping + h * h * k);
          item.size += item.velocity * h;
        }
        if (
          Math.abs(target - item.size) < 0.0005 &&
          Math.abs(item.velocity) < 0.002
        ) {
          item.size = target;
          item.velocity = 0;
        } else moving = true;
        if (item.icon)
          item.icon.style.transform = `scale(${item.size.toFixed(4)})`;
      });
      if (moving) frame = requestAnimationFrame(tick);
      else last = 0;
    };
    const wake = () => {
      if (!frame && !media.matches && fine.matches)
        frame = requestAnimationFrame(tick);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointer = event.clientY;
      measure();
      wake();
    };
    const leave = () => {
      pointer = null;
      wake();
    };
    const focus = (event: FocusEvent) => {
      focused = (event.target as HTMLElement).closest("button");
      measure();
      wake();
    };
    const blur = (event: FocusEvent) => {
      if (!nav.contains(event.relatedTarget as Node | null)) focused = null;
      wake();
    };
    const refresh = () => {
      measure();
      wake();
    };
    nav.addEventListener("pointermove", move);
    nav.addEventListener("pointerleave", leave);
    nav.addEventListener("focusin", focus);
    nav.addEventListener("focusout", blur);
    nav.addEventListener("scroll", refresh);
    media.addEventListener("change", reset);
    fine.addEventListener("change", reset);
    const resize = new ResizeObserver(refresh);
    resize.observe(nav);
    measure();
    return () => {
      reset();
      resize.disconnect();
      nav.removeEventListener("pointermove", move);
      nav.removeEventListener("pointerleave", leave);
      nav.removeEventListener("focusin", focus);
      nav.removeEventListener("focusout", blur);
      nav.removeEventListener("scroll", refresh);
      media.removeEventListener("change", reset);
      fine.removeEventListener("change", reset);
    };
  }, [disabled]);
  return (
    <nav ref={root} aria-label="Workspace navigation" className="sidebar-dock">
      {children}
    </nav>
  );
}
