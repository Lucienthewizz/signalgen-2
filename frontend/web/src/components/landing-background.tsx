import GradientASCII from "@/components/react-bits/GradientASCII";
import GhostFibers from "@/components/react-bits/GhostFibers";
import { useVisualPreferences } from "@/lib/visual-preferences";
import "@/styles/landing-effects.css";

const colors = ["#000000", "#000000", "#5aa48c", "#064c35"];
export function LandingBackground({ variant }: { variant: "hero" | "ascii" }) {
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
      ) : (
        <GradientASCII
          colors={colors}
          shape="horizon"
          characters=" =+xX0S8#@"
          cellSize={19}
          density={0.8}
          glyphOpacity={0.85}
          gradientOpacity={0.35}
          glow={0.1}
          flicker={0.2}
          grain={0}
          speed={1}
          flow={0.9}
          mouseInteraction={!reduced}
          clickEffect="none"
          intro={false}
          lightMode={light}
          dpr={1}
        />
      )}
    </div>
  );
}
