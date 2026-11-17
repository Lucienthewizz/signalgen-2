// React Bits CountUp, count-only adaptation; see LICENSE.md.
// Native animation keeps the existing bundle free of another motion runtime.
import { useEffect, useRef } from "react";
export default function CountUp({
  to,
  currency,
}: {
  to: number;
  currency?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(0);
  const format = (value: number) =>
    new Intl.NumberFormat("en-GB", {
      ...(currency ? { style: "currency" as const, currency } : {}),
      maximumFractionDigits: currency ? 2 : 0,
    }).format(value);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const from = previous.current;
    previous.current = to;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0,
      start = 0;
    const finish = () => {
      cancelAnimationFrame(frame);
      node.textContent = format(to);
    };
    const tick = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / 650);
      node.textContent = format(from + (to - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    if (!media.matches && Number.isFinite(to))
      frame = requestAnimationFrame(tick);
    else finish();
    media.addEventListener("change", finish);
    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener("change", finish);
    };
  }, [to, currency]);
  return (
    <span
      role="status"
      aria-live="off"
      aria-label={format(to)}
      style={{
        font: "inherit",
        color: "inherit",
        opacity: 1,
        transform: "none",
        display: "inline",
        minHeight: 0,
      }}
    >
      <span
        ref={ref}
        aria-hidden="true"
        style={{
          font: "inherit",
          color: "inherit",
          opacity: 1,
          transform: "none",
          display: "inline",
          minHeight: 0,
        }}
      >
        {format(to)}
      </span>
    </span>
  );
}
