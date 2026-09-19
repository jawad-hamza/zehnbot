// Light / dark theme. The choice lives on <html data-theme="..."> so plain CSS can react to it,
// and in localStorage so it survives visits. With no stored choice, the device's setting decides.
import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
const KEY = "zb-theme";
const listeners = new Set<() => void>();

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null; // storage blocked: the theme simply is not remembered
  }
}

function systemTheme(): Theme {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function currentTheme(): Theme {
  return (document.documentElement.dataset.theme as Theme) || stored() || systemTheme();
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0b0a1a" : "#faf5ff");
  listeners.forEach((fn) => fn());
}

/** Called once, before React renders, so the first paint already has the right colours. */
export function initTheme() {
  apply(stored() || systemTheme());
  // follow the device while the visitor has not chosen for themselves
  if (typeof matchMedia === "function") {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (!stored()) apply(systemTheme());
    });
  }
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* see stored() */
  }
  apply(theme);
}

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    currentTheme,
  );
  return [theme, () => setTheme(theme === "dark" ? "light" : "dark")];
}
