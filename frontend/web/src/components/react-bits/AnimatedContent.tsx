// React Bits AnimatedContent adapted to native Web Animations; see LICENSE.md.
// Keeps the original semantic element, layout and focus target visible by default.
import {
  createElement,
  forwardRef,
  useEffect,
  useRef,
  type HTMLAttributes,
} from "react";
type Props = HTMLAttributes<HTMLElement> & {
  as?: "section" | "div" | "form";
  animationKey?: string;
};
const AnimatedContent = forwardRef<HTMLElement, Props>(function AnimatedContent(
  { as = "div", animationKey, ...props },
  forwardedRef,
) {
  const root = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const panel = root.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!panel || reduce.matches) return;
    const animation = panel.animate(
      [
        { opacity: 0.65, transform: "translateY(8px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 200, easing: "cubic-bezier(.16,1,.3,1)" },
    );
    const stop = () => {
      if (reduce.matches) animation.cancel();
    };
    reduce.addEventListener("change", stop);
    return () => {
      animation.cancel();
      reduce.removeEventListener("change", stop);
    };
  }, [animationKey]);
  return createElement(as, {
    ...props,
    ref: (node: HTMLElement | null): void => {
      root.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
  });
});
export default AnimatedContent;
