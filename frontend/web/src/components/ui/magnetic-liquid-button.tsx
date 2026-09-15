// Adapted from the Magnetic Liquid Button supplied by the project owner.
// Keeps magnetic springs, tilt, pointer spotlight, liquid border and click waves.
import React, { useState, useRef } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
  AnimatePresence,
  type HTMLMotionProps,
} from "framer-motion";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MagneticLiquidButtonProps extends Omit<
  HTMLMotionProps<"button">,
  "children"
> {
  children?: React.ReactNode;
  variant?: "signal" | "glass";
  magneticStrength?: number;
  glowRadius?: number;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const MagneticLiquidButton = React.forwardRef<
  HTMLButtonElement,
  MagneticLiquidButtonProps
>(function MagneticLiquidButton(
  {
    children,
    className,
    variant = "signal",
    magneticStrength = 0.2,
    glowRadius = 160,
    isLoading = false,
    disabled,
    leftIcon,
    rightIcon,
    onClick,
    onPointerMove,
    onPointerLeave,
    style,
    ...props
  },
  ref,
) {
  const reduced = useReducedMotion();
  const x = useMotionValue(0),
    y = useMotionValue(0);
  const springX = useSpring(x, { damping: 18, stiffness: 220, mass: 0.1 });
  const springY = useSpring(y, { damping: 18, stiffness: 220, mass: 0.1 });
  const rotateX = useTransform(springY, [-40, 40], [8, -8]);
  const rotateY = useTransform(springX, [-40, 40], [-8, 8]);
  const spotX = useMotionValue("50%"),
    spotY = useMotionValue("50%");
  const [ripples, setRipples] = useState<
    { x: number; y: number; id: number }[]
  >([]);
  const sequence = useRef(0);
  const blocked = disabled || isLoading;
  return (
    <motion.button
      {...props}
      ref={ref}
      type={props.type ?? "button"}
      disabled={blocked}
      aria-busy={isLoading || undefined}
      className={cn(
        "magnetic-button",
        variant === "glass" && "magnetic-button--glass",
        className,
      )}
      style={{
        ...style,
        x: reduced ? 0 : springX,
        y: reduced ? 0 : springY,
        rotateX: reduced ? 0 : rotateX,
        rotateY: reduced ? 0 : rotateY,
        transformPerspective: 800,
      }}
      whileTap={reduced || blocked ? undefined : { scale: 0.97 }}
      onPointerMove={(event) => {
        if (!blocked && !reduced && event.pointerType === "mouse") {
          const rect = event.currentTarget.getBoundingClientRect();
          const strength = Math.max(0, Math.min(1, magneticStrength));
          x.set((event.clientX - rect.left - rect.width / 2) * strength);
          y.set((event.clientY - rect.top - rect.height / 2) * strength);
          spotX.set(`${event.clientX - rect.left}px`);
          spotY.set(`${event.clientY - rect.top}px`);
        }
        onPointerMove?.(event);
      }}
      onPointerLeave={(event) => {
        x.set(0);
        y.set(0);
        onPointerLeave?.(event);
      }}
      onBlur={() => {
        x.set(0);
        y.set(0);
      }}
      onClick={(event) => {
        if (blocked) return;
        if (!reduced) {
          const rect = event.currentTarget.getBoundingClientRect();
          const keyboard = event.detail === 0;
          setRipples((prev) => [
            ...prev.slice(-3),
            {
              x: keyboard ? rect.width / 2 : event.clientX - rect.left,
              y: keyboard ? rect.height / 2 : event.clientY - rect.top,
              id: ++sequence.current,
            },
          ]);
        }
        onClick?.(event);
      }}
    >
      <span className="liquid-border" aria-hidden="true" />
      <span className="magnetic-core" aria-hidden="true" />
      <motion.span
        className="magnetic-spot"
        aria-hidden="true"
        style={
          {
            "--spot-x": spotX,
            "--spot-y": spotY,
            "--glow-radius": `${glowRadius}px`,
          } as never
        }
      />
      <span className="magnetic-waves" aria-hidden="true">
        <AnimatePresence>
          {ripples.map((ripple) => (
            <motion.span
              key={ripple.id}
              className="magnetic-ripple"
              style={{ left: ripple.x, top: ripple.y }}
              initial={{ scale: 0, opacity: 0.7 }}
              animate={{ scale: 8, opacity: 0 }}
              transition={{ duration: 0.75, ease: "easeOut" }}
              onAnimationComplete={() =>
                setRipples((prev) => prev.filter((r) => r.id !== ripple.id))
              }
            />
          ))}
        </AnimatePresence>
      </span>
      <span className="magnetic-content">
        {isLoading ? (
          <>
            <LoaderCircle className="button-loader" /> Memproses…
          </>
        ) : (
          <>
            {leftIcon}
            {children}
            {rightIcon}
          </>
        )}
      </span>
    </motion.button>
  );
});
