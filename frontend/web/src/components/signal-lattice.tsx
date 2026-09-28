import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";

const RESTING_ORBIT = { x: 58, y: -16 };

export function SignalLattice() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const currentOrbit = useRef({ ...RESTING_ORBIT });
  const targetOrbit = useRef({ ...RESTING_ORBIT });

  function paintOrbit() {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.style.setProperty("--signal-tilt-x", `${currentOrbit.current.x}deg`);
    scene.style.setProperty("--signal-tilt-y", `${currentOrbit.current.y}deg`);
  }

  function animateOrbit() {
    const current = currentOrbit.current;
    const target = targetOrbit.current;
    current.x += (target.x - current.x) * 0.085;
    current.y += (target.y - current.y) * 0.085;
    paintOrbit();

    if (Math.abs(target.x - current.x) + Math.abs(target.y - current.y) > 0.08) {
      frameRef.current = requestAnimationFrame(animateOrbit);
      return;
    }

    currentOrbit.current = { ...target };
    paintOrbit();
    frameRef.current = null;
  }

  function setOrbit(nextOrbit: { x: number; y: number }) {
    targetOrbit.current = nextOrbit;
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(animateOrbit);
    }
  }

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  function resetTilt() {
    setOrbit(RESTING_ORBIT);
  }

  function tilt(event: React.PointerEvent<HTMLDivElement>) {
    if (
      event.pointerType === "touch" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const horizontal = (event.clientX - bounds.left) / bounds.width;
    const vertical = (event.clientY - bounds.top) / bounds.height;
    setOrbit({
      x: 66 - vertical * 46,
      y: horizontal * 360 - 180,
    });
  }

  return (
    <section className="signal-lattice" id="product-tour">
      <div className="signal-lattice__copy">
        <h3>Trace a signal before you act.</h3>
        <p>
          Move across the field to inspect the layers behind a Signalgen
          decision: price movement, rule context, and a readable outcome.
        </p>
        <a className="text-link" href="#app/analysis">
          Open analysis <ArrowRight aria-hidden="true" />
        </a>
        <small>Illustrative interaction · not live market data</small>
      </div>
      <div
        className="signal-lattice__visual"
        onPointerLeave={resetTilt}
        onPointerMove={tilt}
      >
        <div className="signal-lattice__halo" aria-hidden="true" />
        <div className="signal-lattice__scene" ref={sceneRef} aria-hidden="true">
          <div className="signal-lattice__floor" />
          <svg
            className="signal-lattice__trace"
            viewBox="0 0 740 320"
            preserveAspectRatio="none"
          >
            <path d="M0 278 C74 268 103 238 167 247 S255 179 314 193 S396 121 452 147 S551 71 607 97 S687 45 740 62" />
            <path className="signal-lattice__trace-glow" d="M0 278 C74 268 103 238 167 247 S255 179 314 193 S396 121 452 147 S551 71 607 97 S687 45 740 62" />
          </svg>
          <span className="signal-candle signal-candle--one" />
          <span className="signal-candle signal-candle--two" />
          <span className="signal-candle signal-candle--three" />
          <span className="signal-candle signal-candle--four" />
          <span className="signal-candle signal-candle--five" />
          <span className="signal-candle signal-candle--six" />
          <span className="signal-candle signal-candle--seven" />
          <div className="signal-lattice__core">
            <i />
            <span>Signal</span>
            <strong>0.84</strong>
          </div>
          <div className="signal-lattice__tag signal-lattice__tag--rule">
            <span>Rule context</span>
            <strong>Confirmed</strong>
          </div>
          <div className="signal-lattice__tag signal-lattice__tag--trace">
            <span>Traceability</span>
            <strong>Ready to review</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
