"use client";

import { useEffect } from "react";

// If the session ends while the app is open (expired, signed out elsewhere), any API call comes back 401.
// Send the person to the sign-in page instead of leaving screens that silently fail to load.
export function AuthWatcher() {
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (...args) => {
      const res = await original(...args);
      if (res.status === 401) {
        const input = args[0];
        const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
        const isApi = url.startsWith("/api/") && !url.startsWith("/api/auth/");
        if (isApi && !window.location.pathname.startsWith("/login")) {
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        }
      }
      return res;
    };
    return () => {
      window.fetch = original;
    };
  }, []);
  return null;
}
