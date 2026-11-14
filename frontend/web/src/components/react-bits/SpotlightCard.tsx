// React Bits SpotlightCard adapted to existing quick-action buttons. See LICENSE.md.
import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
} from "react";
import "./WorkspaceControls.css";
export default function SpotlightCard({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      className={`workspace-spotlight ${className}`}
      style={
        {
          "--spot-x": "50%",
          "--spot-y": "50%",
          ...props.style,
        } as CSSProperties
      }
      onPointerMove={(event) => {
        props.onPointerMove?.(event);
        if (
          event.pointerType === "touch" ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
        )
          return;
        const node = event.currentTarget;
        const bounds = node.getBoundingClientRect();
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          node.style.setProperty(
            "--spot-x",
            `${event.clientX - bounds.left}px`,
          );
          node.style.setProperty("--spot-y", `${event.clientY - bounds.top}px`);
        });
      }}
      onPointerLeave={(event) => {
        cancelAnimationFrame(frame.current);
        props.onPointerLeave?.(event);
      }}
    >
      {children}
    </button>
  );
}
