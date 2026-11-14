import GhostFibers from "@/components/react-bits/GhostFibers";
import { useVisualPreferences } from "@/lib/visual-preferences";
import "@/styles/landing-effects.css";

export function LandingBackground({
  variant,
}: {
  variant: "hero" | "gradient";
}) {
  const { light, reduced } = useVisualPreferences();
  return (
    <div
      className={`landing-background landing-background--${variant}`}
      aria-hidden="true"
      key={`${light}-${reduced}`}
    >
      {variant === "hero" ? (
        <GhostFibers
          glowColor="#064c35"
          layers={3}
          twist={1.2}
          threads={72}
          fiberStyle="dots"
          depthOfField={0.85}
          hoverEffect="focus"
          intro={false}
          mouseInteraction={!reduced}
          lineColor="#000000"
          secondaryColor="#064c35"
          paused={reduced}
          speed={0.3}
          particles={0}
          grain={0}
          pulseOnClick={false}
          lightMode={light}
          dpr={1}
        />
      ) : null}
    </div>
  );
}
