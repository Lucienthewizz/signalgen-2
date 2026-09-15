// Adapted from the Hyperiux Vault component supplied by the project owner.
// https://vault.hyperiux.com — GSAP clipping, row highlight and pointer smoothing.
import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface InteractiveListItem {
  client: string;
  platform?: string;
  services: string;
  img: string;
}

export interface InteractiveListPreviewProps {
  items?: InteractiveListItem[];
  imageSize?: number;
  duration?: number;
  smoothness?: number;
  lerp?: number;
  bgColor?: string;
  className?: string;
}

const clamp = (n: number, min: number, max: number, fallback: number) =>
  Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;

export default function InteractiveListPreview({
  items = [],
  imageSize = 1,
  duration = 0.45,
  smoothness = 0.3,
  lerp = 0.18,
  bgColor = "var(--card)",
  className,
}: InteractiveListPreviewProps) {
  const [selected, setSelected] = useState(0);
  const [active, setActive] = useState(false);
  const [reduced, setReduced] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const highlight = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const index = Math.min(selected, Math.max(0, items.length - 1));
  const item = items[index];

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const row = rows.current[index];
    if (!row || !highlight.current || !picture.current) return;
    const ctx = gsap.context(() => {
      gsap.to(highlight.current, {
        y: row.offsetTop,
        height: row.offsetHeight,
        opacity: active ? 1 : 0,
        duration: reduced ? 0 : clamp(smoothness, 0.05, 1.5, 0.3),
        ease: "power3.out",
        overwrite: true,
      });
      gsap.fromTo(
        picture.current,
        { clipPath: reduced ? "inset(0%)" : "inset(8%)", opacity: 0.65 },
        {
          clipPath: active ? "inset(0%)" : "inset(50%)",
          opacity: active ? 1 : 0,
          duration: reduced ? 0 : clamp(duration, 0.1, 2, 0.45),
          ease: "power2.out",
        },
      );
    }, surface);
    return () => ctx.kill(false);
  }, [index, items.length, reduced, duration, smoothness, active]);

  // Run pointer-follow only while the user interacts, never as an idle loop.
  const stopFollow = useRef<(() => void) | null>(null);
  useEffect(() => () => stopFollow.current?.(), []);
  useEffect(() => {
    if (reduced) {
      stopFollow.current?.();
      stopFollow.current = null;
      if (picture.current) gsap.set(picture.current, { x: 0, y: 0 });
    }
  }, [reduced]);

  const startFollow = () => {
    if (
      reduced ||
      matchMedia("(pointer: coarse)").matches ||
      stopFollow.current
    )
      return;
    const tick = () => {
      const factor = clamp(lerp, 0.02, 1, 0.18);
      current.current.x += (target.current.x - current.current.x) * factor;
      current.current.y += (target.current.y - current.current.y) * factor;
      if (picture.current) gsap.set(picture.current, current.current);
    };
    gsap.ticker.add(tick);
    stopFollow.current = () => gsap.ticker.remove(tick);
  };

  if (!item) return null;
  return (
    <div
      ref={surface}
      className={cn("interactive-preview", className)}
      style={{ backgroundColor: bgColor }}
      onPointerEnter={startFollow}
      onPointerMove={(event) => {
        if (reduced) return;
        const rect = event.currentTarget.getBoundingClientRect();
        target.current = {
          x: ((event.clientX - rect.left) / rect.width - 0.5) * 70,
          y: ((event.clientY - rect.top) / rect.height - 0.5) * 50,
        };
      }}
      onPointerLeave={() => {
        if (!surface.current?.contains(document.activeElement))
          setActive(false);
        stopFollow.current?.();
        stopFollow.current = null;
        target.current = current.current = { x: 0, y: 0 };
        if (picture.current)
          gsap.to(picture.current, { x: 0, y: 0, duration: reduced ? 0 : 0.2 });
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setActive(false);
      }}
    >
      <div
        className="preview-list"
        role="group"
        aria-label="Jelajahi fitur Signalgen"
      >
        <div className="preview-highlight" ref={highlight} aria-hidden="true" />
        {items.map((entry, rowIndex) => (
          <button
            key={entry.client}
            type="button"
            ref={(element) => {
              rows.current[rowIndex] = element;
            }}
            className={cn(
              "preview-row",
              active && index === rowIndex && "is-selected",
            )}
            aria-pressed={active && index === rowIndex}
            aria-controls="feature-preview"
            onPointerEnter={() => {
              setSelected(rowIndex);
              setActive(true);
            }}
            onFocus={() => {
              setSelected(rowIndex);
              setActive(true);
            }}
            onClick={() => {
              setSelected(rowIndex);
              setActive(true);
            }}
          >
            <span className="preview-row-title">{entry.client}</span>
            <span className="preview-row-platform">{entry.platform}</span>
            <span className="preview-row-copy">{entry.services}</span>
            <span className="preview-row-action" aria-hidden="true">
              <ArrowUpRight />
            </span>
          </button>
        ))}
      </div>
      <div
        className="preview-visual"
        id="feature-preview"
        role="region"
        aria-label={item.client}
      >
        <div
          className="preview-image"
          ref={picture}
          style={{ scale: clamp(imageSize, 0.5, 1.2, 1) }}
        >
          {failedImage === item.img ? (
            <p>Preview belum dapat dimuat.</p>
          ) : (
            <img
              src={item.img}
              alt={`Screenshot desktop asli: ${item.platform}. Fitur masih dalam pengembangan.`}
              onError={() => setFailedImage(item.img)}
              loading="lazy"
            />
          )}
        </div>
        <div className="preview-caption">
          <span>{item.platform}</span>
          <span>Preview desktop asli</span>
        </div>
      </div>
    </div>
  );
}
