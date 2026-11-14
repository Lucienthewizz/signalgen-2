// React Bits ElasticSlider interaction adapted to a native accessible range.
// Keeps browser keyboard semantics and the form's exact numeric input. See LICENSE.md.
import { useState, type CSSProperties } from "react";
import "./WorkspaceControls.css";
export default function ElasticSlider({
  value,
  onChange,
  label,
  describedBy,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  describedBy?: string;
}) {
  const [stretch, setStretch] = useState(0);
  const safeValue = Math.min(
    100,
    Math.max(1, Number.isFinite(value) ? value : 1),
  );
  return (
    <div
      className="elastic-slider"
      style={
        {
          "--slider-progress": `${((safeValue - 1) / 99) * 100}%`,
          "--slider-stretch": `${stretch}px`,
        } as CSSProperties
      }
    >
      <input
        type="range"
        min={1}
        max={100}
        step={1}
        value={safeValue}
        aria-label={label}
        aria-describedby={describedBy}
        aria-valuetext={`${safeValue} completed daily candles`}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerDown={(event) =>
          event.currentTarget.setPointerCapture(event.pointerId)
        }
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const box = event.currentTarget.getBoundingClientRect();
          const overflow =
            event.clientX < box.left
              ? event.clientX - box.left
              : event.clientX > box.right
                ? event.clientX - box.right
                : 0;
          setStretch(
            Math.sign(overflow) * Math.min(8, Math.abs(overflow) ** 0.6),
          );
        }}
        onPointerUp={() => setStretch(0)}
        onLostPointerCapture={() => setStretch(0)}
        onPointerCancel={() => setStretch(0)}
        onBlur={() => setStretch(0)}
      />
      <div className="elastic-slider__limits" aria-hidden="true">
        <span>1 candle</span>
        <span>100 candles</span>
      </div>
    </div>
  );
}
