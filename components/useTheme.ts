"use client";

import { useSyncExternalStore } from "react";

// Theme switching is switched off for now: the app is dark-only. Set to true to bring back the
// Auto / Light / Dark menu (all the light-theme styles are still in place).
export const THEME_SWITCHING = false;

// "auto" follows the mode like the design (Read-only = light, Approval mode = dark).
export type ThemePref = "auto" | "light" | "dark";
const KEY = "theme";
const listeners = new Set<() => void>();

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function useThemePref() {
  const pref = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => "auto" as ThemePref,
  );
  const set = (p: ThemePref) => {
    try {
      localStorage.setItem(KEY, p);
    } catch {
      /* private mode: preference just won't persist */
    }
    listeners.forEach((l) => l());
  };
  return [pref, set] as const;
}
