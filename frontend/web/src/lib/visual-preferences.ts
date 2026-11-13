import { useEffect, useState } from "react";

export function useVisualPreferences() {
  const [preferences, setPreferences] = useState(() => ({
    light: document.documentElement.dataset.theme === "light",
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  }));
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () =>
      setPreferences({
        light: document.documentElement.dataset.theme === "light",
        reduced: media.matches,
      });
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    media.addEventListener("change", sync);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", sync);
    };
  }, []);
  return preferences;
}
