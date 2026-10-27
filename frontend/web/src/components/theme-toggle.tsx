import { useEffect, type ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = "dark";
    root.classList.add("dark");
    root.style.colorScheme = "dark";
    try {
      localStorage.setItem("signalgen.theme", "dark");
    } catch {
      /* Optional preference storage. */
    }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", "#070a08");
    window.dispatchEvent(
      new CustomEvent("signalgen:themechange", { detail: { theme: "dark" } }),
    );
  }, []);
  return <>{children}</>;
}

// Temporarily dark-only; retain the entry point and CSS for a future return.
export function ThemeToggle(_props: { compact?: boolean }) {
  return null;
}
