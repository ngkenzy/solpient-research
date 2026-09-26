"use client";

import { useCallback, useEffect, useState } from "react";

/** localStorage key shared with solpient-money for the theme preference. */
export const THEME_STORAGE_KEY = "solpient-theme";
/** Window event dispatched whenever the theme changes, so other components can sync. */
export const THEME_CHANGE_EVENT = "solpient-theme-change";

type Theme = "light" | "dark";

function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

/**
 * Theme toggle pill. Mirrors solpient-money's ThemeToggle behavior:
 * - reads/writes localStorage key "solpient-theme" (default "light")
 * - on first paint the FOUC script in app/layout.tsx already applied the
 *   stored value, or prefers-color-scheme when nothing is stored
 * - sets/removes data-theme="dark" on <html>
 * - dispatches a "solpient-theme-change" window event on toggle
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(readTheme());
    setMounted(true);
    const onChange = () => setTheme(readTheme());
    window.addEventListener(THEME_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    if (next === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* storage unavailable — theme still applies for this session */
    }
    setTheme(next);
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme: next } }));
  }, [theme]);

  // Render nothing until mounted so SSR HTML never mismatches the
  // client-side theme (the FOUC script owns first paint).
  if (!mounted) return null;

  const label = theme === "dark" ? "Light" : "Dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={`Switch to ${label.toLowerCase()} theme`}
      aria-pressed={theme === "dark"}
      title={`Switch to ${label.toLowerCase()} theme`}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      <span>{label}</span>
    </button>
  );
}
