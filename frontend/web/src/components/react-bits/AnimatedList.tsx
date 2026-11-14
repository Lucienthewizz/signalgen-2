// React Bits AnimatedList: viewport entrance adapted to semantic news lists.
// See LICENSE.md. Links keep native keyboard navigation and visible defaults.
import { useEffect, useRef, type ReactNode } from "react";
import "./WorkspaceMotion.css";
export default function AnimatedList({
  children,
  as: Container = "ul",
  className = "",
}: {
  children: ReactNode;
  as?: "ul" | "div";
  className?: string;
}) {
  const root = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (
      !root.current ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.animate(
            [
              { opacity: 0.6, transform: "translateY(8px)" },
              { opacity: 1, transform: "translateY(0)" },
            ],
            { duration: 240, easing: "cubic-bezier(.16,1,.3,1)" },
          );
          observer.unobserve(entry.target);
        }),
      { threshold: 0.1 },
    );
    Array.from(root.current.children).forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [children]);
  return (
    <Container
      ref={(node: HTMLDivElement | HTMLUListElement | null) => {
        root.current = node;
      }}
      className={`workspace-animated-list ${className}`}
    >
      {children}
    </Container>
  );
}
