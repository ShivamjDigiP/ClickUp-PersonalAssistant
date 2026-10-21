"use client";

import { useSyncExternalStore } from "react";

let cached: boolean | undefined;
function detect(): boolean {
  if (cached === undefined) {
    try {
      const c = document.createElement("canvas");
      cached = !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      cached = false;
    }
  }
  return cached;
}

// null on the server / first paint, then true or false. false = use the CSS visuals instead.
export function useWebGL(): boolean | null {
  return useSyncExternalStore(
    () => () => {},
    detect,
    () => null,
  );
}
