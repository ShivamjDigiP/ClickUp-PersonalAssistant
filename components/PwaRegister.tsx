"use client";

import { useEffect } from "react";

// Registers the service worker (production only: in dev a cached shell would hide your code changes).
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => console.warn("[pwa] service worker failed", e));
  }, []);
  return null;
}
